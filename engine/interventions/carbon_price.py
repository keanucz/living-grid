"""Carbon price spike: EUA rises; gas and coal plant costs pass through where they set the price."""

from engine.interventions import passthrough as pt
from engine.interventions.base import Shock, clamp, evaluate, latest_features

DEFAULT_RISE_EUR_T = 30.0
MIN_RISE_EUR_T, MAX_RISE_EUR_T = -60.0, 100.0  # EUA has traded roughly 20 to 100 EUR/t since 2021
DEFAULT_HOURS = 24 * 7
MAX_HOURS = 24 * 28


def run(req, features=None) -> dict:
    feats = latest_features() if features is None else features.reset_index(drop=True)
    eua = pt.column(feats, "eua_eur_t", pt.DEFAULT_EUA_EUR_T)
    rise, clamped = clamp(req.magnitude if req.magnitude is not None else DEFAULT_RISE_EUR_T, MIN_RISE_EUR_T, MAX_RISE_EUR_T)
    rise = max(rise, -float(eua.min()) + 5.0)
    hours, h_clamped = clamp(req.hours or DEFAULT_HOURS, 1, MAX_HOURS)
    delta, source = pt.power_delta(feats, d_carbon_eur_t=rise)

    result = evaluate(
        req,
        Shock(
            title="Carbon price spike",
            target="all",
            magnitude=rise,
            hours=int(hours),
            clamped=clamped or h_clamped,
            group="carbon",
            phrase=f"carbon {'up' if rise >= 0 else 'down'} €{abs(rise):.0f}/t",
            structural_fn=lambda f: delta,
        ),
        feats,
    )
    result["method_note"] = pt.NOTE.format(eff=pt.CCGT_EFFICIENCY, co2=pt.CCGT_CO2_T_PER_MWH, src=source) + (
        " GB carbon is approximated with the EU price (UK ETS differs)."
    )
    return result
