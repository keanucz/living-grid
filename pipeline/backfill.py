"""History backfill for every ingest source. Run it from the VPS, not venue Wi-Fi.

    uv run python -m pipeline.backfill --source all --since 2024-01-01
    uv run python -m pipeline.backfill --source elexon,open_meteo --since 2025-06-01 --dry-run

Work is split into UTC-midnight-aligned chunks. Finished chunks are recorded in data/backfill_state.json and skipped
on the next run, so an interrupted backfill resumes where it stopped. The chunk touching the present is never
recorded, because its data is still arriving. Gas and carbon markets always start in 2021 for the 2022 gas crisis.
Nord Pool only publishes about 60 days, so earlier chunks for it are skipped.
"""

import argparse
import json
import logging
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass

import pandas as pd

from pipeline import cache
from pipeline.ingest import boalf, elexon, energy_charts, markets, nordpool, open_meteo

log = logging.getLogger("pipeline.backfill")

DEFAULT_SINCE = "2024-01-01"
SETTLE = pd.Timedelta(days=1)


@dataclass(frozen=True)
class Source:
    name: str
    run: Callable[[pd.Timestamp, pd.Timestamp], object]
    chunk_days: int
    fixed_start: pd.Timestamp | None = None
    max_lookback_days: int | None = None


SOURCES: dict[str, Source] = {
    s.name: s
    for s in (
        Source("elexon", elexon.run, 30),
        Source("energy_charts", energy_charts.fetch, 31),
        Source("nordpool", nordpool.run, 15, max_lookback_days=60),
        Source("open_meteo", open_meteo.run, 31),
        Source("markets", markets.run, 100000, fixed_start=markets.HISTORY_START),
        Source("boalf", boalf.run, 7),
    )
}


def state_path():
    return cache.DATA / "backfill_state.json"


def load_state() -> dict[str, list[list[str]]]:
    p = state_path()
    return json.loads(p.read_text()) if p.exists() else {}


def save_state(state: dict) -> None:
    p = state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=1, sort_keys=True))
    tmp.replace(p)


def chunks(start: pd.Timestamp, end: pd.Timestamp, days: int):
    t = start.normalize()
    while t < end:
        nxt = min(t + pd.Timedelta(days=days), end)
        yield t, nxt
        t = nxt


def plan(source: Source, since: pd.Timestamp, until: pd.Timestamp) -> list[tuple[pd.Timestamp, pd.Timestamp]]:
    start = source.fixed_start if source.fixed_start is not None else since
    if source.max_lookback_days is not None:
        start = max(start, (until - pd.Timedelta(days=source.max_lookback_days)).normalize())
    return list(chunks(start, until, source.chunk_days))


def _key(a: pd.Timestamp, b: pd.Timestamp) -> list[str]:
    return [a.isoformat(), b.isoformat()]


def backfill(
    names: list[str],
    since: pd.Timestamp,
    until: pd.Timestamp | None = None,
    pause_s: float = 2.0,
    dry_run: bool = False,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, dict[str, int]]:
    """Returns {source: {done, skipped, failed}} chunk counts."""
    until = pd.Timestamp.now(tz="UTC") if until is None else pd.Timestamp(until)
    state = load_state()
    summary: dict[str, dict[str, int]] = {}
    for name in names:
        src = SOURCES[name]
        counts = summary[name] = {"done": 0, "skipped": 0, "failed": 0}
        todo = plan(src, since, until)
        finished = {tuple(k) for k in state.get(name, [])}
        log.info("%s: %d chunks planned", name, len(todo))
        for i, (a, b) in enumerate(todo, 1):
            if tuple(_key(a, b)) in finished:
                counts["skipped"] += 1
                continue
            label = f"{name} [{i}/{len(todo)}] {a:%Y-%m-%d} to {b:%Y-%m-%d}"
            if dry_run:
                log.info("would fetch %s", label)
                continue
            log.info("fetching %s", label)
            try:
                src.run(a, b)
            except Exception:
                log.warning("failed %s; rerun to resume", label, exc_info=True)
                counts["failed"] += 1
                continue
            counts["done"] += 1
            if b <= until.normalize() - SETTLE:
                state.setdefault(name, []).append(_key(a, b))
                save_state(state)
            sleep(pause_s)
    return summary


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Backfill history for the ingest sources.")
    ap.add_argument("--source", default="all", help=f"comma-separated names or 'all' ({', '.join(SOURCES)})")
    ap.add_argument("--since", default=DEFAULT_SINCE, help="first UTC day to fetch (markets always start in 2021)")
    ap.add_argument("--until", default=None, help="end of range, default now")
    ap.add_argument("--pause", type=float, default=2.0, help="seconds to wait between chunks")
    ap.add_argument("--dry-run", action="store_true", help="list the chunks that would be fetched")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if cache.offline() and not args.dry_run:
        log.error("LG_OFFLINE is set: backfill needs the network")
        return 2
    names = list(SOURCES) if args.source == "all" else args.source.split(",")
    unknown = [n for n in names if n not in SOURCES]
    if unknown:
        log.error("unknown source(s) %s; choose from %s", unknown, list(SOURCES))
        return 2
    since = pd.Timestamp(args.since, tz="UTC")
    until = pd.Timestamp(args.until, tz="UTC") if args.until else None
    summary = backfill(names, since, until, args.pause, args.dry_run)
    for name, c in summary.items():
        log.info("%s: %d fetched, %d already cached, %d failed", name, c["done"], c["skipped"], c["failed"])
    return 1 if any(c["failed"] for c in summary.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
