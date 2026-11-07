"""Gas and carbon pass-through: when gas sets the price, power moves by about
gas change / CCGT efficiency + carbon change x CCGT emissions per MWh of power,
weighted by the share of hours gas is marginal in each zone and hour. This approximates market coupling.
"""

import numpy as np
import pandas as pd

from engine.interventions.base import EUR_PER_GBP
from engine.reference import loader as facts
from pipeline import cache

# Verified facts (engine/reference/facts/gas_carbon.json); see each fact's caveat.
# Modern CCGT net efficiency, LHV (EU BAT range for new units, so older fleet plant pass through more).
CCGT_EFFICIENCY = facts.figure("gas_ccgt_efficiency", after="representative large plant at about") / 100
CCGT_CO2_T_PER_MWH = facts.figure("gas_ccgt_co2_intensity", after="(")  # t CO2 per MWh of power
TTF_2022_PEAK_EUR_MWH = facts.figure("gas_ttf_2022_peak")  # upper bound for clamping gas shocks to history
GB_GAS_MARGINAL_SHARE = facts.figure("gas_gb_marginal_share", after="around") / 100  # UK government, 2026

# Standard-estimate prior for the share of hours gas sets the price, used when the pipeline's
# per-zone estimate (#33, features/gas_marginal_share) is missing or not yet differentiated by zone.
PRIOR_GAS_MARGINAL_SHARE = {
    "GB": GB_GAS_MARGINAL_SHARE,
    "NL": 0.65,
    "BE": 0.45,
    "DE-LU": 0.40,
    "FR": 0.15,
    "NO2": 0.03,
}
# The pipeline estimate measures co-movement of power with gas, which coupled hydro (NO2) shares and which
# a short history (GB) understates, so it is clipped to documented bounds: GB at least the UK government's
# 2026 figure, Norway at most 10% (hydro sets its price), NL and DE-LU at least 40% (gas-heavy merit orders).
SHARE_BOUNDS = {
    "GB": (GB_GAS_MARGINAL_SHARE, 1.0),
    "NL": (0.40, 1.0),
    "DE-LU": (0.40, 1.0),
    "NO2": (0.0, 0.10),
}
BOUNDS_NOTE = "bounded by standard estimates: GB at least {gb:.0%} (UK government, 2026), Norway at most 10%, NL and DE-LU at least 40%"
DEFAULT_TTF_EUR_MWH = 35.0
DEFAULT_EUA_EUR_T = 70.0


def gas_pass_through() -> float:
    return 1.0 / CCGT_EFFICIENCY


def _read(name: str) -> pd.DataFrame | None:
    try:
        return cache.read(name)
    except FileNotFoundError:
        return None


def prior_only_zones() -> set[str]:
    """Zones the pipeline (#33) marks as falling back to its prior rather than estimating from history."""
    meta = _read("features/gas_marginal_share_meta")
    if meta is None or "basis" not in meta:
        return set()
    return set(meta.loc[meta["basis"] == "prior only", "zone"])


def marginal_share(feats: pd.DataFrame) -> tuple[np.ndarray, str]:
    """Share of each row's hour in which gas is marginal, and where the figure came from."""
    s = _read("features/gas_marginal_share")
    zones = feats["zone"]
    prior = zones.map(PRIOR_GAS_MARGINAL_SHARE).to_numpy(float)
    if s is not None and len(s) and s.groupby("zone")["share"].mean().nunique() > 1:
        key = pd.DataFrame(
            {"zone": zones.to_numpy(), "hour_of_day": feats["ts"].dt.hour.to_numpy(), "month": feats["ts"].dt.month.to_numpy()}
        )
        merged = key.merge(s, on=["zone", "hour_of_day", "month"], how="left")
        share = merged["share"].fillna(pd.Series(prior)).fillna(0.0).to_numpy(float)
        prior_only = sorted(prior_only_zones() & set(zones))
        if prior_only:
            use_prior = zones.isin(prior_only).to_numpy()
            share = np.where(use_prior, np.nan_to_num(prior), share)
        estimated = sorted(set(zones) - set(prior_only), key=list(zones.unique()).index)
        if not prior_only:
            source = "estimated from generation mix and 2021 to 2026 prices"
        elif estimated:
            source = f"estimated from generation mix and 2021 to 2026 prices for {', '.join(estimated)}; standard estimates for {', '.join(prior_only)}"
        else:
            source = "standard estimates"
        source += ", " + BOUNDS_NOTE.format(gb=GB_GAS_MARGINAL_SHARE)
    else:
        share = np.nan_to_num(prior)
        source = "standard estimates"
    return bounded(share, zones), source


def bounded(share: np.ndarray, zones: pd.Series) -> np.ndarray:
    lo = zones.map(lambda z: SHARE_BOUNDS.get(z, (0.0, 1.0))[0]).to_numpy(float)
    hi = zones.map(lambda z: SHARE_BOUNDS.get(z, (0.0, 1.0))[1]).to_numpy(float)
    return np.clip(share, lo, hi)


def to_zone_currency(eur: np.ndarray, zones: pd.Series) -> np.ndarray:
    return np.where(zones.to_numpy() == "GB", eur / EUR_PER_GBP, eur)


def power_delta(feats: pd.DataFrame, d_gas_eur_mwh=0.0, d_carbon_eur_t=0.0) -> tuple[np.ndarray, str]:
    """Per-row power price change in each zone's currency per MWh."""
    share, source = marginal_share(feats)
    eur = (np.asarray(d_gas_eur_mwh, float) * gas_pass_through() + np.asarray(d_carbon_eur_t, float) * CCGT_CO2_T_PER_MWH) * share
    return to_zone_currency(eur, feats["zone"]), source


def column(feats: pd.DataFrame, name: str, default: float) -> np.ndarray:
    v = feats[name].to_numpy(float) if name in feats else np.full(len(feats), default)
    return np.where(np.isfinite(v) & (v > 0), v, default)


NOTE = "Gas and carbon pass-through approximates market coupling: price change ≈ gas change ÷ {eff:.0%} CCGT efficiency + carbon change × {co2} t/MWh, weighted by the share of hours gas sets the price ({src})."
