import os

import numpy as np
import pandas as pd
from fastapi import APIRouter

from engine.battery import compare
from engine.routes._fixtures import fixture
from engine.schemas import ScoresResponse
from pipeline import cache
from pipeline.scoring import BASELINES

router = APIRouter(tags=["proof"])

SCORES = "scores/scores"
WALK_FORWARD = "backtest/walk_forward"
HEADLINE_TARGET = "price_da"
SAMPLE_NOTE = " (sample data: no live scores yet)"
MIN_SCORED = int(os.environ.get("LG_MIN_SCORED", "24"))


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


def _pooled(rows: pd.DataFrame, value: str) -> tuple[float, float, float, int]:
    """Newest non-baseline model against persistence on the same zones, n-weighted: (mae_model, mae_persistence, coverage, n)."""
    ours = rows[~rows["model"].isin(BASELINES)]
    if ours.empty:
        return 0.0, 0.0, 0.0, 0
    latest = ours["model"].iloc[-1]
    m = ours[ours["model"] == latest]
    p = rows[rows["model"] == "persistence"]
    keys = [k for k in ("zone", "fold") if k in rows.columns]
    joined = m.merge(p, on=keys, suffixes=("", "_p"))
    if joined.empty:
        return 0.0, 0.0, 0.0, 0
    w = joined["n"].to_numpy(dtype=float)
    cov = joined["coverage_p10_p90"].astype(float)
    ok = cov.notna().to_numpy()
    coverage = float(np.average(cov[ok], weights=w[ok])) if ok.any() else 0.0
    return (float(np.average(joined[value], weights=w)), float(np.average(joined[value + "_p"], weights=w)),
            coverage, int(w.sum()))


def _live_frame(scores: pd.DataFrame) -> pd.DataFrame:
    s = scores[scores["target"] == HEADLINE_TARGET]
    mae = s[s["metric"] == "mae"].sort_values("window_end")
    cov = s[s["metric"] == "coverage_p10_p90"].set_index(["zone", "model"])["value"]
    out = mae[["zone", "model", "value", "n"]].rename(columns={"value": "mae"}).reset_index(drop=True)
    out["coverage_p10_p90"] = [cov.get((z, m), np.nan) for z, m in zip(out["zone"], out["model"])]
    return out.drop_duplicates(["zone", "model"], keep="last")


def scored_for(scores: pd.DataFrame, target: str) -> int:
    s = scores[scores["target"] == target] if len(scores) else scores
    counted = s[s["metric"] == "forecasts_scored"] if len(s) else s
    if not len(counted):
        counted = s[(s["metric"] == "mae") & ~s["model"].isin(BASELINES)] if len(s) else s
    return int(counted["n"].sum()) if len(counted) else 0


def headline(scores: pd.DataFrame, sample: bool, battery: dict,
             backtest: pd.DataFrame | None = None, min_scored: int | None = None) -> dict:
    """MAE of the newest model against persistence on the same rows, pooled over zones for the day-ahead price.

    Pooled across zones, so GBP and EUR are treated as comparable; the ratio is what to read. Until at least
    `min_scored` live day-ahead forecasts are scored, the metrics come from the walk-forward backtest instead,
    so one or two scored hours never reach the projector as a headline.
    """
    min_scored = MIN_SCORED if min_scored is None else min_scored
    counted = scores[scores["metric"] == "forecasts_scored"]
    if counted.empty:
        counted = scores[(scores["metric"] == "mae") & ~scores["model"].isin(BASELINES)]
    total = int(counted["n"].sum()) if len(counted) else 0
    since = pd.to_datetime(scores["window_start"]).min() if len(scores) else pd.Timestamp.now(tz="UTC")
    live = _live_frame(scores) if len(scores) else pd.DataFrame(columns=["zone", "model", "mae", "n", "coverage_p10_p90"])
    mae_model, mae_persistence, coverage, _ = _pooled(live, "mae")
    bt = backtest if backtest is not None and len(backtest) else pd.DataFrame(columns=["fold", "zone", "target", "model"])
    bt = bt[bt["target"] == HEADLINE_TARGET].sort_values(["fold", "zone"])
    if sample or scored_for(scores, HEADLINE_TARGET) >= min_scored or (bt.empty and total == 0):
        text = (f"{total} forecasts since {since:%A %H:%M} UTC, all logged before the outcome"
                if total else "No forecasts have been scored yet")
    else:
        mae_model, mae_persistence, coverage, n_bt = _pooled(bt, "mae")
        text = f"Scoring starts as forecasts reach their target hour: {total} scored so far"
        text += (f". Headline figures are from the walk-forward backtest ({n_bt} hours)" if n_bt
                 else ". Headline figures follow once enough are scored")
    return {"mae_model": mae_model, "mae_persistence": mae_persistence, "coverage_p10_p90": coverage,
            "forecasts_scored": total, "since": since.to_pydatetime(), "battery_share_of_perfect": battery.get("share"),
            "battery_hours": battery.get("n_hours"), "battery_note": battery.get("note"),
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
    if sample:
        sample_body = fixture("scores")
        battery = sample_body["battery"]
        summary = {"share": sample_body["headline"]["battery_share_of_perfect"], "n_hours": None, "note": "Sample data"}
    else:
        out = compare.run()
        battery, summary = out["results"], out
    as_of = pd.to_datetime(scores["window_end"]).max() if len(scores) else pd.Timestamp.now(tz="UTC")
    return {
        "as_of": as_of.to_pydatetime(),
        "headline": headline(scores, sample, summary, backtest if cache.exists(WALK_FORWARD) else None),
        "live": live_rows(scores) if len(scores) else [],
        "backtest": backtest_rows(backtest) if len(backtest) else [],
        "battery": battery,
    }


@router.get("/scores", response_model=ScoresResponse)
def scores() -> dict:
    return build_scores()
