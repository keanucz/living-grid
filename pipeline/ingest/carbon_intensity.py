"""National Grid ESO Carbon Intensity API: modelled gCO2/kWh for GB and its DNO regions.

These are modelled estimates (the regional figures are a forecast-style model, not metered), so label
them as such on screen. Requests are limited to 14 days; longer ranges are chunked.

Outputs:
  data/carbon_intensity/regional.parquet  ts (hour, UTC), region (Octopus/DNO letter), region_id,
                                          intensity_gco2_kwh (mean of half-hours), index (modal band)
  data/carbon_intensity/regional_mix.parquet  ts (hour, UTC), region, fuel, perc (mean of half-hours, % of the
                                              region's modelled generation)
  data/actuals/carbonintensity_ci_gco2_kwh  GB national, hourly, as the shared series ci_gco2_kwh
                                            (actual where published, otherwise the API forecast)
"""

import time

import httpx
import pandas as pd

from pipeline import cache, schemas, static

BASE = "https://api.carbonintensity.org.uk"
REGIONAL = "carbon_intensity/regional"
REGIONAL_MIX = "carbon_intensity/regional_mix"
MIX_COLUMNS = ["ts", "region", "fuel", "perc"]
NATIONAL = "actuals/carbonintensity_ci_gco2_kwh"
CHUNK_DAYS = 14
COLUMNS = ["ts", "region", "region_id", "intensity_gco2_kwh", "index"]


def _get(client: httpx.Client, path: str) -> dict:
    for attempt in range(4):
        r = client.get(f"{BASE}/{path}")
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(float(r.headers.get("Retry-After", 2**attempt)))
            continue
        r.raise_for_status()
        return r.json()
    r.raise_for_status()


def _utc(x) -> pd.Timestamp:
    x = pd.Timestamp(x)
    return x.tz_localize("UTC") if x.tzinfo is None else x.tz_convert("UTC")


def _chunks(start: pd.Timestamp, end: pd.Timestamp):
    a = start.floor("h")
    while a <= end:
        b = min(a + pd.Timedelta(days=CHUNK_DAYS) - pd.Timedelta(minutes=30), end)
        yield a, b
        a += pd.Timedelta(days=CHUNK_DAYS)


def _stamp(t: pd.Timestamp) -> str:
    return f"{t:%Y-%m-%dT%H:%MZ}"


def _letters() -> dict[int, str]:
    keys = static.gb_region_keys()
    return dict(zip(keys["carbon_intensity_region_id"], keys["region"], strict=True))


def regional_slots(start, end, client: httpx.Client) -> list[dict]:
    """Raw half-hour slots from the regional endpoint (each with intensity and generation mix per region)."""
    start, end = _utc(start), _utc(end)
    return [slot for a, b in _chunks(start, end) for slot in _get(client, f"regional/intensity/{_stamp(a)}/{_stamp(b)}")["data"]]


def fetch_regional(start, end, client: httpx.Client, slots: list[dict] | None = None) -> pd.DataFrame:
    start, end = _utc(start), _utc(end)
    letters = _letters()
    rows = []
    for slot in regional_slots(start, end, client) if slots is None else slots:
        for reg in slot["regions"]:
            if reg["regionid"] in letters and reg["intensity"]["forecast"] is not None:
                rows.append(
                    {
                        "from": slot["from"],
                        "region_id": reg["regionid"],
                        "region": letters[reg["regionid"]],
                        "v": reg["intensity"]["forecast"],
                        "index": reg["intensity"]["index"],
                    }
                )
    if not rows:
        return pd.DataFrame(columns=COLUMNS)
    df = pd.DataFrame(rows)
    df["ts"] = pd.to_datetime(df["from"], utc=True).dt.floor("h")
    df = df.groupby(["ts", "region", "region_id"], as_index=False).agg(
        intensity_gco2_kwh=("v", "mean"), index=("index", lambda s: s.mode().iloc[0])
    )
    df = df[(df["ts"] >= start.floor("h")) & (df["ts"] <= end)]
    return df[COLUMNS].sort_values(["ts", "region"]).reset_index(drop=True)


