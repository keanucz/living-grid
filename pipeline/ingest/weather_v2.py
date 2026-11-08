"""Open-Meteo weather v2: gusts, cloud, rain and temperature at population centres and large wind farms.

Written to data/weather_v2/{kind}.parquet in one long shape: ts, issued_at, location, zone, variable, stat, value.
  archive              ERA5 reanalysis (archive-api), 5 days behind: what the weather turned out to be, not a station
                       measurement ("observed" on screen means this)
  historical_forecast  historical-forecast-api (2022 on): the stitched first hours of each model run; the same kind of
                       number the live forecast gives, so it is the one to train on
  previous_day1        previous-runs-api from Jan 2024: the forecast that existed 24 h before each hour. Only
                       temperature_2m, precipitation, cloud_cover and wind_speed_10m exist there (no gusts, no 100 m wind)
  live_forecast        forecast API, issued_at = the run time
  ensemble             ensemble-api (ECMWF IFS 0.25, 51 members): per hour the mean, std, p10, p90 and member count, plus
                       the share of members above an alert threshold. Open-Meteo keeps members for ~3 days only, so this
                       is collected from now on and cannot be backfilled.
Alerts: official warning history is not openly available as data (the Met Office NSWWS feed needs an API key and only
serves current warnings; its archive is a catalogue of PDFs), so alert() flags our own thresholds on archive data (a
location's 99th percentile for gusts and rain, 1st for cold) and says so.
Free tier: under 10,000 calls a day, 5,000 an hour, 600 a minute, non-commercial, CC-BY 4.0 (credit Open-Meteo).
Requests are sequential; long ranges count as several calls, so heavy pulls are chunked and run from the VPS.
"""

import time

import httpx
import numpy as np
import pandas as pd

from pipeline import cache

ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
HISTORICAL = "https://historical-forecast-api.open-meteo.com/v1/forecast"
PREVIOUS = "https://previous-runs-api.open-meteo.com/v1/forecast"
LIVE = "https://api.open-meteo.com/v1/forecast"
ENSEMBLE = "https://ensemble-api.open-meteo.com/v1/ensemble"
ENSEMBLE_MODEL = "ecmwf_ifs025"
ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)"

VARIABLES = ["wind_speed_100m", "wind_gusts_10m", "cloud_cover", "precipitation", "temperature_2m"]
PREVIOUS_VARIABLES = ["temperature_2m", "precipitation", "cloud_cover", "wind_speed_10m"]
CHUNK_DAYS = 31
KINDS = ["archive", "historical_forecast", "previous_day1", "live_forecast", "ensemble"]
COLUMNS = ["ts", "issued_at", "location", "zone", "variable", "stat", "value"]
# Alerts are our thresholds on archive data: gust and rain at the 99th percentile, cold at the 1st.
ALERT_VARIABLES = {"wind_gusts_10m": ("hi", 0.99), "precipitation": ("hi", 0.99), "temperature_2m": ("lo", 0.01)}

# Population centres. Oslo is in NO1, which we do not model, so Stavanger stands in for NO2.
CITIES = [
    ("london", "GB", 51.507, -0.128), ("birmingham", "GB", 52.486, -1.890), ("manchester", "GB", 53.481, -2.243),
    ("glasgow", "GB", 55.864, -4.252), ("paris", "FR", 48.857, 2.352), ("berlin", "DE-LU", 52.520, 13.405),
    ("amsterdam", "NL", 52.373, 4.893), ("brussels", "BE", 50.850, 4.352), ("oslo", "NO1", 59.914, 10.752),
    ("stavanger", "NO2", 58.970, 5.733),
]


def locations() -> pd.DataFrame:
    """location, zone, lat, lon, weight (wind farm capacity in MW; 1 for cities)."""
    rows = [{"location": n, "zone": z, "lat": la, "lon": lo, "weight": 1.0} for n, z, la, lo in CITIES]
    farms = pd.read_csv(cache.ROOT / "data" / "static" / "wind_farms.csv")
    for r in farms.itertuples():
        rows.append({"location": f"farm:{r.bm_unit}", "zone": "GB", "lat": float(r.lat), "lon": float(r.lon), "weight": float(r.capacity_mw)})
    return pd.DataFrame(rows)


