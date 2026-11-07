"""GET /unseen/carbon: production vs consumption carbon intensity per zone, with what each import adds.

Reads the pipeline's carbon tracing (#45): data/carbon/consumption_intensity.parquet and, when present,
data/carbon/import_contributions.parquet. Serves the hour at or before `at` (default: the latest hour).
"""

from datetime import datetime

import pandas as pd
from fastapi import APIRouter

from engine.routes._fixtures import fixture
from engine.schemas import CarbonResponse
from pipeline import cache, schemas

router = APIRouter(tags=["unseen"])

CONSUMPTION = "carbon/consumption_intensity"
CONTRIBUTIONS = "carbon/import_contributions"
BASE_NOTE = "Emission factors are standard estimates; consumption intensity is modelled."
# A zone "looks clean but imports dirty power" when imports raise its intensity by at least this much.
HIDDEN_MIN_G, HIDDEN_MIN_SHARE = 10.0, 0.10
# Zones finish their latest hour at different times (Energy-Charts lags Elexon by a few hours): take each zone's
# latest row at or before the requested hour, no older than this.
AS_OF_TOLERANCE = pd.Timedelta(hours=6)


def _read(name: str) -> pd.DataFrame | None:
    """Committed fixtures only under LG_OFFLINE=1; online a missing file means no data."""
    if cache.offline():
        try:
            return cache.read(name)
        except FileNotFoundError:
            return None
    p = cache.path(name)
    return cache.read_file(p) if p.exists() else None


def _hour(df: pd.DataFrame, at) -> pd.Timestamp:
    ts = pd.to_datetime(df["ts"], utc=True)
    if at is None:
        return ts.max()
    at = pd.Timestamp(at)
    at = (at.tz_localize("UTC") if at.tzinfo is None else at.tz_convert("UTC")).floor("h")
    earlier = ts[ts <= at]
    return earlier.max() if len(earlier) else ts.min()


def hidden_imports(zones: list[dict]) -> list[dict]:
    """Zones whose consumption intensity is well above what they generate."""
    out = []
    for z in zones:
        gap = z["consumption_gco2_kwh"] - z["production_gco2_kwh"]
        if gap >= HIDDEN_MIN_G and gap >= HIDDEN_MIN_SHARE * max(z["production_gco2_kwh"], 1.0):
            out.append({**z, "gap": gap})
    return sorted(out, key=lambda z: -z["gap"])


def build(at=None, consumption: pd.DataFrame | None = None, contributions: pd.DataFrame | None = None) -> dict | None:
    cons = _read(CONSUMPTION) if consumption is None else consumption
    if cons is None or cons.empty:
        return None
    contrib = _read(CONTRIBUTIONS) if contributions is None else contributions
    hour = _hour(cons, at)
    cons = cons.assign(ts=pd.to_datetime(cons["ts"], utc=True))
    window = cons[(cons["ts"] <= hour) & (cons["ts"] > hour - AS_OF_TOLERANCE)]
    rows = window.sort_values("ts").groupby("zone", as_index=False).last()
    zone_hour = dict(zip(rows["zone"], rows["ts"], strict=True))
    imports = {}
    if contrib is not None and len(contrib):
        c = contrib.assign(ts=pd.to_datetime(contrib["ts"], utc=True))
        c = c[(c["ts"] == c["zone"].map(zone_hour)) & (c["from_zone"] != c["zone"])]
        for r in c.sort_values("contribution_gco2_kwh", ascending=False).itertuples():
            imports.setdefault(r.zone, []).append({
                "from_zone": r.from_zone, "mw": float(r.mw),
                "exporter_gco2_kwh": float(r.source_gco2_kwh), "contribution_gco2_kwh": float(r.contribution_gco2_kwh),
            })
    zones = [
        {"zone": r.zone, "production_gco2_kwh": float(r.production_gco2_kwh),
         "consumption_gco2_kwh": float(r.consumption_gco2_kwh), "imports_share": float(r.imports_share),
         "imports": imports.get(r.zone, []), "kind": "modelled"}
        for r in rows.sort_values("zone").itertuples() if r.zone in schemas.ZONES
    ]
    notes = [BASE_NOTE]
    for z in hidden_imports(zones):
        top = z["imports"][0]["from_zone"] if z["imports"] else None
        notes.append(
            f"{z['zone']} looks cleaner than it is: it generates at {z['production_gco2_kwh']:.0f} g/kWh but "
            f"consumes at {z['consumption_gco2_kwh']:.0f} g/kWh once imports are counted"
            + (f", mostly from {top}." if top else ".")
        )
    if contrib is None:
        notes.append("Per-link import contributions are not available for this hour.")
    return {"at": hour, "zones": zones, "note": " ".join(notes)}


@router.get("/unseen/carbon", response_model=CarbonResponse)
def carbon(at: datetime | None = None) -> dict:
    body = build(at)
    if body is None:
        sample = fixture("carbon")
        return {**sample, "note": "Sample data: no carbon tracing has run yet. " + sample["note"]}
    return body
