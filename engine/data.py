"""Thin read-only access to pipeline parquet (data/ first, committed fixtures as fallback). All UTC."""

from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

from pipeline import cache, static

ZONES = list(static.V1_ZONES)
NAMES = {
    "GB": "Great Britain",
    "FR": "France",
    "DE-LU": "Germany and Luxembourg",
    "NL": "Netherlands",
    "BE": "Belgium",
    "NO2": "Southern Norway",
}
CURRENCY = {z: "GBP" if z == "GB" else "EUR" for z in ZONES}
# Continental links are not in data/static (GB-only); these are approximate, hand-placed landings.
CONTINENTAL_LINKS = [
    ("fr-be", "France to Belgium", "FR", "BE", 3400, (3.2, 50.4), (4.2, 50.7)),
    ("fr-de", "France to Germany", "FR", "DE-LU", 3000, (6.9, 48.6), (8.2, 49.0)),
    ("be-nl", "Belgium to Netherlands", "BE", "NL", 3400, (4.5, 51.0), (5.0, 51.6)),
    ("nl-de", "Netherlands to Germany", "NL", "DE-LU", 5000, (6.0, 52.0), (7.3, 52.2)),
    ("be-de", "ALEGrO", "BE", "DE-LU", 1000, (6.0, 50.6), (6.4, 50.8)),
    ("nl-no2", "NorNed", "NL", "NO2", 700, (6.8, 53.4), (6.8, 58.2)),
    ("de-no2", "NordLink", "DE-LU", "NO2", 1400, (9.3, 54.0), (7.0, 58.3)),
]
PRICE_SOURCES = ["nordpool", "energycharts", "entsoe", "mid"]
# File stems are <source>_<rest>; some sources contain an underscore. Normalised by dropping underscores.
SOURCES = ["energy_charts", "energycharts", "carbon_intensity", "carbonintensity", "elexon", "nordpool", "entsoe", "octopus", "neso"]
# Energy-Charts public_power and load for Norway cover the whole country, not the NO2 bidding zone.
COUNTRY_LEVEL = {("energycharts", "NO2")}
# Metered data that lands a day or two late (Elhub, for NO2): the hour it describes is shown with its own as_of.
DELAYED = {("elhub", "NO2")}
DELAYED_TOLERANCE = pd.Timedelta(days=3)
AS_OF_TOLERANCE = pd.Timedelta(hours=3)
METERED_TOLERANCE = pd.Timedelta(hours=6)  # Energy-Charts load and generation run about 3 hours behind


def _files(sub: str) -> dict[str, Path]:
    """name -> path under data/. Committed fixtures are only read offline, never served as live data."""
    out: dict[str, Path] = {}
    for base in (cache.FIXTURES, cache.DATA) if cache.offline() else (cache.DATA,):
        d = base / sub
        if d.is_dir():
            out.update({p.stem: p for p in d.glob("*.parquet")})
    return out


@lru_cache(maxsize=64)
def _read_parquet(path: Path, mtime: float) -> pd.DataFrame:
    return pd.read_parquet(path)


def _read(path: Path) -> pd.DataFrame:
    return _read_parquet(path, path.stat().st_mtime)


def actuals() -> pd.DataFrame:
    """Every cached actual with its source. Shared and memoised on file mtimes: callers filter, never mutate."""
    files = tuple((stem, p, p.stat().st_mtime) for stem, p in sorted(_files("actuals").items()))
    return _concat_actuals(files)


@lru_cache(maxsize=4)
def _concat_actuals(files: tuple[tuple[str, Path, float], ...]) -> pd.DataFrame:
    parts = []
    for stem, p, mtime in files:
        df = _read_parquet(p, mtime)
        if len(df):
            parts.append(df.assign(source=source_of(stem)))
    if not parts:
        return pd.DataFrame(columns=["ts", "zone", "series", "value", "unit", "source"])
    return pd.concat(parts, ignore_index=True)


def source_of(stem: str) -> str:
    src = next((s for s in SOURCES if stem == s or stem.startswith(s + "_")), stem.split("_", 1)[0])
    return src.replace("_", "")


def forecast_log() -> pd.DataFrame:
    p = _files("forecasts").get("log")
    return _read(p) if p else pd.DataFrame(columns=["made_at", "zone", "target", "ts", "horizon_h", "p10", "p50", "p90"])


def carbon() -> pd.DataFrame:
    p = _files("carbon").get("consumption_intensity")
    return _read(p) if p else pd.DataFrame(columns=["ts", "zone"])


def as_utc(t) -> pd.Timestamp:
    t = pd.Timestamp(t)
    return t.tz_localize("UTC") if t.tzinfo is None else t.tz_convert("UTC")


def _as_of(df: pd.DataFrame, at: pd.Timestamp) -> pd.DataFrame:
    """Latest row per (zone, series) with ts in (at - tolerance, at]."""
    df = df[(df["ts"] <= at) & (df["ts"] > at - AS_OF_TOLERANCE)]
    return df.sort_values("ts").groupby(["zone", "series"], as_index=False).last()


