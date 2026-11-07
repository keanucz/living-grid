"""Storm over Scotland: much more wind, but the B6 boundary to England fills, so much of it is paid to switch off.

Prices fall by what gets through; ghost wind and constraint costs rise by what does not.
"""

from engine.interventions import residual as rz
from engine.interventions.base import Shock, clamp, evaluate, latest_features

DEFAULT_PCT = 50.0
MAX_PCT = 100.0
DEFAULT_HOURS = 24
MAX_HOURS = 24 * 7
# Standard estimates for the demo, labelled on screen.
SCOTTISH_DEMAND_MW = 3_000  # local demand that absorbs extra wind before the boundary
B6_HEADROOM_MW = 1_500  # spare southbound capacity on a windy day
CONSTRAINT_GBP_PER_MWH = 75.0  # typical accepted bid price paid to Scottish wind to switch off


def run(req, features=None) -> dict:
    feats = latest_features() if features is None else features.reset_index(drop=True)
    pct, clamped = clamp(abs(req.magnitude) if req.magnitude is not None else DEFAULT_PCT, 0.0, MAX_PCT)
    hours, h_clamped = clamp(req.hours or DEFAULT_HOURS, 1, MAX_HOURS)
    gb = (feats["zone"] == "GB").to_numpy()
    extra = rz.wind_change_mw(feats, 1 + pct / 100, {"GB": rz.SCOTLAND_WIND_MW})
    extra[~gb] = 0.0
    delivered = extra.clip(min=0).clip(max=B6_HEADROOM_MW + SCOTTISH_DEMAND_MW * 0.1)
    curtailed = extra.clip(min=0) - delivered
    delta = rz.price_from_residual(feats, -delivered)

    def edit(f):
        f.loc[gb, "wind_speed_100m"] *= 1 + pct / 100
        f.loc[gb, "wind_gen_fc_mw"] += delivered[gb]
        f.loc[gb, "residual_load_mw"] -= delivered[gb]
        return f

    n = int(gb.sum()) or 1
    scale = hours / min(n, hours)
    first = gb.nonzero()[0][: int(hours)]
    curtailed_mwh = float(curtailed[first].sum() * scale)
    result = evaluate(
        req,
        Shock(
            title="Storm over Scotland",
            target="GB",
            magnitude=pct,
            hours=int(hours),
            clamped=clamped or h_clamped,
            group="wind",
            phrase=f"Scottish wind up {pct:.0f}%",
            edit=edit,
            structural_fn=lambda f: delta,
            ghost_wind={
                "delta_mwh": round(curtailed_mwh, 0),
                "delta_constraint_cost_gbp": round(curtailed_mwh * CONSTRAINT_GBP_PER_MWH, -3),
                "kind": "estimated",
            },
        ),
        feats,
    )
    result["explanation"]["sentence"] += f"; {curtailed_mwh:,.0f} MWh more wind paid to switch off"
    result["method_note"] += (
        " Extra Scottish wind beyond spare B6 boundary capacity is assumed curtailed and paid about "
        f"£{CONSTRAINT_GBP_PER_MWH:.0f}/MWh (estimates); only the rest lowers the GB price."
    )
    return result
