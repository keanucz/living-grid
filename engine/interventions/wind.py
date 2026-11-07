"""North Sea storm or windless week: scale wind speeds; output follows a generic power curve."""

import numpy as np

from engine import data
from engine.interventions import residual as rz
from engine.interventions.base import Shock, clamp, evaluate, latest_features

NORTH_SEA = ["GB", "NL", "BE", "DE-LU", "NO2"]
DEFAULT_PCT = -50.0  # a windless week
MIN_PCT, MAX_PCT = -90.0, 100.0
DEFAULT_HOURS = 24 * 7
MAX_HOURS = 24 * 14


def run(req, features=None) -> dict:
    feats = latest_features() if features is None else features.reset_index(drop=True)
    target = req.target or "north_sea"
    zones = NORTH_SEA if target == "north_sea" else data.ZONES if target == "all" else [target]
    if not set(zones) <= set(data.ZONES):
        raise ValueError(f"wind target must be 'north_sea', 'all' or one of {data.ZONES}")
    pct, clamped = clamp(req.magnitude if req.magnitude is not None else DEFAULT_PCT, MIN_PCT, MAX_PCT)
    hours, h_clamped = clamp(req.hours or (DEFAULT_HOURS if pct < 0 else 48), 1, MAX_HOURS)
    factor = 1 + pct / 100
    cap = {z: rz.WIND_MW[z] for z in zones}
    d_wind = rz.wind_change_mw(feats, factor, cap)
    delta = rz.price_from_residual(feats, -d_wind)
    calm = pct < 0

    def edit(f):
        m = f["zone"].isin(zones).to_numpy()
        f.loc[m, "wind_speed_100m"] *= factor
        f.loc[m, "wind_gen_fc_mw"] = np.maximum(f.loc[m, "wind_gen_fc_mw"] + d_wind[m], 0.0)
        f.loc[m, "residual_load_mw"] -= d_wind[m]
        return f

    phrase = f"wind {'down' if calm else 'up'} {abs(pct):.0f}%"
    result = evaluate(
        req,
        Shock(
            title=("Windless week" if calm else "North Sea storm") + ("" if target == "north_sea" else f" ({target})"),
            target=target,
            magnitude=pct,
            hours=int(hours),
            clamped=clamped or h_clamped,
            group="wind",
            phrase=phrase,
            edit=edit,
            structural_fn=lambda f: delta,
        ),
        feats,
    )
    if len(zones) == 1:
        rz.headline(result, zones[0], phrase)
    gw = -d_wind[feats["zone"].isin(zones).to_numpy()].mean() * len(zones) / 1000
    result["method_note"] += (
        f" Wind speeds scaled by {factor:.2f} through a generic power curve and installed capacity "
        f"(GB verified, others standard estimates): about {abs(gw):.1f} GW {'less' if calm else 'more'} wind on average."
    )
    return result
