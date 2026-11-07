"""Mystery days for the market: pick calm and windy days from the last weeks and write their replay files.

    uv run python -m pipeline.replay_days select [--weeks 6] [--n 12]     # print the chosen days and regimes
    uv run python -m pipeline.replay_days generate [--weeks 6] [--n 12]   # write data/replay/<day>.json and .bots.json
    uv run python -m pipeline.replay_days check                           # validate every file under data/replay/

generate needs the as-of model for each day (pipeline.models.as_of, trained off the API box) and runs the bot fits, so it
is heavy: run it on the VPS. Each file records its regime. Forecasts are as made 12 hours ahead from models trained only
on data before the day, and the bots file carries no actuals.
"""

import argparse
import json
import logging
import sys
from datetime import date
from pathlib import Path

import pandas as pd

from pipeline import cache
from pipeline.features import build

log = logging.getLogger("pipeline.replay_days")

HEADLINE = date(2026, 10, 26)
REGIMES = ("calm", "windy")
BANDS = ("p10", "p50", "p90")
MIN_HOURS = 24


def replay_dir():
    return cache.DATA / "replay"


def day_stats(inputs: build.Inputs, lookback_end: pd.Timestamp, weeks: int) -> pd.DataFrame:
    """Per complete UTC day in the window: mean GB wind (MW) and whether GB price and wind have all 24 hours."""
    start = lookback_end.normalize() - pd.Timedelta(weeks=weeks)
    wind = inputs.wind["GB"].dropna() if "GB" in inputs.wind else pd.Series(dtype=float)
    price = inputs.price["GB"].dropna() if "GB" in inputs.price else pd.Series(dtype=float)
    w = wind[(wind.index >= start) & (wind.index < lookback_end.normalize())]
    p = price.reindex(w.index)
    df = pd.DataFrame({"wind": w, "ok": p.notna()})
    df["day"] = df.index.normalize()
    g = df.groupby("day").agg(mean_wind=("wind", "mean"), hours=("wind", "size"), priced=("ok", "sum"))
    return g[(g["hours"] >= MIN_HOURS) & (g["priced"] >= MIN_HOURS)]


def select(stats: pd.DataFrame, n: int = 12, exclude: tuple[date, ...] = (HEADLINE,)) -> list[dict]:
    """Half the lowest-wind days as calm, half the highest-wind days as windy, in a shuffled but fixed order."""
    s = stats[~stats.index.map(lambda d: d.date() in exclude)].sort_values("mean_wind")
    k = min(n // 2, len(s) // 2)
    if k == 0:
        return []
    picks = [{"day": d.date(), "regime": "calm", "mean_wind_mw": round(float(v), 1)} for d, v in s["mean_wind"].iloc[:k].items()]
    picks += [{"day": d.date(), "regime": "windy", "mean_wind_mw": round(float(v), 1)} for d, v in s["mean_wind"].iloc[-k:].items()]
    return sorted(picks, key=lambda p: hash_order(p["day"]))


def hash_order(d: date) -> int:
    return (d.toordinal() * 2654435761) % 1000003


def stamp(path, regime: str, mean_wind_mw: float | None = None) -> None:
    doc = json.loads(path.read_text())
    doc["regime"] = regime
    if mean_wind_mw is not None:
        doc["mean_gb_wind_mw"] = mean_wind_mw
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc))
    tmp.replace(path)


def generate(picks: list[dict]) -> list[dict]:
    from engine import replay
    from engine.market import botdata

    done = []
    for p in picks:
        d = p["day"]
        try:
            rp = replay.run(d)
            bp = botdata.run(d)
        except (replay.ReplayUnavailable, ValueError, FileNotFoundError) as e:
            log.warning("skipping %s: %s", d, e)
            continue
        for f in (rp, bp):
            stamp(Path(f), p["regime"], p["mean_wind_mw"])
        done.append(p)
        log.info("wrote %s (%s)", d, p["regime"])
    return done


def _utc(x) -> pd.Timestamp:
    t = pd.Timestamp(x)
    return t.tz_localize("UTC") if t.tzinfo is None else t.tz_convert("UTC")


def check_day(day: date, root=None) -> list[str]:
    """Problems with one day's pair of files; empty when sound."""
    root = root or replay_dir()
    errs = []
    d0 = pd.Timestamp(day, tz="UTC")
    rp, bp = root / f"{day.isoformat()}.json", root / f"{day.isoformat()}.bots.json"
    if not rp.exists() or not bp.exists():
        return [f"{day}: missing replay or bots file"]
    r, b = json.loads(rp.read_text()), json.loads(bp.read_text())
    if r.get("regime") not in REGIMES or b.get("regime") != r.get("regime"):
        errs.append(f"{day}: regime missing or inconsistent")
    for doc, name in ((r, "replay"), (b, "bots")):
        if _utc(doc["trained_before"]) != d0:
            errs.append(f"{day}: {name} trained_before is not the day")
    names = {x["name"] for x in b["bots"]}
    if len(names) < 5:
        errs.append(f"{day}: expected five forecasters, found {len(names)}")
    for s in b["series"]:
        for pt in s["points"]:
            if "actual" in pt:
                errs.append(f"{day}: bots file leaks an actual at {pt['ts']}")
            if set(pt["bots"]) != names:
                errs.append(f"{day}: {s['zone']} {pt['ts']} lacks some bots")
                continue
            for n, q in pt["bots"].items():
                if not all(k in q for k in BANDS) or not q["p10"] <= q["p50"] <= q["p90"]:
                    errs.append(f"{day}: {n} {s['zone']} {pt['ts']} bad quantiles")
    for s in r["series"]:
        for pt in s["points"]:
            ts, made = _utc(pt["ts"]), _utc(pt["made_at"])
            if ts.normalize() != d0:
                errs.append(f"{day}: replay point {pt['ts']} is outside the day")
            if made > ts - pd.Timedelta(hours=build.HISTORY_LEAD_H):
                errs.append(f"{day}: forecast for {pt['ts']} was made too late ({pt['made_at']})")
            if not pt["p10"] <= pt["p50"] <= pt["p90"]:
                errs.append(f"{day}: replay {s['zone']} {pt['ts']} bad quantiles")
    return errs


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("cmd", choices=["select", "generate", "check"])
    ap.add_argument("--weeks", type=int, default=6)
    ap.add_argument("--n", type=int, default=12)
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.cmd == "check":
        files = sorted(replay_dir().glob("????-??-??.bots.json"))
        errs = [e for f in files for e in check_day(date.fromisoformat(f.name[:10]))]
        print("\n".join(errs) or f"{len(files)} days sound")
        return 1 if errs else 0
    inp = build.Inputs()
    stats = day_stats(inp, pd.Timestamp.now(tz="UTC"), args.weeks)
    picks = select(stats, args.n)
    if args.cmd == "select":
        for p in picks:
            print(p["day"], p["regime"], p["mean_wind_mw"])
        return 0 if picks else 1
    return 0 if generate(picks) else 1


if __name__ == "__main__":
    sys.exit(main())
