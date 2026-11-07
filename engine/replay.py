"""Replay of a real past event: what models trained only on data before it would have forecast, against what happened.

    uv run python -m engine.replay [--event 2026-10-26]

Reads the as-of model for the event date (pipeline.models.as_of, trained before the date and never trained here) and the
cached history. Each hour of the event day is forecast as it would have been 12 hours earlier, from features that use
only data known by then. The result is written to data/replay/<event>.json, which GET /replay serves; with no such
file the route falls back to the committed contract sample for the headline event.

Explanations are LightGBM attributions of the model's own number against a typical hour of that day, attached to the
hours where the forecast moves most. The constraint cost is NESO's published daily total when cached; otherwise the
project brief's figure is used and the summary says so.
"""

import argparse
import json
import logging
import sys
from datetime import date, datetime

import pandas as pd

from engine import data
from pipeline import cache, schemas
from pipeline.features import build
from pipeline.models import asof, train
from pipeline.models.explain import explain_change, reference_rows

log = logging.getLogger("engine.replay")

HEADLINE_EVENT = date(2026, 10, 26)
TITLES = {HEADLINE_EVENT: "The 26 October storm"}
BRIEF_CONSTRAINT_COST_GBP = 36_000_000.0
LEAD_H = build.HISTORY_LEAD_H
EXPLAINED_PER_SERIES = 3
SERIES = [("GB", "gb_system_price"), *[(z, "price_da") for z in schemas.ZONES]]


class ReplayUnavailable(RuntimeError):
    pass


def path(event: date):
    return cache.DATA / "replay" / f"{event.isoformat()}.json"


def constraint_cost(event: date) -> tuple[float, bool]:
    """(GBP, from_neso) for the event's GB day."""
    try:
        c = cache.read("neso/constraint_costs")
    except FileNotFoundError:
        return BRIEF_CONSTRAINT_COST_GBP, False
    hit = c[c["date"].astype(str) == event.isoformat()]
    if hit.empty:
        return BRIEF_CONSTRAINT_COST_GBP, False
    return float(hit["total_cost_gbp"].iloc[0]), True


def _point(ts, actual, q, explanation):
    return {"ts": ts.to_pydatetime(), "actual": None if pd.isna(actual) else float(actual), "p10": float(q["p10"]),
            "p50": float(q["p50"]), "p90": float(q["p90"]), "made_at": (ts - pd.Timedelta(hours=LEAD_H)).to_pydatetime(),
            "explanation": explanation}


def compute(event: date, model=None, inputs: build.Inputs | None = None) -> dict:
    day = pd.Timestamp(event, tz="UTC")
    if model is None:
        try:
            model = asof.as_of(day, train=False)
        except FileNotFoundError as e:
            raise ReplayUnavailable(f"{e}. Train it off this server first.") from e
    if not model.boosters:
        raise ReplayUnavailable("only the untrained stub is available for this date, so there is nothing honest to replay")
    if model.trained_before != day:
        raise ReplayUnavailable(f"model was trained before {model.trained_before}, not {day}")
    inp = inputs or build.Inputs()
    feats = build.build_history(day, day + pd.Timedelta(hours=23), lead_h=LEAD_H, inputs=inp)
    if feats.empty:
        raise ReplayUnavailable(f"no feature history for {event}; has the backfill covered it?")
    wides = train.target_frames(inp)
    series = []
    for zone, target in SERIES:
        if target not in model.boosters or target not in wides or zone not in wides[target]:
            continue
        rows = feats[feats["zone"] == zone].reset_index(drop=True)
        if rows.empty:
            continue
        q = pd.DataFrame(model._quantiles(target, rows))
        actual = wides[target][zone].reindex(rows["ts"]).to_numpy()
        sentences = {}
        if target == "price_da":
            change = explain_change(model, reference_rows(rows), rows)
            for i in change["total"].abs().sort_values(ascending=False).index[:EXPLAINED_PER_SERIES]:
                sentences[i] = change.at[i, "sentence"] + " (against a typical hour that day)"
        unit = f"{data.CURRENCY[zone]}/MWh"
        series.append({"zone": zone, "target": target, "unit": unit,
                       "points": [_point(rows.at[i, "ts"], actual[i], q.iloc[i], sentences.get(i)) for i in range(len(rows))]})
    if not series:
        raise ReplayUnavailable("the model covers none of the replay series")
    cost, from_neso = constraint_cost(event)
    return {"event": event, "title": TITLES.get(event, f"Replay of {event:%d %B %Y}"), "trained_before": event,
            "series": series, "constraint_cost_gbp": cost, "summary": summary(series, event, cost, from_neso, model.version)}


def summary(series: list[dict], event: date, cost: float, from_neso: bool, version: str) -> str:
    wins, total = 0, 0
    for s in series:
        pts = [p for p in s["points"] if p["actual"] is not None]
        if not pts:
            continue
        inside = sum(p["p10"] <= p["actual"] <= p["p90"] for p in pts)
        total += len(pts)
        wins += inside
    cov = f"{wins} of {total} hours landed inside the P10 to P90 band" if total else "no actuals were available to compare"
    src = "NESO daily total" if from_neso else "the project brief's figure, not yet NESO data"
    return (f"Model {version} saw no data on or after {event:%d %B %Y}; forecasts are as made {LEAD_H} hours ahead. {cov}. "
            f"GB constraint cost for the day: £{cost / 1e6:.0f}M ({src}).")


def run(event: date = HEADLINE_EVENT, **kw) -> str:
    result = compute(event, **kw)
    p = path(event)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(result, default=lambda o: o.isoformat() if isinstance(o, (date, datetime)) else float(o)))
    tmp.replace(p)
    return str(p)


def load(event: date) -> dict | None:
    p = path(event)
    return json.loads(p.read_text()) if p.exists() else None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Precompute the replay for a past event.")
    ap.add_argument("--event", default=HEADLINE_EVENT.isoformat())
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        log.info("wrote %s", run(date.fromisoformat(args.event)))
    except ReplayUnavailable as e:
        log.error("%s", e)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