def _get(client: httpx.Client, url: str, params: dict) -> list[dict]:
    for attempt in range(5):
        r = client.get(url, params=params)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(float(r.headers.get("Retry-After", 5 * 2**attempt)))
            continue
        r.raise_for_status()
        body = r.json()
        return body if isinstance(body, list) else [body]
    r.raise_for_status()


def _params(locs: pd.DataFrame, variables: list[str], extra: dict) -> dict:
    return {"latitude": ",".join(f"{v:g}" for v in locs.lat), "longitude": ",".join(f"{v:g}" for v in locs.lon),
            "hourly": ",".join(variables), "wind_speed_unit": "ms", "timezone": "UTC", **extra}


def _check(body: list[dict], locs: pd.DataFrame) -> None:
    if len(body) != len(locs):
        raise ValueError(f"Open-Meteo returned {len(body)} locations for {len(locs)} points")


def _long(body: list[dict], locs: pd.DataFrame, variables: list[str], issued, suffix: str = "") -> pd.DataFrame:
    parts = []
    for (_, loc), res in zip(locs.iterrows(), body, strict=True):
        h = res["hourly"]
        ts = pd.to_datetime(h["time"], utc=True)
        for v in variables:
            vals = h.get(v + suffix)
            if vals is None:
                continue
            parts.append(pd.DataFrame({"ts": ts, "location": loc.location, "zone": loc.zone, "variable": v, "stat": "value", "value": vals}))
    if not parts:
        return pd.DataFrame(columns=COLUMNS)
    df = pd.concat(parts, ignore_index=True).dropna(subset=["value"])
    df["issued_at"] = issued(df) if callable(issued) else issued
    return df[COLUMNS]


def _day(x) -> pd.Timestamp:
    """A calendar day as a naive UTC timestamp, whether given naive or tz-aware."""
    t = pd.Timestamp(x)
    if t.tzinfo is not None:
        t = t.tz_convert("UTC").tz_localize(None)
    return t.normalize()


def _history(url: str, kind: str, variables: list[str], start, end, client, suffix="", issued=None) -> pd.DataFrame:
    if cache.offline():
        raise RuntimeError("LG_OFFLINE is set: Open-Meteo ingest needs the network")
    locs = locations()
    start, end = _day(start), _day(end)
    own = client is None
    client = client or httpx.Client(timeout=120)
    parts = []
    try:
        for a in pd.date_range(start, end, freq=f"{CHUNK_DAYS}D"):
            b = min(a + pd.Timedelta(days=CHUNK_DAYS - 1), end)
            q = _params(locs, [v + suffix for v in variables], {"start_date": f"{a:%Y-%m-%d}", "end_date": f"{b:%Y-%m-%d}"})
            body = _get(client, url, q)
            _check(body, locs)
            parts.append(_long(body, locs, variables, issued or (lambda d: d["ts"].dt.floor("D")), suffix))
            time.sleep(1)
    finally:
        if own:
            client.close()
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=COLUMNS)


def fetch_archive(start, end, client=None) -> pd.DataFrame:
    return _history(ARCHIVE, "archive", VARIABLES, start, end, client)


def fetch_historical_forecast(start, end, client=None) -> pd.DataFrame:
    return _history(HISTORICAL, "historical_forecast", VARIABLES, start, end, client)


def fetch_previous_day1(start, end, client=None) -> pd.DataFrame:
    return _history(PREVIOUS, "previous_day1", PREVIOUS_VARIABLES, start, end, client, suffix="_previous_day1",
                    issued=lambda d: d["ts"] - pd.Timedelta(hours=24))


def _now(now) -> pd.Timestamp:
    t = pd.Timestamp.now(tz="UTC") if now is None else pd.Timestamp(now)
    return (t.tz_localize("UTC") if t.tzinfo is None else t.tz_convert("UTC")).floor("h")


