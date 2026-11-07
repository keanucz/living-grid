"""Energy-Charts (Fraunhofer ISE, CC BY 4.0): day-ahead prices, generation, load and cross-border flows.

Covers FR, DE-LU, NL, BE and NO2 (GB comes from Elexon). Responses are 15-minute and are resampled to hourly means.
Energy-Charts reports imports as positive; flow_<from>_<to> series are positive from -> to.
public_power and cbpf for Norway cover all of Norway, not just NO2.
"""

import os
import re
import time

import httpx
import pandas as pd

from pipeline import cache, schemas

BASE = "https://api.energy-charts.info"
SOURCE = "energy_charts"
CHUNK_DAYS = 31
MIN_INTERVAL_S = float(os.environ.get("LG_EC_MIN_INTERVAL", "1.0"))
MAX_RETRIES = 4

# zone -> (price bidding zone, country code for public_power and cbpf)
ZONE_PARAMS = {
    "FR": ("FR", "fr"),
    "DE-LU": ("DE-LU", "de"),
    "NL": ("NL", "nl"),
    "BE": ("BE", "be"),
    "NO2": ("NO2", "no"),
}

PARTNERS = {
    "France": "FR",
    "Germany": "DE-LU",
    "Luxembourg": "DE-LU",
    "Netherlands": "NL",
    "Belgium": "BE",
    "Norway": "NO2",
    "United Kingdom": "GB",
    "Denmark": "DK",
    "Sweden": "SE",
    "Finland": "FI",
    "Switzerland": "CH",
    "Italy": "IT",
    "Spain": "ES",
    "Austria": "AT",
    "Poland": "PL",
    "Czech Republic": "CZ",
    "Ireland": "IE",
}

SKIP_PRODUCTION = {"Load", "Cross border electricity trading"}
SKIP_PATTERNS = re.compile(r"^(Residual load|Renewable share)", re.IGNORECASE)

_last_call = 0.0


def _sleep(seconds: float) -> None:
    time.sleep(seconds)


def _get(client: httpx.Client, endpoint: str, params: dict) -> dict:
    global _last_call
    for attempt in range(MAX_RETRIES + 1):
        wait = MIN_INTERVAL_S - (time.monotonic() - _last_call)
        if wait > 0:
            _sleep(wait)
        _last_call = time.monotonic()
        r = client.get(f"{BASE}/{endpoint}", params=params)
        if r.status_code == 429 and attempt < MAX_RETRIES:
            _sleep(float(r.headers.get("Retry-After", 30)))
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError("unreachable")


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def _frame(ts, values, zone: str, series: str, unit: str, scale: float = 1.0) -> pd.DataFrame:
    df = pd.DataFrame({"ts": pd.to_datetime(ts, unit="s", utc=True), "value": values})
    df = df.dropna()
    df["value"] = df["value"].astype(float) * scale
    hourly = df.set_index("ts")["value"].resample("1h").mean().dropna().reset_index()
    hourly["zone"], hourly["series"], hourly["unit"] = zone, series, unit
    return hourly


def parse_price(payload: dict, zone: str) -> pd.DataFrame:
    return _frame(payload["unix_seconds"], payload["price"], zone, "price_da", payload.get("unit", "EUR / MWh").replace(" / ", "/"))


def parse_public_power(payload: dict, zone: str) -> pd.DataFrame:
    ts = payload["unix_seconds"]
    parts = []
    for s in payload["production_types"]:
        name = s["name"]
        if name == "Load":
            parts.append(_frame(ts, s["data"], zone, "load", "MW"))
        elif name == "Cross border electricity trading":
            parts.append(_frame(ts, s["data"], zone, f"flow_net_{zone}", "MW"))
        elif name in SKIP_PRODUCTION or SKIP_PATTERNS.match(name):
            continue
        else:
            parts.append(_frame(ts, s["data"], zone, f"gen_{_slug(name)}", "MW"))
    return _concat(parts)


def parse_cbpf(payload: dict, zone: str) -> pd.DataFrame:
    ts = payload["unix_seconds"]
    by_partner: dict[str, list[pd.DataFrame]] = {}
    for s in payload["countries"]:
        code = PARTNERS.get(s["name"])
        if code is None or code == zone:
            continue
        by_partner.setdefault(code, []).append(_frame(ts, s["data"], zone, f"flow_{zone}_{code}", "MW", scale=-1000.0))
    parts = []
    for frames in by_partner.values():
        df = _concat(frames)
        parts.append(df.groupby(["ts", "zone", "series", "unit"], as_index=False)["value"].sum())
    return _concat(parts)


def _concat(parts: list[pd.DataFrame]) -> pd.DataFrame:
    cols = ["ts", "zone", "series", "value", "unit"]
    parts = [p for p in parts if len(p)]
    if not parts:
        return pd.DataFrame({c: pd.Series(dtype="datetime64[ns, UTC]" if c == "ts" else "object") for c in cols})
    return pd.concat(parts, ignore_index=True)[cols]


def _windows(start: pd.Timestamp, end: pd.Timestamp):
    t = start
    while t < end:
        nxt = min(t + pd.Timedelta(days=CHUNK_DAYS), end)
        yield t, nxt
        t = nxt


def _group(series: str) -> str:
    if series == "price_da" or series == "load":
        return series
    return "flows" if series.startswith("flow_") else "generation"


def _cache_name(group: str) -> str:
    return f"actuals/{SOURCE}_{group}"


def _store(df: pd.DataFrame) -> None:
    df = df.assign(group=df["series"].map(_group))
    for group, part in df.groupby("group"):
        part = part.drop(columns="group")
        name = _cache_name(group)
        if cache.exists(name):
            part = pd.concat([pd.read_parquet(cache.path(name)), part], ignore_index=True)
        part = part.drop_duplicates(["ts", "zone", "series"], keep="last").sort_values(["ts", "zone", "series"])
        cache.write(name, schemas.validate(part, "actuals"))


def read_cached(start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    parts = []
    for group in ("price_da", "generation", "load", "flows"):
        try:
            parts.append(cache.read(_cache_name(group)))
        except FileNotFoundError:
            continue
    df = _concat(parts)
    return df[(df["ts"] >= start) & (df["ts"] < end)].reset_index(drop=True)


def fetch(start: pd.Timestamp, end: pd.Timestamp, zones=None, client: httpx.Client | None = None) -> pd.DataFrame:
    """Hourly actuals in the shared contract for [start, end). Offline, serves whatever is cached."""
    start, end = pd.Timestamp(start).tz_convert("UTC"), pd.Timestamp(end).tz_convert("UTC")
    if cache.offline():
        return read_cached(start, end)
    own = client is None
    client = client or httpx.Client(timeout=60, headers={"User-Agent": "living-grid-hackathon"})
    try:
        parts = []
        for a, b in _windows(start, end):
            window = {"start": a.strftime("%Y-%m-%dT%H:%MZ"), "end": b.strftime("%Y-%m-%dT%H:%MZ")}
            for zone in zones or ZONE_PARAMS:
                bzn, country = ZONE_PARAMS[zone]
                parts.append(parse_price(_get(client, "price", {"bzn": bzn, **window}), zone))
                parts.append(parse_public_power(_get(client, "public_power", {"country": country, **window}), zone))
                parts.append(parse_cbpf(_get(client, "cbpf", {"country": country, **window}), zone))
        df = _concat(parts)
    finally:
        if own:
            client.close()
    if len(df):
        _store(df)
    return df[(df["ts"] >= start) & (df["ts"] < end)].reset_index(drop=True)
