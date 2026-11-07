"""Strait of Hormuz closes: an LNG supply shock lifts European gas prices for weeks."""

from engine.interventions import passthrough as pt
from engine.interventions.base import Shock, clamp, evaluate, latest_features

DEFAULT_GAS_RISE_PCT = 40.0
DEFAULT_HOURS = 24 * 14
MAX_HOURS = 24 * 28


def run(req, features=None) -> dict:
    feats = latest_features() if features is None else features.reset_index(drop=True)
    ttf = pt.column(feats, "gas_ttf_eur_mwh", pt.DEFAULT_TTF_EUR_MWH)
    max_pct = max(0.0, (pt.TTF_2022_PEAK_EUR_MWH / float(ttf.mean()) - 1) * 100)
    pct, clamped = clamp(req.magnitude if req.magnitude is not None else DEFAULT_GAS_RISE_PCT, 0.0, max_pct)
    hours, h_clamped = clamp(req.hours or DEFAULT_HOURS, 1, MAX_HOURS)
    d_gas = ttf * pct / 100
    delta, source = pt.power_delta(feats, d_gas_eur_mwh=d_gas)

    result = evaluate(
        req,
        Shock(
            title="Strait of Hormuz closes",
            target="all",
            magnitude=pct,
            hours=int(hours),
            clamped=clamped or h_clamped,
            group="gas",
            phrase=f"gas up {pct:.0f}%",
            structural_fn=lambda f: delta,
        ),
        feats,
    )
    result["method_note"] = pt.NOTE.format(eff=pt.CCGT_EFFICIENCY, co2=pt.CCGT_CO2_T_PER_MWH, src=source) + (
        f" Gas price raised {pct:.0f}% for {int(hours) // 24} days."
    )
    return result
