"""Read what the loop publishes: static zones plus recent rows from the parquet cache (or fixtures)."""

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


def _names(prefix: str) -> list[str]:
    names = set()
    for base in (cache.DATA, cache.FIXTURES):
        d = base / prefix
        if d.is_dir():
            names |= {f"{prefix}/{p.stem}" for p in d.glob("*.parquet")}
    return sorted(names)


def _read(name: str) -> pd.DataFrame | None:
    try:
        return cache.read(name)
    except FileNotFoundError:
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
