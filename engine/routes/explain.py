from datetime import datetime

from fastapi import APIRouter, HTTPException

from engine import data
from engine.schemas import ExplainResponse, Zone
from pipeline import schemas as pipeline_schemas
from pipeline.features import build
from pipeline.models import quantile
from pipeline.models.explain import explain_change, reference_rows

router = APIRouter(tags=["forecast"])

REFERENCE_NOTE = "against a typical hour in the next 48 h"
TARGET = "price_da"


def build_explanation(zone: str, ts: datetime | None) -> dict:
    """Why the latest forecast for one zone and hour differs from a typical hour, from the cached feature rows.

    Attribution of the model's own number (LightGBM contributions), not a causal market finding. Reads the features
    the scheduler last wrote; it never rebuilds them per request.
    """
    feats = build.latest(rebuild=False)
    rows = feats[feats["zone"] == zone].reset_index(drop=True)
    if rows.empty:
        raise HTTPException(404, f"no feature rows for {zone}")
    if ts is None:
        i = 0
    else:
        hit = rows.index[rows["ts"] == data.as_utc(ts).floor("h")]
        if not len(hit):
            raise HTTPException(404, f"no forecast for {zone} at that hour; have {rows['ts'].min():%Y-%m-%dT%H:%MZ} "
                                     f"to {rows['ts'].max():%Y-%m-%dT%H:%MZ}")
        i = int(hit[0])
    row = rows.iloc[[i]]
    model = quantile.active()
    prediction = float(model.predict(row)["p50"].iloc[0])
    unit = f"{data.CURRENCY[zone]}/MWh"
    base = {"zone": zone, "ts": row["ts"].iloc[0].to_pydatetime(), "target": TARGET, "unit": unit, "kind": "forecast"}
    if not model.boosters:
        groups = [{"group": g, "value": 0.0} for g in pipeline_schemas.GROUPS]
        return {**base, "sentence": f"{zone}: no trained model yet, so there are no price drivers to explain",
                "contributions": groups, "base": prediction, "prediction": prediction, "delta": 0.0}
    change = explain_change(model, reference_rows(rows).iloc[[i]], row).iloc[0]
    contributions = [{"group": g, "value": float(change[g])} for g in pipeline_schemas.GROUPS]
    delta = sum(c["value"] for c in contributions)
    return {**base, "sentence": f"{change['sentence']} ({REFERENCE_NOTE})", "contributions": contributions,
            "base": prediction - delta, "prediction": prediction, "delta": delta}


@router.get("/explain", response_model=ExplainResponse)
def explain(zone: Zone = "GB", ts: datetime | None = None) -> dict:
    return build_explanation(zone, ts)
