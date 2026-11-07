import numpy as np
import pandas as pd
from fastapi import APIRouter

from engine.routes._fixtures import fixture
from engine.schemas import ScoresResponse
from pipeline import cache
from pipeline.scoring import BASELINES

router = APIRouter(tags=["proof"])

SCORES = "scores/scores"
WALK_FORWARD = "backtest/walk_forward"
HEADLINE_TARGET = "price_da"
SAMPLE_NOTE = " (sample data: no live scores yet)"


def _read(name: str) -> pd.DataFrame:
    try:
        return cache.read(name)
    except FileNotFoundError:
        return pd.DataFrame()


def _none(x):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else x


def live_rows(scores: pd.DataFrame) -> list[dict]:
    """One row per zone, target and model (our model versions and the baselines) with MAE and coverage."""
    out = []
    mae = scores[scores["metric"] == "mae"]
    cov = scores[scores["metric"] == "coverage_p10_p90"].set_index(["zone", "target", "model"])["value"]
    for r in mae.sort_values(["zone", "target", "model"]).itertuples():
        out.append({"zone": r.zone, "target": r.target, "model": r.model, "mae": float(r.value),
                    "coverage_p10_p90": _none(cov.get((r.zone, r.target, r.model))), "n": int(r.n)})
    return out


def headline(scores: pd.DataFrame, sample: bool, battery_share: float) -> dict:
    """MAE of the newest model against persistence on the same rows, pooled over zones for the day-ahead price.

    Pooled across zones, so GBP and EUR are treated as comparable; the ratio is what to read.
    """
    counted = scores[scores["metric"] == "forecasts_scored"]
    if counted.empty:
        counted = scores[(scores["metric"] == "mae") & ~scores["model"].isin(BASELINES)]
    total = int(counted["n"].sum()) if len(counted) else 0
    since = pd.to_datetime(scores["window_start"]).min() if len(scores) else pd.Timestamp.now(tz="UTC")
    text = (f"{total} forecasts since {since:%A %H:%M} UTC, all logged before the outcome"
            if total else "No forecasts have been scored yet")
    model_rows = scores[(scores["target"] == HEADLINE_TARGET) & (scores["metric"] == "mae") & ~scores["model"].isin(BASELINES)]
    mae_model = mae_persistence = coverage = 0.0
    if len(model_rows):
        latest = model_rows.sort_values("window_end")["model"].iloc[-1]
        m = model_rows[model_rows["model"] == latest].set_index("zone")
        p = scores[(scores["target"] == HEADLINE_TARGET) & (scores["metric"] == "mae") & (scores["model"] == "persistence")]
        p = p.set_index("zone").reindex(m.index)
        both = p["value"].notna()
        w = m.loc[both, "n"].to_numpy(dtype=float)
        if both.any():
            mae_model = float(np.average(m.loc[both, "value"], weights=w))
            mae_persistence = float(np.average(p.loc[both, "value"], weights=w))
        c = scores[(scores["target"] == HEADLINE_TARGET) & (scores["metric"] == "coverage_p10_p90") & (scores["model"] == latest)]
        if len(c):
            coverage = float(np.average(c["value"], weights=c["n"]))
    return {"mae_model": mae_model, "mae_persistence": mae_persistence, "coverage_p10_p90": coverage,
            "forecasts_scored": total, "since": since.to_pydatetime(), "battery_share_of_perfect": battery_share,
            "sentence": text + (SAMPLE_NOTE if sample else "")}


def backtest_rows(backtest: pd.DataFrame) -> list[dict]:
    rows = backtest.sort_values(["fold", "zone", "target", "model"])
    return [{"fold": int(r.fold), "zone": r.zone, "target": r.target, "model": r.model, "mae": float(r.mae),
             "coverage_p10_p90": _none(float(r.coverage_p10_p90)), "n": int(r.n)} for r in rows.itertuples()]


def build_scores() -> dict:
    sample = not cache.exists(SCORES)
    scores = _read(SCORES)
    backtest = _read(WALK_FORWARD)
    if scores.empty and not sample:
        scores = pd.DataFrame(columns=["window_start", "window_end", "zone", "target", "metric", "model", "value", "n"])
    battery = fixture("scores")  # stays contract fixture data until #51 scores the batteries on real forecasts
    as_of = pd.to_datetime(scores["window_end"]).max() if len(scores) else pd.Timestamp.now(tz="UTC")
    return {
        "as_of": as_of.to_pydatetime(),
        "headline": headline(scores, sample, battery["headline"]["battery_share_of_perfect"]),
        "live": live_rows(scores) if len(scores) else [],
        "backtest": backtest_rows(backtest) if len(backtest) else [],
        "battery": battery["battery"],
    }


@router.get("/scores", response_model=ScoresResponse)
def scores() -> dict:
    return build_scores()
