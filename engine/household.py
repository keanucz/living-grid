"""Household advice: the best evening windows to run an EV charge or a dishwasher, with the saving and its uncertainty.

Prices are Octopus Agile in pence per kWh including VAT. Published rates (data/octopus/agile.parquet, region letter)
are used where they exist; beyond them the price is rebuilt from our GB day-ahead forecast with the published Agile
formula min(D x W + P, 95) x 1.05, where W is the wholesale price in p/kWh, P applies 16:00 to 19:00 UK time, and D and P
come from the verified reference fact for the region. That is an approximation of Agile, labelled as a forecast.
Agile is a retail tariff, so it includes network charges and is not a congestion signal.
Saving is against starting at the beginning of tonight (now, or 17:00 UK if earlier). The range comes from the
forecast's own P10 to P90 band applied to the window and to the baseline together (perfectly correlated), so
it is a plausible range, not a probability.
"""

import re
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from engine import data
from engine.reference import loader
from pipeline import cache, static

UK = ZoneInfo("Europe/London")
SLOT = pd.Timedelta(minutes=30)
VAT = 1.05
CAP_BEFORE_VAT = 95.0
PEAK_START, PEAK_END = 16, 19
EVENING_START, MORNING_END = 17, 7
HORIZON_H = 24
TABLE_NAMES = {
    "A": "East England", "B": "East Midlands", "C": "London", "D": "Merseyside & Northern Wales",
    "E": "West Midlands", "F": "North East England", "G": "North West England", "H": "South England",
    "J": "South East England", "K": "South Wales", "L": "South West England", "M": "Yorkshire",
    "N": "South Scotland", "P": "North Scotland",
}
EV_KW, EV_HOURS = 7.0, 3.0  # a 7 kW home charger for 3 h: an assumption, no verified source
QUANTILES = ("p10", "p50", "p90")


class UnknownRegion(KeyError):
    pass


def regions() -> dict[str, str]:
    keys = static.gb_region_keys()
    return dict(zip(keys["region"], keys["name"], strict=True))


def formula(region: str) -> tuple[float, float]:
    """(D, P) for a region from the verified Agile fact."""
    text = loader.fact("hh_agile_formula")["value"]
    name = re.escape(TABLE_NAMES[region])
    m = re.search(rf"{name}: D “([\d.]+)”, P “([\d.]+)”", text)
    if not m:
        raise ValueError(f"no Agile D and P for {region} in the reference fact")
    return float(m.group(1)), float(m.group(2))


def dishwasher_kwh() -> float:
    return loader.figure("hh_dishwasher_kwh", after="Dishwasher:")


def tasks() -> list[dict]:
    return [
        {"task": "ev", "label": "Charge your car", "hours": EV_HOURS, "kwh": EV_KW * EV_HOURS},
        {"task": "dishwasher", "label": "Run the dishwasher", "hours": 1.0, "kwh": dishwasher_kwh()},
    ]


def agile_from_wholesale(gbp_per_mwh: np.ndarray, ts: pd.DatetimeIndex, d: float, p: float) -> np.ndarray:
    w = np.asarray(gbp_per_mwh, dtype=float) / 10
    local_hour = ts.tz_convert(UK).hour + ts.tz_convert(UK).minute / 60
    peak = (local_hour >= PEAK_START) & (local_hour < PEAK_END)
    return np.minimum(d * w + np.where(peak, p, 0.0), CAP_BEFORE_VAT) * VAT


def published(region: str, start: pd.Timestamp, end: pd.Timestamp) -> pd.Series:
    try:
        df = cache.read("octopus/agile")
    except FileNotFoundError:
        return pd.Series(dtype=float)
    df = df[(df["region"] == region) & (df["ts"] >= start) & (df["ts"] < end)]
    return df.sort_values("fetched_at").drop_duplicates("ts", keep="last").set_index("ts")["p_kwh"].sort_index()