def price_rank(source: pd.Series) -> pd.Series:
    """Lower is preferred: PRICE_SOURCES order, unknown sources next, the MID proxy for GB day-ahead always last."""
    known = [s for s in PRICE_SOURCES if s != "mid"]
    return source.map({s: i for i, s in enumerate(known)}).fillna(len(known)).where(source != "mid", len(known) + 1)


def best_rows(df: pd.DataFrame, series: str | None = None) -> pd.DataFrame:
    """One row per (zone, hour): each source averaged to the hour, then the preferred source kept (never file order).

    Returns ts (hour, UTC), zone, value, source, plus series and unit when present."""
    if series is not None:
        df = df[df["series"] == series]
    if "source" not in df.columns:
        df = df.assign(source="unknown")
    keys = ["zone", "ts", "source"] + [c for c in ("series", "unit") if c in df.columns]
    if df.empty:
        return pd.DataFrame(columns=keys + ["value"])
    h = df.assign(ts=pd.to_datetime(df["ts"], utc=True).dt.floor("h")).groupby(keys, as_index=False, dropna=False)["value"].mean()
    h = h[np.isfinite(h["value"])]
    h = h.assign(rank=price_rank(h["source"])).sort_values(["zone", "ts", "rank"], kind="stable")
    return h.drop_duplicates(["zone", "ts"]).drop(columns="rank").reset_index(drop=True)


def prices(at: pd.Timestamp) -> dict[str, dict]:
    a = actuals()
    a = a[a["series"] == "price_da"].copy()
    a["rank"] = a["source"].map({s: i for i, s in enumerate(PRICE_SOURCES)}).fillna(len(PRICE_SOURCES))
    a = a[(a["ts"] <= at) & (a["ts"] > at - AS_OF_TOLERANCE)].sort_values(["ts", "rank"], ascending=[True, False])
    out = {}
    for zone, g in a.groupby("zone"):
        r = g.iloc[-1]
        kind = "estimated" if r["source"] == "mid" else "actual"
        out[zone] = {"value": float(r["value"]), "unit": r["unit"], "kind": kind, "source": r["source"]}
    return out


def latest_price_ts() -> pd.Timestamp | None:
    a = actuals()
    ts = a.loc[a["series"] == "price_da", "ts"]
    return ts.max() if len(ts) else None


def latest_actual_ts() -> pd.Timestamp | None:
    """Latest hour of metered load or generation (day-ahead prices and forecasts run into tomorrow)."""
    a = actuals()
    ts = a.loc[(a["series"] == "load") | a["series"].str.startswith("gen_"), "ts"]
    return ts.max() if len(ts) else None


def forecasts(at: pd.Timestamp, targets=("price_da", "gb_system_price")) -> dict[str, dict]:
    """Per zone: the forecast for the first hour >= at, from the latest run made by `at`."""
    f = forecast_log()
    f = f[(f["made_at"] <= at) & (f["ts"] >= at.floor("h")) & f["target"].isin(targets)].copy()
    out = {}
    for zone, g in f.groupby("zone"):
        g = g.assign(pref=g["target"].map({t: i for i, t in enumerate(targets)}))
        r = g.sort_values(["ts", "pref", "made_at"], ascending=[True, True, False]).iloc[0]
        out[zone] = {
            "p10": float(r["p10"]),
            "p50": float(r["p50"]),
            "p90": float(r["p90"]),
            "made_at": r["made_at"].to_pydatetime(),
            "horizon_h": int(r["horizon_h"]),
            "target": r["target"],
            "kind": "forecast",
        }
    return out


def carbon_at(at: pd.Timestamp) -> dict[str, dict]:
    """Each zone's newest modelled hour at or before `at`. Zones finish at different hours (Energy-Charts runs 2 to 4 hours
    behind Elexon), so the window is the metered one, as for load and mix, not the 3 h price window."""
    c = carbon()
    if not len(c):
        return {}
    c = c[(c["ts"] <= at) & (c["ts"] > at - METERED_TOLERANCE)].sort_values("ts").groupby("zone").last()
    return {
        zone: {
            "production_gco2_kwh": float(r["production_gco2_kwh"]),
            "consumption_gco2_kwh": float(r["consumption_gco2_kwh"]),
            "imports_share": float(r["imports_share"]),
            "kind": "modelled",
        }
        for zone, r in c.iterrows()
    }


def zone_series(at: pd.Timestamp) -> tuple[dict[str, float], dict[str, dict[str, float]]]:
    """(load MW per zone, generation mix MW per zone) as of `at`; Elexon preferred for GB."""
    a = actuals()
    a = a[(a["ts"] <= at) & (a["ts"] > at - METERED_TOLERANCE)]
    a = a[(a["series"] == "load") | a["series"].str.startswith("gen_")]
    country = pd.MultiIndex.from_arrays([a["source"].astype(str), a["zone"].astype(str)]).isin(list(COUNTRY_LEVEL))
    a = a[~country].copy()
    a["rank"] = (a["source"] == "elexon") & (a["zone"] == "GB")
    a = a.sort_values(["ts", "rank"])
    last = a.groupby(["zone", "series"], as_index=False).last()
    load, mix = {}, {}
    for r in last.itertuples():
        if r.series == "load":
            load[r.zone] = float(r.value)
        else:
            mix.setdefault(r.zone, {})[r.series.removeprefix("gen_")] = float(r.value)
    return load, mix


