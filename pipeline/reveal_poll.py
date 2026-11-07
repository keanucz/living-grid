"""Poll Nord Pool for the delivery day's day-ahead results and keep them as they land.

    uv run python -m pipeline.reveal_poll             # poll until every zone has all hours, or the deadline
    uv run python -m pipeline.reveal_poll --once      # one poll

GB (N2EX) results appear at about 10:00 UK on the auction day and the continental zones at about 11:55 to
12:10 UK, so polling starts at 09:45 UTC. Days not yet published (HTTP 204) are simply absent.

Every new or revised price is appended to data/reveal/results.parquet (seen_at, zone, ts, value, unit), so the
time each zone first landed, and any later revision, is on record; take the latest seen_at per zone and hour.
Results are also merged into data/actuals/nordpool_price_da.parquet, where the scorer reads them.

Configuration (environment):
  LG_FREEZE_DELIVERY       delivery date (CET calendar day)   default 2026-11-09
  LG_REVEAL_POLL_FROM      UTC time to start polling          default 09:45 UTC on the auction day
  LG_REVEAL_POLL_UNTIL     UTC time to give up                default 13:30 UTC on the auction day
  LG_REVEAL_POLL_INTERVAL  seconds between polls              default 30
"""

import argparse
import logging
import os
import sys
import time

import httpx
import pandas as pd

from pipeline import cache, schemas
from pipeline.freeze import DEFAULT_DELIVERY, delivery_window
from pipeline.ingest import nordpool

log = logging.getLogger("pipeline.reveal_poll")

NAME = "reveal/results"
COLUMNS = ["seen_at", "zone", "ts", "value", "unit"]
EXPECTED_ZONES = list(schemas.ZONES)


def _utc(x) -> pd.Timestamp:
    x = pd.Timestamp(x)
    return x.tz_localize("UTC") if x.tzinfo is None else x.tz_convert("UTC")


def _auction_day(delivery: str | None) -> pd.Timestamp:
    return delivery_window(delivery)[0].normalize()


def poll_window(delivery: str | None = None) -> tuple[pd.Timestamp, pd.Timestamp]:
    day = _auction_day(delivery)
    start = os.environ.get("LG_REVEAL_POLL_FROM")
    until = os.environ.get("LG_REVEAL_POLL_UNTIL")
    return (_utc(start) if start else day + pd.Timedelta(hours=9, minutes=45)), (
        _utc(until) if until else day + pd.Timedelta(hours=13, minutes=30)
    )


def fetch_delivery(delivery: str, client: httpx.Client) -> pd.DataFrame:
    """Hourly day-ahead prices for the delivery day: ts, zone, value, unit. Only what is published."""
    start, end = delivery_window(delivery)
    rows = []
    for market in nordpool.MARKETS:
        payload = nordpool._get(client, {**market, "date": delivery})
        if payload:
            rows += nordpool._rows(payload, market["currency"])
    if not rows:
        return pd.DataFrame(columns=["ts", "zone", "value", "unit"])
    df = pd.DataFrame(rows)
    df["ts"] = pd.to_datetime(df["ts"], utc=True).dt.floor("h")
    df = df.groupby(["ts", "zone", "unit"], as_index=False)["value"].mean()
    return df[(df["ts"] >= start) & (df["ts"] < end)].reset_index(drop=True)


def _observations() -> pd.DataFrame:
    if cache.exists(NAME):
        return pd.read_parquet(cache.path(NAME))
    return pd.DataFrame(
        {
            "seen_at": pd.Series(dtype="datetime64[ns, UTC]"),
            "zone": pd.Series(dtype=object),
            "ts": pd.Series(dtype="datetime64[ns, UTC]"),
            "value": pd.Series(dtype=float),
            "unit": pd.Series(dtype=object),
        }
    )


def poll_once(delivery: str | None = None, client: httpx.Client | None = None, now=None) -> dict:
    """One poll. Returns {'new': rows appended, 'zones': {zone: hours landed}, 'complete': bool}."""
    if cache.offline():
        raise RuntimeError("LG_OFFLINE is set: the reveal poller needs the network")
    delivery = delivery or os.environ.get("LG_FREEZE_DELIVERY", DEFAULT_DELIVERY)
    seen_at = (pd.Timestamp.now(tz="UTC") if now is None else _utc(now)).floor("s")
    own = client is None
    client = client or httpx.Client(timeout=30, headers={"User-Agent": "living-grid"})
    try:
        got = fetch_delivery(delivery, client)
    finally:
        if own:
            client.close()
    obs = _observations()
    hours = int((delivery_window(delivery)[1] - delivery_window(delivery)[0]) / pd.Timedelta(hours=1))
    if got.empty:
        return {"new": 0, "zones": {}, "complete": False}
    latest = obs.sort_values("seen_at").drop_duplicates(["zone", "ts"], keep="last")[["zone", "ts", "value"]]
    merged = got.merge(latest, on=["zone", "ts"], how="left", suffixes=("", "_prev"))
    fresh = merged[merged["value_prev"].isna() | ((merged["value"] - merged["value_prev"]).abs() > 1e-9)]
    new = fresh.assign(seen_at=seen_at)[COLUMNS]
    if len(new):
        cache.write(NAME, pd.concat([obs, new], ignore_index=True).sort_values(["seen_at", "zone", "ts"]).reset_index(drop=True))
        nordpool.write(got.assign(series="price_da")[schemas.ACTUALS.names])
    zones = got.groupby("zone")["ts"].nunique().to_dict()
    complete = all(zones.get(z, 0) >= hours for z in EXPECTED_ZONES)
    return {"new": len(new), "zones": zones, "complete": complete}


def watch(delivery: str | None = None, client: httpx.Client | None = None, now_fn=None, sleep_fn=time.sleep) -> dict:
    """Poll from the configured start until every zone has all hours or the deadline passes."""
    now_fn = now_fn or (lambda: pd.Timestamp.now(tz="UTC"))
    start, until = poll_window(delivery)
    interval = float(os.environ.get("LG_REVEAL_POLL_INTERVAL", "30"))
    last = {"new": 0, "zones": {}, "complete": False}
    while now_fn() < until:
        if now_fn() < start:
            sleep_fn((start - now_fn()).total_seconds())
            continue
        try:
            last = poll_once(delivery, client, now=now_fn())
            if last["new"]:
                log.info("landed: %s", last["zones"])
        except httpx.HTTPError:
            log.warning("poll failed; will retry", exc_info=True)
        if last["complete"]:
            break
        sleep_fn(interval)
    return last


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--delivery")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    res = poll_once(args.delivery) if args.once else watch(args.delivery)
    log.info("zones landed: %s complete=%s", res["zones"], res["complete"])
    return 0 if res["complete"] else 1


if __name__ == "__main__":
    sys.exit(main())
