"""Metered output per mapped wind BM unit (the metered side of ghost wind estimate 2).

Source: Elexon B1610 actual generation per BM unit (MWh per half hour, settlement run priority DF > RF > R3 > R2 >
R1 > SF > II). It lags by about five days, so the newest days are filled from Physical Notifications (PN), which are
the generator's planned MW levels, not meter readings: those rows say source=PN and never replace B1610 values.
Units are the wind units in /reference/bmunits/all whose stem is in data/static/wind_farms.csv (hand-mapped Scottish
farms). B1610 is net metered output, so small negative values at calm hours are real (station load) and are kept.
An hour needs both half hours (B1610) or full coverage (PN) to be written.

Output: data/boalf/wind_metered.parquet  ts (hour, UTC), bm_unit (national grid id, e.g. VKNGW-1), mwh, source
"""

import time

import httpx
import pandas as pd

from pipeline import cache, static

BASE = "https://data.elexon.co.uk/bmrs/api/v1"
NAME = "boalf/wind_metered"
COLUMNS = ["ts", "bm_unit", "mwh", "source"]
RUN_PRIORITY = ["DF", "RF", "R3", "R2", "R1", "SF", "II"]
WINDOW_DAYS = 7
BATCH = 25
FULL_HOUR_MINUTES = 59


def _get(client: httpx.Client, path: str, params: list[tuple[str, str]]):
    for attempt in range(4):
        r = client.get(f"{BASE}/{path}", params=[*params, ("format", "json")])
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(float(r.headers.get("Retry-After", 2**attempt)))
            continue
        r.raise_for_status()
        return r.json()
    r.raise_for_status()


def mapped_units(client: httpx.Client) -> pd.DataFrame:
    """bm_unit (national grid id) and elexon_bm_unit (the id the data endpoints take) for the hand-mapped farms."""
    ref = pd.DataFrame(_get(client, "reference/bmunits/all", []))
    ref = ref[ref["fuelType"] == "WIND"]
    stems = set(static.wind_farms()["bm_unit"])
    keep = ref["nationalGridBmUnit"].str.rsplit("-", n=1).str[0].isin(stems)
    out = ref[keep][["nationalGridBmUnit", "elexonBmUnit"]]
    out.columns = ["bm_unit", "elexon_bm_unit"]
    return out.drop_duplicates("bm_unit").reset_index(drop=True)


def _windows(start: pd.Timestamp, end: pd.Timestamp):
    t = start
    while t < end:
        nxt = min(t + pd.Timedelta(days=WINDOW_DAYS), end)
        yield t, nxt
        t = nxt


def _stream(client, dataset: str, units: pd.DataFrame, start, end) -> list[dict]:
    rows = []
    ids = list(units["elexon_bm_unit"])
    for a, b in _windows(start, end):
        for i in range(0, len(ids), BATCH):
            params = [("from", f"{a:%Y-%m-%dT%H:%MZ}"), ("to", f"{b:%Y-%m-%dT%H:%MZ}")]
            params += [("bmUnit", u) for u in ids[i : i + BATCH]]
            rows += _get(client, f"datasets/{dataset}/stream", params)
    return rows


def hourly_b1610(rows: list[dict], start, end) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame(columns=COLUMNS)
    df = pd.DataFrame(rows)
    df["rank"] = df["settlementRunType"].map({r: i for i, r in enumerate(RUN_PRIORITY)}).fillna(len(RUN_PRIORITY))
    df["period_start"] = pd.to_datetime(df["halfHourEndTime"], utc=True) - pd.Timedelta(minutes=30)
    df = df.sort_values("rank").drop_duplicates(["nationalGridBmUnitId", "period_start"], keep="first")
    df["ts"] = df["period_start"].dt.floor("h")
    g = df.groupby(["ts", "nationalGridBmUnitId"], as_index=False).agg(mwh=("quantity", "sum"), halves=("quantity", "size"))
    g = g[g["halves"] == 2].rename(columns={"nationalGridBmUnitId": "bm_unit"})
    g = g[(g["ts"] >= start.floor("h")) & (g["ts"] < end)]
    return g.assign(mwh=g["mwh"].astype(float), source="B1610")[COLUMNS].reset_index(drop=True)


