"""Read what the loop publishes: static zones plus recent rows from the parquet cache.

Committed fixtures are read only under LG_OFFLINE=1: online, a missing live file means nothing is published
for that table (and it is logged), never sample rows.
"""

import logging

import pandas as pd

from pipeline import cache, static

log = logging.getLogger("engine.publisher")

CURRENCY = {"GB": "GBP"}


def zones() -> pd.DataFrame:
    geoms = static.zone_geometries()
    out = []
    for f in static.bidding_zones()["features"]:
        code = f["properties"]["zone"]
        if code not in static.V1_ZONES:
            continue
        p = geoms[code].representative_point()
        out.append({"code": code, "name": f["properties"]["name"], "currency": CURRENCY.get(code, "EUR"),
                    "lat": p.y, "lon": p.x})
    return pd.DataFrame(out)


def _bases():
    return (cache.DATA, cache.FIXTURES) if cache.offline() else (cache.DATA,)


def _names(prefix: str) -> list[str]:
    names = set()
    for base in _bases():
        d = base / prefix
        if d.is_dir():
            names |= {f"{prefix}/{p.stem}" for p in d.glob("*.parquet")}
    return sorted(names)


def _read(name: str) -> pd.DataFrame | None:
    for base in _bases():
        p = base / f"{name}.parquet"
        if p.exists():
            return pd.read_parquet(p)
    log.info("no live %s: nothing published for it", name)
    return None


def _since(df: pd.DataFrame | None, col: str, cutoff: pd.Timestamp) -> pd.DataFrame | None:
    return None if df is None else df[pd.to_datetime(df[col], utc=True) >= cutoff]


def actuals(cutoff: pd.Timestamp) -> pd.DataFrame | None:
    frames = [_since(_read(n), "ts", cutoff) for n in _names("actuals")]
    frames = [f for f in frames if f is not None and len(f)]
    return pd.concat(frames, ignore_index=True) if frames else None


def forecasts(cutoff: pd.Timestamp) -> pd.DataFrame | None:
    return _since(_read("forecasts/log"), "ts", cutoff)


def scores() -> pd.DataFrame | None:
    return _read("scores/scores")


def carbon(cutoff: pd.Timestamp) -> pd.DataFrame | None:
    return _since(_read("carbon/consumption_intensity"), "ts", cutoff)
