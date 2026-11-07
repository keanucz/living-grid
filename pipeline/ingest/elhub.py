"""NO2 measured consumption and production from Elhub's open API (Statnett's metering hub, no key, CC BY 4.0).

Energy-Charts load and wind for Norway cover the whole country, so they are not NO2 targets. Elhub publishes both per
price area, hourly, from metered values: these are measured, not forecasts. Data lands about D+1 to D+2, so a fetch
reaches only as far as the newest complete hour; the live model should use the latest available day.

Series for zone NO2, unit MW (Elhub reports kWh per hour, so MW = kWh / 1000):
  load        sum of the five consumption groups; an hour with any group missing is dropped, not understated
  gen_<group> production by group: hydro, wind, solar, thermal, other

Output: data/actuals/elhub_load.parquet and data/actuals/elhub_generation.parquet (ts, zone, series, value, unit).
The API refuses a request longer than one month, so history is pulled in 28-day windows, about 1 s apart.

    uv run python -m pipeline.ingest.elhub --from 2023-11-01     # backfill, then keep up with the scheduler
"""

import argparse
import logging
import time
from zoneinfo import ZoneInfo

import httpx
import pandas as pd

from pipeline import cache

log = logging.getLogger("pipeline.ingest.elhub")

BASE = "https://api.elhub.no/energy-data/v0/price-areas"
ZONE = "NO2"
OSLO = ZoneInfo("Europe/Oslo")
WINDOW_DAYS = 28
PAUSE_S = 1.0
CONSUMPTION = ("CONSUMPTION_PER_GROUP_MBA_HOUR", "consumptionPerGroupMbaHour", "consumptionGroup")
PRODUCTION = ("PRODUCTION_PER_GROUP_MBA_HOUR", "productionPerGroupMbaHour", "productionGroup")
CONSUMPTION_GROUPS = {"cabin", "household", "primary", "secondary", "tertiary"}
PRODUCTION_GROUPS = {"hydro", "wind", "solar", "thermal", "other"}  # the API also returns a "*" total row; we keep the parts
LOAD_NAME = "actuals/elhub_load"
GEN_NAME = "actuals/elhub_generation"
COLUMNS = ["ts", "zone", "series", "value", "unit"]


def _utc(x) -> pd.Timestamp:
    t = pd.Timestamp(x)
    return t.tz_localize("UTC") if t.tzinfo is None else t.tz_convert("UTC")


def _param(t: pd.Timestamp) -> str:
    """Oslo wall-clock time with its offset: the API reads the clock time in Norwegian time."""
    return t.tz_convert(OSLO).strftime("%Y-%m-%dT%H:%M:%S%z").replace("+0100", "+01:00").replace("+0200", "+02:00")


def _windows(start: pd.Timestamp, end: pd.Timestamp):
    t = start
    while t < end:
        nxt = min(t + pd.Timedelta(days=WINDOW_DAYS), end)
        yield t, nxt
        t = nxt


def _get(client: httpx.Client, dataset: str, start: pd.Timestamp, end: pd.Timestamp) -> dict:
    params = {"dataset": dataset, "startDate": _param(start), "endDate": _param(end)}
    for attempt in range(4):
        r = client.get(f"{BASE}/{ZONE}", params=params)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(float(r.headers.get("Retry-After", 2**attempt)))
            continue
        r.raise_for_status()
        return r.json()
    r.raise_for_status()


def _records(body: dict, key: str) -> list[dict]:
    out = []
    for area in body.get("data", []):
        if area.get("id") == ZONE:
            out += area["attributes"].get(key, [])
    return out


def to_load(rows: list[dict]) -> pd.DataFrame:
    """Total consumption per hour, in MW, for hours where every group reported."""
    df = pd.DataFrame([{"ts": _utc(r["startTime"]), "group": r["consumptionGroup"], "kwh": r["quantityKwh"]}
                       for r in rows if r["consumptionGroup"] in CONSUMPTION_GROUPS])
    if df.empty:
        return pd.DataFrame(columns=COLUMNS)
    wide = df.drop_duplicates(["ts", "group"], keep="last").pivot(index="ts", columns="group", values="kwh")
    ok = wide.reindex(columns=sorted(CONSUMPTION_GROUPS)).notna().all(axis=1)
    total = wide.loc[ok, sorted(CONSUMPTION_GROUPS)].sum(axis=1) / 1000.0
    return pd.DataFrame({"ts": total.index, "zone": ZONE, "series": "load", "value": total.to_numpy(), "unit": "MW"})


def to_generation(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame([{"ts": _utc(r["startTime"]), "series": f"gen_{r['productionGroup']}", "value": r["quantityKwh"] / 1000.0}
                       for r in rows if r["productionGroup"] in PRODUCTION_GROUPS])
    if df.empty:
        return pd.DataFrame(columns=COLUMNS)
    df = df.dropna(subset=["value"]).drop_duplicates(["ts", "series"], keep="last")
    df["zone"], df["unit"] = ZONE, "MW"
    return df[COLUMNS].sort_values(["series", "ts"]).reset_index(drop=True)


def fetch(start, end, client: httpx.Client | None = None, pause: float = PAUSE_S) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(load, generation) for NO2 between start and end (UTC). Hours Elhub has not published yet are simply absent."""
    start, end = _utc(start).floor("h"), _utc(end).ceil("h")
    own = client is None
    client = client or httpx.Client(timeout=60)
    try:
        cons, prod = [], []
        for a, b in _windows(start, end):
            cons += _records(_get(client, CONSUMPTION[0], a, b), CONSUMPTION[1])
            time.sleep(pause)
            prod += _records(_get(client, PRODUCTION[0], a, b), PRODUCTION[1])
            time.sleep(pause)
    finally:
        if own:
            client.close()
    load, gen = to_load(cons), to_generation(prod)
    return tuple(d[(d["ts"] >= start) & (d["ts"] < end)].reset_index(drop=True) for d in (load, gen))


def _merge(name: str, new: pd.DataFrame) -> bool:
    if new.empty:
        return False
    if cache.exists(name):
        new = cache.concat([cache.read_file(cache.path(name)), new], ignore_index=True)
    cache.write(name, new.drop_duplicates(["ts", "zone", "series"], keep="last").sort_values(["series", "ts"]).reset_index(drop=True))
    return True


def write(load: pd.DataFrame, gen: pd.DataFrame) -> list[str]:
    return [n for n, d in ((LOAD_NAME, load), (GEN_NAME, gen)) if _merge(n, d)]


def run(start, end, client: httpx.Client | None = None, pause: float = PAUSE_S) -> list[str]:
    return write(*fetch(start, end, client, pause))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--from", dest="start", default=(pd.Timestamp.now(tz="UTC") - pd.Timedelta(days=5)).strftime("%Y-%m-%d"))
    ap.add_argument("--to", dest="end", default=None, help="default: now")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    end = _utc(args.end) if args.end else pd.Timestamp.now(tz="UTC")
    done = run(args.start, end)
    log.info("wrote %s", done or "nothing (no new hours)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
