"""Cold snap: temperatures fall, heating demand rises (strongly in France, which heats with electricity)."""

from engine import data
from engine.interventions import residual as rz
from engine.interventions.base import Shock, clamp, evaluate

DEFAULT_DROP_C = 5.0
MAX_DROP_C = 15.0
DEFAULT_HOURS = 72
MAX_HOURS = 24 * 14


def run(req, features=None) -> dict:
    target = req.target or "all"
    zones = data.ZONES if target == "all" else [target]
    if not set(zones) <= set(data.ZONES):
        raise ValueError(f"cold snap target must be 'all' or one of {data.ZONES}")
    drop, clamped = clamp(abs(req.magnitude) if req.magnitude is not None else DEFAULT_DROP_C, 0.0, MAX_DROP_C)
    hours, h_clamped = clamp(req.hours or DEFAULT_HOURS, 1, MAX_HOURS)
    direct = {z: rz.LOAD_PER_DEG_C_MW[z] * drop for z in zones}
    res = direct if target == "all" else rz.spread(direct)
    phrase = f"{drop:.0f}°C colder, more heating demand"

    def edit(feats):
        for z in zones:
            m = feats["zone"] == z
            feats.loc[m, "temperature_c"] -= drop
            feats.loc[m, "load_fc_mw"] += direct[z]
        for z, d in res.items():
            feats.loc[feats["zone"] == z, "residual_load_mw"] += d
        return feats

    result = evaluate(
        req,
        Shock(
            title="Cold snap" if target == "all" else f"Cold snap in {data.NAMES[target]}",
            target=target,
            magnitude=drop,
            hours=int(hours),
            clamped=clamped or h_clamped,
            group="demand",
            phrase=phrase,
            edit=edit,
            residual_mw=res,
        ),
        features,
    )
    if target != "all":
        rz.headline(result, target, phrase)
    result["method_note"] += " Demand rises by a per-degree heating sensitivity (RTE's figure for France; estimates elsewhere)."
    return result
