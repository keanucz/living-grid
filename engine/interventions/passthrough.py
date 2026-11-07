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
    "DE-LU": 0.35,
    "FR": 0.15,
    "NO2": 0.03,
}
DEFAULT_TTF_EUR_MWH = 35.0
DEFAULT_EUA_EUR_T = 70.0


def gas_pass_through() -> float:
    return 1.0 / CCGT_EFFICIENCY


def marginal_share(feats: pd.DataFrame) -> tuple[np.ndarray, str]:
    """Share of each row's hour in which gas is marginal, and where the figure came from."""
    try:
        s = cache.read("features/gas_marginal_share")
    except FileNotFoundError:
        s = None
    if s is not None and len(s) and s.groupby("zone")["share"].mean().nunique() > 1:
        key = pd.DataFrame(
            {"zone": feats["zone"].to_numpy(), "hour_of_day": feats["ts"].dt.hour.to_numpy(), "month": feats["ts"].dt.month.to_numpy()}
        )
        merged = key.merge(s, on=["zone", "hour_of_day", "month"], how="left")
        prior = merged["zone"].map(PRIOR_GAS_MARGINAL_SHARE)
        return merged["share"].fillna(prior).fillna(0.0).to_numpy(float), "estimated from generation mix and 2021 to 2026 prices"
    return feats["zone"].map(PRIOR_GAS_MARGINAL_SHARE).fillna(0.0).to_numpy(float), "standard estimates"


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