def forecast_wholesale(now: pd.Timestamp, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    """Half-hourly GB day-ahead p10/p50/p90 in GBP/MWh from forecasts made by `now` (hourly values repeated)."""
    f = data.forecast_log()
    f = f[(f["zone"] == "GB") & (f["target"] == "price_da") & (f["made_at"] <= now)]
    f = f[(f["ts"] >= start.floor("h")) & (f["ts"] < end)]
    if f.empty:
        return pd.DataFrame(columns=list(QUANTILES))
    f = f.sort_values("made_at").drop_duplicates("ts", keep="last").set_index("ts")[list(QUANTILES)].sort_index()
    half = pd.date_range(f.index.min(), f.index.max() + pd.Timedelta(minutes=30), freq=SLOT)
    return f.reindex(half, method="ffill").loc[lambda x: (x.index >= start) & (x.index < end)]


def price_table(region: str, now: pd.Timestamp, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    """Per half-hour p10/p50/p90 in p/kWh and kind (actual or forecast); published values have no spread."""
    slots = pd.date_range(start, end - SLOT, freq=SLOT)
    out = pd.DataFrame(index=slots, columns=[*QUANTILES, "kind"], dtype=object)
    pub = published(region, start, end)
    d, p = formula(region)
    fc = forecast_wholesale(now, start, end)
    if len(fc):
        q = np.column_stack([agile_from_wholesale(fc[c].to_numpy(), fc.index, d, p) for c in QUANTILES])
        q.sort(axis=1)
        out.loc[fc.index, list(QUANTILES)] = q
        out.loc[fc.index, "kind"] = "forecast"
    for ts, v in pub.items():
        if ts in out.index:
            out.loc[ts, list(QUANTILES)] = [v, v, v]
            out.loc[ts, "kind"] = "actual"
    return out.dropna(subset=["kind"]).astype({c: float for c in QUANTILES})


def tonight(now: pd.Timestamp) -> tuple[pd.Timestamp, pd.Timestamp]:
    """Baseline start (now, or 17:00 UK if that is later) and the end of the search at 07:00 UK next morning."""
    local = now.tz_convert(UK)
    five = local.normalize().replace(hour=EVENING_START)
    if local.hour < MORNING_END:
        five -= pd.Timedelta(days=1)
    start = max(now.ceil(SLOT), five.tz_convert("UTC"))
    morning = (five + pd.Timedelta(days=1)).replace(hour=MORNING_END)
    return start, morning.tz_convert("UTC")


def best_windows(table: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp, task: dict) -> dict | None:
    n = round(task["hours"] * 2)
    slots = pd.date_range(start, end - SLOT, freq=SLOT)
    best = base = None
    for i in range(len(slots) - n + 1):
        w = slots[i : i + n]
        if not w.isin(table.index).all():
            continue
        avg = table.loc[w, list(QUANTILES)].mean()
        if i == 0:
            base = (w, avg)
        if best is None or avg["p50"] < best[1]["p50"]:
            best = (w, avg)
    if best is None or base is None:
        return None
    w, avg = best
    bw, bavg = base
    saving = np.sort([(bavg[q] - avg[q]) * task["kwh"] / 100 for q in QUANTILES])
    kind = "actual" if (table.loc[w, "kind"] == "actual").all() and (table.loc[bw, "kind"] == "actual").all() else "forecast"
    if kind == "actual":
        saving = np.full(3, saving[1])
    return {
        "task": task["task"], "label": task["label"], "start": w[0].to_pydatetime(),
        "end": (w[-1] + SLOT).to_pydatetime(), "avg_p_kwh": float(avg["p50"]),
        "saving_gbp": dict(zip(QUANTILES, (float(x) for x in saving), strict=True)), "kind": kind,
    }


def clock() -> pd.Timestamp:
    return pd.Timestamp.now(tz="UTC")


def build(region: str, now: datetime | None = None) -> dict:
    names = regions()
    if region not in names:
        raise UnknownRegion(region)
    t = data.as_utc(now if now is not None else clock())
    start, end = tonight(t)
    table = price_table(region, t, t.floor(SLOT), max(end, t.floor(SLOT) + pd.Timedelta(hours=HORIZON_H)))
    windows = [w for task in tasks() if (w := best_windows(table, start, end, task))]
    prices = [
        {"ts": ts.to_pydatetime(), "p_kwh": float(r["p50"]), "p10": None if r["kind"] == "actual" else float(r["p10"]),
         "p90": None if r["kind"] == "actual" else float(r["p90"]), "kind": r["kind"]}
        for ts, r in table.iterrows()
    ]
    d, p = formula(region)
    note = (
        "Agile prices in pence per kWh including VAT. Published rates are used where Octopus has released them; beyond "
        f"those the price is estimated from our GB day-ahead forecast with the Agile formula (D {d:g}, peak add-on {p:g}p "
        "from 4pm to 7pm). The estimate approximates Agile and the saving range is the forecast's P10 to P90 band, "
        f"not a guarantee. Dishwasher {dishwasher_kwh():g} kWh a cycle (Energy Saving Trust guide). Car charge is an "
        f"assumption: a {EV_KW:g} kW charger for {EV_HOURS:g} hours."
    )
    if not windows:
        note += " No prices cover tonight yet, so no windows are shown."
    return {"region": region, "name": names[region], "generated_at": t.to_pydatetime(), "windows": windows,
            "prices": prices, "note": note}