def fetch_live(days: int = 3, client=None, now=None) -> pd.DataFrame:
    if cache.offline():
        raise RuntimeError("LG_OFFLINE is set: Open-Meteo ingest needs the network")
    locs, issued = locations(), _now(now)
    own = client is None
    client = client or httpx.Client(timeout=60)
    try:
        body = _get(client, LIVE, _params(locs, VARIABLES, {"forecast_days": days}))
    finally:
        if own:
            client.close()
    _check(body, locs)
    return _long(body, locs, VARIABLES, issued)


def summarise_members(h: dict, variable: str, thresholds: dict | None = None) -> pd.DataFrame:
    """Per hour the mean, std, p10, p90 and member count over the control plus members; plus the share of members beyond
    an alert threshold when thresholds[variable] = (side, level) is given ('hi' counts members at or above, 'lo' at or below)."""
    keys = [k for k in h if k == variable or k.startswith(variable + "_member")]
    if not keys:
        return pd.DataFrame()
    m = np.array([h[k] for k in keys], dtype=float)
    out = {"mean": np.nanmean(m, axis=0), "std": np.nanstd(m, axis=0), "p10": np.nanpercentile(m, 10, axis=0),
           "p90": np.nanpercentile(m, 90, axis=0), "members": np.full(m.shape[1], float(len(keys)))}
    if thresholds and variable in thresholds:
        side, t = thresholds[variable]
        beyond = (m >= t) if side == "hi" else (m <= t)  # NaN compares False
        out["share_beyond_threshold"] = beyond.mean(axis=0)
    ts = pd.to_datetime(h["time"], utc=True)
    return pd.concat([pd.DataFrame({"ts": ts, "variable": variable, "stat": s, "value": v}) for s, v in out.items()], ignore_index=True)


def fetch_ensemble(days: int = 3, client=None, now=None, thresholds: pd.DataFrame | None = None) -> pd.DataFrame:
    """thresholds: the frame from alert_thresholds(); location thresholds make `share_beyond_threshold` rows."""
    if cache.offline():
        raise RuntimeError("LG_OFFLINE is set: Open-Meteo ingest needs the network")
    locs, issued = locations(), _now(now)
    own = client is None
    client = client or httpx.Client(timeout=120)
    parts = []
    try:
        for i in range(0, len(locs), 5):
            chunk = locs.iloc[i : i + 5]
            body = _get(client, ENSEMBLE, _params(chunk, VARIABLES, {"forecast_days": days, "models": ENSEMBLE_MODEL}))
            _check(body, chunk)
            for (_, loc), res in zip(chunk.iterrows(), body, strict=True):
                th = None
                if thresholds is not None and len(thresholds):
                    t = thresholds[thresholds["location"] == loc.location]
                    th = {r.variable: (r.side, r.threshold) for r in t.itertuples()}
                for v in VARIABLES:
                    s = summarise_members(res["hourly"], v, th)
                    if len(s):
                        parts.append(s.assign(location=loc.location, zone=loc.zone))
            time.sleep(1)
    finally:
        if own:
            client.close()
    if not parts:
        return pd.DataFrame(columns=COLUMNS)
    df = pd.concat(parts, ignore_index=True).dropna(subset=["value"])
    df["issued_at"] = issued
    return df[COLUMNS]


def alert_thresholds(archive: pd.DataFrame) -> pd.DataFrame:
    """Per location and alert variable the level beyond which an hour counts as an alert: our definition on archive data."""
    rows = []
    for (loc, zone, v), g in archive[archive["variable"].isin(ALERT_VARIABLES)].groupby(["location", "zone", "variable"]):
        side, q = ALERT_VARIABLES[v]
        rows.append({"location": loc, "zone": zone, "variable": v, "side": side, "quantile": q, "threshold": float(g["value"].quantile(q)), "n": int(len(g))})
    return pd.DataFrame(rows, columns=["location", "zone", "variable", "side", "quantile", "threshold", "n"])