def fetch_regional_mix(start, end, client: httpx.Client, slots: list[dict] | None = None) -> pd.DataFrame:
    """Hourly generation mix per region (percent of modelled regional generation, mean of the half-hours)."""
    start, end = _utc(start), _utc(end)
    letters = _letters()
    rows = [
        {"from": slot["from"], "region": letters[reg["regionid"]], "fuel": m["fuel"], "perc": float(m["perc"])}
        for slot in (regional_slots(start, end, client) if slots is None else slots)
        for reg in slot["regions"] if reg["regionid"] in letters
        for m in reg.get("generationmix") or []
    ]
    if not rows:
        return pd.DataFrame(columns=MIX_COLUMNS)
    df = pd.DataFrame(rows)
    df["ts"] = pd.to_datetime(df["from"], utc=True).dt.floor("h")
    df = df.groupby(["ts", "region", "fuel"], as_index=False)["perc"].mean()
    df = df[(df["ts"] >= start.floor("h")) & (df["ts"] <= end)]
    return df[MIX_COLUMNS].sort_values(["ts", "region", "fuel"]).reset_index(drop=True)


def fetch_national(start, end, client: httpx.Client) -> pd.DataFrame:
    start, end = _utc(start), _utc(end)
    rows = []
    for a, b in _chunks(start, end):
        for slot in _get(client, f"intensity/{_stamp(a)}/{_stamp(b)}")["data"]:
            v = slot["intensity"]["actual"]
            v = slot["intensity"]["forecast"] if v is None else v
            if v is not None:
                rows.append({"ts": slot["from"], "value": float(v)})
    cols = schemas.ACTUALS.names
    if not rows:
        return pd.DataFrame(columns=cols).astype({"value": float})
    df = pd.DataFrame(rows)
    df["ts"] = pd.to_datetime(df["ts"], utc=True).dt.floor("h")
    df = df.groupby("ts", as_index=False)["value"].mean()
    df = df[(df["ts"] >= start.floor("h")) & (df["ts"] <= end)]
    df = df.assign(zone="GB", series="ci_gco2_kwh", unit="gCO2/kWh")
    return schemas.validate(df[cols], NATIONAL)


def _client(client):
    if cache.offline():
        raise RuntimeError("LG_OFFLINE is set: Carbon Intensity ingest needs the network")
    return client or httpx.Client(timeout=60, headers={"Accept": "application/json"}), client is None


def fetch(start, end, client: httpx.Client | None = None) -> pd.DataFrame:
    """Ingest-registry entry point: GB national intensity as actuals."""
    client, own = _client(client)
    try:
        return fetch_national(start, end, client)
    finally:
        if own:
            client.close()


def _merge(name: str, new: pd.DataFrame, key: list[str]) -> None:
    if cache.exists(name):
        new = cache.concat([cache.read_file(cache.path(name)), new], ignore_index=True)
    cache.write(name, new.drop_duplicates(key, keep="last").sort_values(key).reset_index(drop=True))


def run(start, end, client: httpx.Client | None = None) -> list[str]:
    client, own = _client(client)
    try:
        slots = regional_slots(start, end, client)
        regional = fetch_regional(start, end, client, slots)
        mix = fetch_regional_mix(start, end, client, slots)
        national = fetch_national(start, end, client)
    finally:
        if own:
            client.close()
    written = []
    if len(regional):
        _merge(REGIONAL, regional, ["ts", "region"])
        written.append(REGIONAL)
    if len(mix):
        _merge(REGIONAL_MIX, mix, ["ts", "region", "fuel"])
        written.append(REGIONAL_MIX)
    if len(national):
        _merge(NATIONAL, national, ["ts", "zone"])
        written.append(NATIONAL)
    return written
