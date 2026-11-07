"""Nuclear outage: lost capacity raises the zone's residual load; neighbours export more to cover part of it."""

from engine.interventions import residual as rz
from engine.interventions.base import Shock, clamp, evaluate

DEFAULT_ZONE = "FR"
DEFAULT_MW = 4 * 1450.0  # four large French reactors
DEFAULT_HOURS = 72
MAX_HOURS = 24 * 28
FLEET_MW = {"FR": rz.FR_NUCLEAR_MW, "BE": rz.BE_NUCLEAR_MW}


def run(req, features=None) -> dict:
    zone = req.target or DEFAULT_ZONE
    if zone not in FLEET_MW:
        raise ValueError(f"nuclear outage target must be one of {sorted(FLEET_MW)}")
    mw, clamped = clamp(req.magnitude if req.magnitude is not None else DEFAULT_MW, 0.0, FLEET_MW[zone])
    hours, h_clamped = clamp(req.hours or DEFAULT_HOURS, 1, MAX_HOURS)
    res = rz.spread({zone: mw})
    phrase = f"{'French' if zone == 'FR' else 'Belgian'} nuclear down {mw / 1000:.1f} GW"

    def edit(feats):
        for z, d in res.items():
            feats.loc[feats["zone"] == z, "residual_load_mw"] += d
        return feats

    result = evaluate(
        req,
        Shock(
            title=f"{'French' if zone == 'FR' else 'Belgian'} nuclear outage",
            target=zone,
            magnitude=mw,
            hours=int(hours),
            clamped=clamped or h_clamped,
            group="demand",
            phrase=phrase,
            edit=edit,
            residual_mw=res,
        ),
        features,
    )
    rz.headline(result, zone, phrase)
    result["method_note"] += f" {rz.IMPORT_SHARE:.0%} of the shortfall is assumed to be met by imports, split by link capacity."
    return result
