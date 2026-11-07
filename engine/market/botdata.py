"""As-of P10/P50/P90 from every league bot for the replay day's hours, for the market's bot_p.

    uv run python -m engine.market.botdata [--day 2026-10-26]

Fits Yesterday, Last week, The Engineer and The Committee (and Our model for reference) on data strictly before the day
(pipeline.models.bots.fit_asof checks this) and predicts each hour of the day as forecast LEAD_H hours earlier, the same
feature rows as engine.replay. Writes data/replay/<day>.bots.json next to the replay file. Heavy (a few LightGBM fits);
run it off the API box like the as-of model itself.
"""

import argparse
import json
import logging
import sys
from datetime import date

import pandas as pd

from engine import replay
from pipeline import cache
from pipeline.features import build
from pipeline.models import bots as league

log = logging.getLogger("engine.market.botdata")

SERIES = [(z, t) for z, t in replay.SERIES if t in league.TARGETS]


def path(day: date):
    return cache.DATA / "replay" / f"{day.isoformat()}.bots.json"


def compute(day: date, inputs: build.Inputs | None = None, fit=league.fit_asof) -> dict:
    d = pd.Timestamp(day, tz="UTC")
    inp = inputs or build.Inputs()
    feats = build.build_history(d, d + pd.Timedelta(hours=23), lead_h=replay.LEAD_H, inputs=inp)
    if feats.empty:
        raise ValueError(f"no feature history for {day}; has the backfill covered it?")
    out, fitted = [], {}
    for zone, target in SERIES:
        if target not in fitted:
            fitted[target] = fit(d, target, inputs=inp)
        bots, ctx = fitted[target]
        rows = feats[feats["zone"] == zone].reset_index(drop=True)
        if rows.empty or zone not in ctx.wide:
            continue
        pred = league.predict_league(bots, rows, ctx)
        points = [{"ts": rows.at[i, "ts"].isoformat(),
                   "bots": {n: {"p10": float(q[i, 0]), "p50": float(q[i, 1]), "p90": float(q[i, 2])} for n, q in pred.items()}}
                  for i in range(len(rows))]
        out.append({"zone": zone, "target": target, "points": points})
    if not out:
        raise ValueError("no bot could forecast any replay series")
    return {"event": day.isoformat(), "trained_before": day.isoformat(), "bots": league.specs(), "series": out}


def run(day: date, **kw) -> str:
    result = compute(day, **kw)
    p = path(day)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(result))
    tmp.replace(p)
    return str(p)


def load(day: date) -> dict | None:
    p = path(day)
    return json.loads(p.read_text()) if p.exists() else None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Bot league quantiles for a replay day.")
    ap.add_argument("--day", default=replay.HEADLINE_EVENT.isoformat())
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        log.info("wrote %s", run(date.fromisoformat(args.day)))
    except (ValueError, FileNotFoundError) as e:
        log.error("%s", e)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