def alert(df: pd.DataFrame, thresholds: pd.DataFrame) -> pd.DataFrame:
    """ts, location, zone, variable, alert (bool): hours beyond our threshold. Not an official warning."""
    d = df[(df["stat"] == "value") & df["variable"].isin(ALERT_VARIABLES)].merge(thresholds, on=["location", "zone", "variable"])
    d["alert"] = np.where(d["side"] == "hi", d["value"] >= d["threshold"], d["value"] <= d["threshold"])
    return d[["ts", "location", "zone", "variable", "alert"]]


def zone_features(df: pd.DataFrame, thresholds: pd.DataFrame | None = None) -> pd.DataFrame:
    """One row per ts and zone, from `value` rows: gust_max_ms (largest at any site), wind_100m_farm_ms (capacity-weighted
    over wind farms), cloud_mean_pct, precip_mm (mean over sites), temp_c (mean), and alert_gust_share / alert_rain_share
    (share of sites beyond their threshold) when thresholds are given."""
    v = df[df["stat"] == "value"]
    w = locations().set_index("location")["weight"]
    out = {}
    g = v[v["variable"] == "wind_gusts_10m"].groupby(["ts", "zone"])["value"].max()
    out["gust_max_ms"] = g
    out["cloud_mean_pct"] = v[v["variable"] == "cloud_cover"].groupby(["ts", "zone"])["value"].mean()
    out["precip_mm"] = v[v["variable"] == "precipitation"].groupby(["ts", "zone"])["value"].mean()
    out["temp_c"] = v[v["variable"] == "temperature_2m"].groupby(["ts", "zone"])["value"].mean()
    farm = v[(v["variable"] == "wind_speed_100m") & v["location"].str.startswith("farm:")].assign(w=lambda d: d["location"].map(w))
    if len(farm):
        out["wind_100m_farm_ms"] = farm.groupby(["ts", "zone"]).apply(lambda d: np.average(d["value"], weights=d["w"]), include_groups=False)
    if thresholds is not None and len(thresholds):
        a = alert(v, thresholds)
        for var, name in (("wind_gusts_10m", "alert_gust_share"), ("precipitation", "alert_rain_share")):
            out[name] = a[a["variable"] == var].groupby(["ts", "zone"])["alert"].mean()
    return pd.DataFrame(out).reset_index().sort_values(["ts", "zone"]).reset_index(drop=True)


NAME = "weather_v2/{kind}"


def write(df: pd.DataFrame, kind: str) -> str:
    name = NAME.format(kind=kind)
    keys = ["ts", "issued_at", "location", "variable", "stat"] if kind in ("live_forecast", "ensemble") else ["ts", "location", "variable", "stat"]
    if cache.exists(name):
        df = cache.concat([cache.read_file(cache.path(name)), df], ignore_index=True)
    df = df.drop_duplicates(keys, keep="last").sort_values(["ts", "location", "variable", "stat"]).reset_index(drop=True)
    cache.write(name, df[COLUMNS])
    return name


def read(kind: str) -> pd.DataFrame:
    return cache.read(NAME.format(kind=kind))


def run(start="2024-01-01", end=None) -> list[str]:
    """The cheap, always-on part for the scheduler: live forecast and the ensemble summary. History is pulled by hand
    (run_history) because it is thousands of calls."""
    th = None
    if cache.exists(NAME.format(kind="archive")):
        th = alert_thresholds(read("archive"))
    return [write(fetch_live(), "live_forecast"), write(fetch_ensemble(thresholds=th), "ensemble")]


def run_history(start="2024-01-01", end=None, kinds=("archive", "historical_forecast"), client=None) -> list[str]:
    end = pd.Timestamp.now(tz="UTC").normalize() - pd.Timedelta(days=1) if end is None else pd.Timestamp(end)
    fns = {"archive": fetch_archive, "historical_forecast": fetch_historical_forecast, "previous_day1": fetch_previous_day1}
    return [write(fns[k](start, end, client), k) for k in kinds]
