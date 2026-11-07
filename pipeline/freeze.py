"""Freeze Monday's day-ahead forecast, visibly timestamped, before its result is public.

    uv run python -m pipeline.freeze            # freeze now
    uv run python -m pipeline.freeze --watch    # sleep to each configured time and freeze then

A freeze copies, for every zone and delivery hour of the delivery day, the latest price_da forecast in the log
with made_at <= frozen_at into data/forecasts/frozen_monday.parquet, stamped with the real wall-clock frozen_at.
Freezes only ever append, so every earlier version stays; the log is read, never written, and fixtures are never
used (a freeze of fixture data would be a lie). A freeze at or after the GB result time is refused, because a
forecast made after its outcome is public proves nothing. A freeze missing a zone or hours is still written
(never lose the freeze) but reported as partial, and the CLI exits 2.

Configuration (environment):
  LG_FREEZE_AT           comma-separated UTC times to freeze at   default 2026-11-07T23:59Z,2026-11-08T09:15Z
                         (first freeze by 23:59 Saturday; final 09:15 Sunday, before the ~10:00 GB N2EX result)
  LG_FREEZE_DELIVERY     delivery date, CET calendar day          default 2026-11-09
  LG_RESULT_PUBLIC_AT    UTC time after which freezing is refused default 10:00 UTC on the auction day
"""

import argparse
import logging
import os
import sys
import time
from dataclasses import dataclass, field

import pandas as pd

from pipeline import cache, commit_chain, schemas

log = logging.getLogger("pipeline.freeze")

NAME = "forecasts/frozen_monday"
TARGET = "price_da"
DEFAULT_FREEZE_AT = "2026-11-07T23:59Z,2026-11-08T09:15Z"
DEFAULT_DELIVERY = "2026-11-09"
GB_RESULT_PUBLIC_HOUR_UTC = 10
KEY = ["frozen_at", "zone", "target", "ts"]


class FreezeTooLate(RuntimeError):
    pass


@dataclass
class FreezeResult:
    frozen_at: pd.Timestamp
    rows: int
    per_zone: dict[str, int]
    missing_zones: list[str] = field(default_factory=list)
    short_zones: dict[str, int] = field(default_factory=dict)

    @property
    def complete(self) -> bool:
        return not self.missing_zones and not self.short_zones


def _utc(x) -> pd.Timestamp:
    x = pd.Timestamp(x)
    return x.tz_localize("UTC") if x.tzinfo is None else x.tz_convert("UTC")


def delivery_window(date: str | None = None) -> tuple[pd.Timestamp, pd.Timestamp]:
    """UTC [start, end) of a CET calendar delivery day."""
    date = date or os.environ.get("LG_FREEZE_DELIVERY", DEFAULT_DELIVERY)
    day = pd.Timestamp(date)
    start = day.tz_localize("Europe/Berlin").tz_convert("UTC")
    end = (day + pd.Timedelta(days=1)).tz_localize("Europe/Berlin").tz_convert("UTC")
    return start, end


def result_public_at(delivery: str | None = None) -> pd.Timestamp:
    env = os.environ.get("LG_RESULT_PUBLIC_AT")
    if env:
        return _utc(env)
    start, _ = delivery_window(delivery)
    return start.normalize() + pd.Timedelta(hours=GB_RESULT_PUBLIC_HOUR_UTC)


def schedule() -> list[pd.Timestamp]:
    raw = os.environ.get("LG_FREEZE_AT", DEFAULT_FREEZE_AT)
    times = sorted(_utc(t.strip()) for t in raw.split(",") if t.strip())
    if not times:
        raise ValueError("LG_FREEZE_AT has no times")
    return times


def _read_log() -> pd.DataFrame:
    if not cache.exists("forecasts/log"):
        raise FileNotFoundError("no forecast log at data/forecasts/log.parquet: nothing to freeze")
    return cache.read_file(cache.path("forecasts/log"))


def freeze(now=None, delivery: str | None = None) -> FreezeResult:
    frozen_at = (pd.Timestamp.now(tz="UTC") if now is None else _utc(now)).floor("s")
    public = result_public_at(delivery)
    if frozen_at >= public:
        raise FreezeTooLate(f"{frozen_at:%Y-%m-%d %H:%M}Z is at or after the result time {public:%Y-%m-%d %H:%M}Z")
    start, end = delivery_window(delivery)
    log_df = _read_log()
    rows = log_df[
        (log_df["target"] == TARGET) & (log_df["ts"] >= start) & (log_df["ts"] < end) & (log_df["made_at"] <= frozen_at)
    ]
    rows = rows.sort_values("made_at").groupby(["zone", "target", "ts"], as_index=False).last()
    rows["frozen_at"] = frozen_at
    rows = cache.normalise_ts(schemas.validate(rows[schemas.FROZEN_MONDAY.names], NAME))
    hours = int((end - start) / pd.Timedelta(hours=1))
    per_zone = {z: int((rows["zone"] == z).sum()) for z in schemas.ZONES}
    result = FreezeResult(
        frozen_at=frozen_at,
        rows=len(rows),
        per_zone=per_zone,
        missing_zones=[z for z, n in per_zone.items() if n == 0],
        short_zones={z: n for z, n in per_zone.items() if 0 < n < hours},
    )
    if rows.empty:
        log.warning("freeze at %s found no price_da forecasts for the delivery day; nothing written", frozen_at)
        return result
    if cache.exists(NAME):
        old = cache.read_file(cache.path(NAME))
        if (old["frozen_at"] == frozen_at).any():
            raise ValueError(f"a freeze at {frozen_at} already exists; earlier freezes are never replaced")
        rows = cache.concat([old, rows], ignore_index=True)
    cache.write(NAME, rows.sort_values(KEY).reset_index(drop=True))
    commit_chain.safely(commit_chain.commit_frozen, frozen_at)
    if not result.complete:
        log.warning("partial freeze at %s: missing zones %s, short zones %s", frozen_at, result.missing_zones, result.short_zones)
    return result


def read_frozen() -> pd.DataFrame:
    return cache.read(NAME)


def latest_freeze(frozen: pd.DataFrame | None = None) -> pd.DataFrame:
    frozen = read_frozen() if frozen is None else frozen
    return frozen[frozen["frozen_at"] == frozen["frozen_at"].max()].reset_index(drop=True)


def watch(delivery: str | None = None, now_fn=None, sleep_fn=time.sleep) -> list[FreezeResult]:
    """Freeze at each configured time still in the future, then return."""
    now_fn = now_fn or (lambda: pd.Timestamp.now(tz="UTC"))
    results = []
    for at in schedule():
        wait = (at - now_fn()).total_seconds()
        if wait < 0:
            log.warning("freeze time %s has passed; skipped (run without --watch to freeze now)", at)
            continue
        sleep_fn(wait)
        try:
            results.append(freeze(now=now_fn(), delivery=delivery))
        except FreezeTooLate:
            log.error("freeze at %s refused: result already public", at)
    return results


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--watch", action="store_true", help="freeze at each configured time instead of now")
    ap.add_argument("--delivery", help="delivery date (CET), default LG_FREEZE_DELIVERY")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    try:
        results = watch(args.delivery) if args.watch else [freeze(delivery=args.delivery)]
    except FreezeTooLate as e:
        log.error("%s", e)
        return 3
    for r in results:
        log.info("froze %d rows at %s %s", r.rows, r.frozen_at, "complete" if r.complete else "PARTIAL")
    return 0 if results and all(r.complete for r in results) else 2


if __name__ == "__main__":
    sys.exit(main())