def hourly_pn(rows: list[dict], start, end) -> pd.DataFrame:
    """Integrate planned MW levels (linear between timeFrom and timeTo) into MWh per hour."""
    if not rows:
        return pd.DataFrame(columns=COLUMNS)
    df = pd.DataFrame(rows).drop_duplicates(["nationalGridBmUnit", "timeFrom", "timeTo"])
    df["t0"], df["t1"] = pd.to_datetime(df["timeFrom"], utc=True), pd.to_datetime(df["timeTo"], utc=True)
    df = df[df["t1"] > df["t0"]]
    out = []
    for hour in pd.date_range(start.floor("h"), end - pd.Timedelta(hours=1), freq="h"):
        h1 = hour + pd.Timedelta(hours=1)
        seg = df[(df["t1"] > hour) & (df["t0"] < h1)]
        if seg.empty:
            continue
        a, b = seg["t0"].clip(lower=hour), seg["t1"].clip(upper=h1)
        span = (seg["t1"] - seg["t0"]).dt.total_seconds()
        frac0, frac1 = (a - seg["t0"]).dt.total_seconds() / span, (b - seg["t0"]).dt.total_seconds() / span
        lf, lt = seg["levelFrom"].astype(float), seg["levelTo"].astype(float)
        l0, l1 = lf + (lt - lf) * frac0, lf + (lt - lf) * frac1
        seg = seg.assign(mwh=(l0 + l1) / 2 * (b - a).dt.total_seconds() / 3600, minutes=(b - a).dt.total_seconds() / 60)
        g = seg.groupby("nationalGridBmUnit").agg(mwh=("mwh", "sum"), minutes=("minutes", "sum"))
        g = g[g["minutes"] >= FULL_HOUR_MINUTES]
        out.append(pd.DataFrame({"ts": hour, "bm_unit": g.index, "mwh": g["mwh"].to_numpy(), "source": "PN"}))
    return pd.concat(out, ignore_index=True)[COLUMNS] if out else pd.DataFrame(columns=COLUMNS)


def combine(*frames: pd.DataFrame) -> pd.DataFrame:
    """Metered B1610 beats planned PN for the same unit-hour; within a source the later frame wins."""
    df = pd.concat([f for f in frames if len(f)], ignore_index=True) if any(len(f) for f in frames) else pd.DataFrame(columns=COLUMNS)
    if df.empty:
        return df[COLUMNS]
    df["pri"] = (df["source"] != "B1610").astype(int)
    df = df.iloc[::-1].sort_values("pri", kind="stable").drop_duplicates(["ts", "bm_unit"], keep="first")
    return df.sort_values(["ts", "bm_unit"])[COLUMNS].reset_index(drop=True)


def fetch(start, end, client: httpx.Client | None = None) -> pd.DataFrame:
    """Hourly MWh per mapped wind unit for start <= ts < end, B1610 where settled and PN for the newest hours."""
    if cache.offline():
        raise RuntimeError("LG_OFFLINE is set: metered output ingest needs the network")
    start, end = pd.Timestamp(start), pd.Timestamp(end)
    start = start.tz_localize("UTC") if start.tzinfo is None else start.tz_convert("UTC")
    end = end.tz_localize("UTC") if end.tzinfo is None else end.tz_convert("UTC")
    own = client is None
    client = client or httpx.Client(timeout=90)
    try:
        units = mapped_units(client)
        metered = hourly_b1610(_stream(client, "B1610", units, start, end), start, end)
        have = set(zip(metered["ts"], metered["bm_unit"], strict=True))
        gap_start = start if metered.empty else max(start, metered["ts"].max().floor("D"))
        planned = pd.DataFrame(columns=COLUMNS)
        if gap_start < end:
            planned = hourly_pn(_stream(client, "PN", units, gap_start, end), gap_start, end)
            planned = planned[[(t, u) not in have for t, u in zip(planned["ts"], planned["bm_unit"], strict=True)]]
    finally:
        if own:
            client.close()
    return combine(planned, metered)


def run(start, end) -> list[str]:
    new = fetch(start, end)
    old = pd.read_parquet(cache.path(NAME)) if cache.exists(NAME) else pd.DataFrame(columns=COLUMNS)
    cache.write(NAME, combine(old, new))
    return [NAME]