def delayed_series(at: pd.Timestamp, have: set[str] | frozenset[str] = frozenset()) -> tuple[dict[str, float], dict[str, dict[str, float]], dict[str, pd.Timestamp]]:
    """(load MW, generation mix MW, hour described) per zone from sources that land a day or two late, within
    DELAYED_TOLERANCE of `at`, for zones that have no load from the regular path (`have`). The hour is the older of the
    zone's newest load and generation rows, so the two figures never describe different hours."""
    a = actuals()
    a = a[(a["ts"] <= at) & (a["ts"] > at - DELAYED_TOLERANCE)]
    a = a[(a["series"] == "load") | a["series"].str.startswith("gen_")]
    keep = pd.MultiIndex.from_arrays([a["source"].astype(str), a["zone"].astype(str)]).isin(list(DELAYED))
    a = a[keep & ~a["zone"].isin(list(have))]
    load, mix, as_of = {}, {}, {}
    for zone, g in a.groupby("zone"):
        newest = g.groupby("series")["ts"].max()
        hour = newest[newest.index == "load"].max() if (newest.index == "load").any() else None
        gen = newest[newest.index.str.startswith("gen_")]
        if hour is None or gen.empty:
            continue
        hour = min(hour, gen.max())
        rows = g[g["ts"] == hour]
        if not (rows["series"] == "load").any() or not rows["series"].str.startswith("gen_").any():
            continue
        for r in rows.itertuples():
            if r.series == "load":
                load[zone] = float(r.value)
            else:
                mix.setdefault(zone, {})[r.series.removeprefix("gen_")] = float(r.value)
        as_of[zone] = hour
    return load, mix, as_of


ZONE_ALIASES = {"IE": "SEM", "NI": "SEM", "DK": "DK1"}


def pair_flows(at: pd.Timestamp) -> dict[tuple[str, str], float]:
    """Net MW per zone pair, keyed (a, b) with a < b, positive a -> b. One reporting zone per pair."""
    a = actuals()
    a = a[(a["ts"] <= at) & (a["ts"] > at - AS_OF_TOLERANCE)]
    a = a[a["series"].str.match(r"^flow_[A-Za-z0-9-]+_[A-Za-z0-9-]+$") & ~a["series"].str.startswith("flow_net_")]
    by_reporter: dict[tuple[str, str], dict[str, float]] = {}
    for r in _as_of(a, at).itertuples():
        src, dst = (ZONE_ALIASES.get(z, z) for z in r.series.removeprefix("flow_").split("_", 1))
        key, sign = ((src, dst), 1.0) if src < dst else ((dst, src), -1.0)
        rep = by_reporter.setdefault(key, {})
        rep[r.zone] = rep.get(r.zone, 0.0) + sign * float(r.value)
    return {k: v[min(v)] for k, v in by_reporter.items()}


def interconnectors() -> list[dict]:
    links = []
    for r in static.interconnectors().itertuples():
        links.append(
            {
                "id": r.id,
                "name": r.name,
                "from_zone": r.from_zone,
                "to_zone": r.to_zone,
                "capacity_mw": float(r.capacity_mw),
                "from_coord": (float(r.gb_lon), float(r.gb_lat)),
                "to_coord": (float(r.far_lon), float(r.far_lat)),
                "in_v1": bool(r.to_in_v1),
            }
        )
    for id_, name, a, b, cap, ca, cb in CONTINENTAL_LINKS:
        links.append(
            {"id": id_, "name": name, "from_zone": a, "to_zone": b, "capacity_mw": float(cap), "from_coord": ca, "to_coord": cb, "in_v1": True}
        )
    return links


def link_flows(at: pd.Timestamp) -> list[dict]:
    """Zone-pair flows split across that pair's links in proportion to capacity (estimate when several links)."""
    pairs = pair_flows(at)
    links = interconnectors()
    cap: dict[tuple[str, str], float] = {}
    for link in links:
        k = tuple(sorted((link["from_zone"], link["to_zone"])))
        cap[k] = cap.get(k, 0.0) + link["capacity_mw"]
    out = []
    for link in links:
        a, b = link["from_zone"], link["to_zone"]
        k = tuple(sorted((a, b)))
        if k not in pairs:
            continue
        net = pairs[k] if k == (a, b) else -pairs[k]
        n = sum(1 for x in links if tuple(sorted((x["from_zone"], x["to_zone"]))) == k)
        out.append(
            {
                "interconnector_id": link["id"],
                "from_zone": a,
                "to_zone": b,
                "mw": round(net * link["capacity_mw"] / cap[k], 1),
                "capacity_mw": link["capacity_mw"],
                "kind": "actual" if n == 1 else "estimated",
            }
        )
    return out
