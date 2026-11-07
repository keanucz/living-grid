"""Household savings: what shifting use to cheap half-hours is worth against the Ofgem price cap, against running at 6 pm,
and (if the caller supplies a rate) against a fixed tariff, tonight and month by month from Octopus Agile history.

Prices are the Agile rates in the parquet cache (octopus/agile, pence per kWh as Octopus publishes them). Agile is published
the afternoon before, so choosing the cheapest window of an evening with published prices is not hindsight.
Comparisons use unit rates only; standing charges are the same whichever way the energy is used and are left out.
The cap rate comes from the verified Ofgem fact hh_price_cap_unit_rates and applies to 1 Oct to 31 Dec 2026 only, so
month-by-month cap comparisons exist only for months inside that period; the annual cap figure is a what-if at today's rate.
Device kWh come from verified Energy Saving Trust figures where one exists; everything else is labelled an assumption.

Fetch history with: uv run python -m engine.household_savings --from 2024-01-01
"""

import argparse
import re
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from engine import data
from engine import household as hh
from engine.reference import loader
from pipeline import cache

UK = ZoneInfo("Europe/London")
SLOT = pd.Timedelta(minutes=30)
CAP_FACT = "hh_price_cap_unit_rates"
CAP_PERIOD = (pd.Timestamp("2026-10-01", tz=UK), pd.Timestamp("2027-01-01", tz=UK))
EVENING, MORNING, SIX_PM = 17, 7, 18
MIN_DAYS = 20
BATTERY_KWH, BATTERY_RTE, BATTERY_SLOTS = 10.0, 0.88, 4  # 10 kWh at 5 kW; 88% round trip is the project's battery assumption
HEATING_MONTHS = {10, 11, 12, 1, 2, 3, 4}
EST = "Energy Saving Trust winter guide, November 2022"
MIX_DEFAULT = ("ev", "dishwasher", "washing_machine")


class UnknownDevice(KeyError):
    pass


def _devices() -> dict[str, dict]:
    return {
        "ev": {"label": "Charge your car", "kwh": hh.EV_KW * hh.EV_HOURS, "hours": hh.EV_HOURS, "per_week": 3.0,
               "basis": "assumption: 7 kW home charger for 3 hours, 3 charges a week", "assumption": True},
        "heat_pump": {"label": "Pre-heat with a heat pump", "kwh": 10.0, "hours": 4.0, "per_week": 7.0, "months": HEATING_MONTHS,
                      "basis": "assumption: 2.5 kW for 4 hours a day, October to April", "assumption": True},
        "home_battery": {"label": "Home battery (10 kWh)", "kwh": BATTERY_KWH, "hours": BATTERY_SLOTS / 2, "per_week": 7.0,
                         "basis": "assumption: 10 kWh, 5 kW, 88% round trip, one cycle a day", "assumption": True, "battery": True},
        "dishwasher": {"label": "Run the dishwasher", "kwh": loader.figure("hh_dishwasher_kwh", after="Dishwasher:"), "hours": 1.0,
                       "per_week": 5.0, "basis": f"{EST}: 0.9 kWh a cycle; 5 cycles a week and 1 hour are assumptions",
                       "assumption": False},
        "washing_machine": {"label": "Run the washing machine", "kwh": loader.figure("hh_dishwasher_kwh", after="washing machine:"),
                            "hours": 1.0, "per_week": 4.0, "basis": f"{EST}: 0.5 kWh a load; 4 loads a week and 1 hour are assumptions",
                            "assumption": False},
        "tumble_dryer": {"label": "Run the tumble dryer", "kwh": loader.figure("hh_tumble_dryer_kwh"), "hours": 1.5, "per_week": 3.0,
                         "basis": f"{EST}: 3 kWh a load; 3 loads a week and 1.5 hours are assumptions", "assumption": False},
    }


DEVICES = tuple(_devices())


def cap_rate(region: str) -> float:
    m = re.search(rf"(?:^|[;.] ){re.escape(region)} [^:]+: (\d+\.\d+)", loader.fact(CAP_FACT)["value"])
    if not m:
        raise hh.UnknownRegion(region)
    return float(m.group(1))


def cap_info(region: str) -> dict:
    f = loader.fact(CAP_FACT)
    return {"p_kwh": cap_rate(region), "period": "1 October to 31 December 2026, Direct Debit, single-rate meter, no VAT on electricity",
            "source": "Ofgem energy price cap tables, period 17a: " + f["sources"][0]["url"]}


def _local(ts: pd.Series | pd.DatetimeIndex):
    return ts.dt.tz_convert(UK) if isinstance(ts, pd.Series) else ts.tz_convert(UK)


def history(region: str) -> pd.Series:
    """Half-hourly Agile p/kWh for a region on a complete UTC grid (NaN where Octopus has no rate)."""
    try:
        df = cache.read("octopus/agile")
    except FileNotFoundError:
        return pd.Series(dtype=float)
    df = df[df["region"] == region].sort_values("fetched_at").drop_duplicates("ts", keep="last")
    if df.empty:
        return pd.Series(dtype=float)
    s = df.set_index("ts")["p_kwh"].sort_index()
    return s.reindex(pd.date_range(s.index.min(), s.index.max(), freq=SLOT))


def _bounds(day: pd.Timestamp, h0: int, next_day: bool, h1: int) -> tuple[pd.Timestamp, pd.Timestamp]:
    a = pd.Timestamp(day.year, day.month, day.day, h0, tz=UK)
    b = pd.Timestamp(day.year, day.month, day.day, h1, tz=UK) + (pd.Timedelta(days=1) if next_day else pd.Timedelta(0))
    return a.tz_convert("UTC"), b.tz_convert("UTC")


def _slice(s: pd.Series, a: pd.Timestamp, b: pd.Timestamp) -> np.ndarray | None:
    i, j = s.index.searchsorted(a), s.index.searchsorted(b)
    v = s.to_numpy()[i:j]
    ok = len(v) == round((b - a) / SLOT) and not np.isnan(v).any()
    return v if ok else None


def _shift_day(v: np.ndarray, n: int, six_pm_idx: int) -> tuple[float, float]:
    """(mean p/kWh of the cheapest n-slot window, mean p/kWh of the n slots from 6 pm)."""
    c = np.concatenate([[0.0], np.cumsum(v)])
    means = (c[n:] - c[:-n]) / n
    return float(means.min()), float(means[six_pm_idx])


def _battery_day(day_v: np.ndarray, charge_a: int, charge_b: int, dis_a: int, dis_b: int) -> tuple[float, float]:
    """(average p/kWh of the cheapest charging slots, of the dearest discharging slots)."""
    ch = np.sort(day_v[charge_a:charge_b])[:BATTERY_SLOTS].mean()
    di = np.sort(day_v[dis_a:dis_b])[-BATTERY_SLOTS:].mean()
    return float(ch), float(di)


def daily(s: pd.Series, spec: dict) -> pd.DataFrame:
    """Per local day: £ per use on Agile at the best window, at 6 pm, and the best-window average p/kWh."""
    if s.empty:
        return pd.DataFrame(columns=["day", "best_gbp", "six_gbp"])
    days = pd.date_range(s.index.min().tz_convert(UK).normalize().tz_localize(None), s.index.max().tz_convert(UK).tz_localize(None), freq="D")
    rows = []
    n = round(spec["hours"] * 2)
    for d in days:
        if spec.get("battery"):
            a, b = _bounds(d, 0, True, 0)
            v = _slice(s, a, b)
            if v is None or len(v) != 48:
                continue
            ch, di = _battery_day(v, 0, 32, 32, 44)
            rows.append((d, max(0.0, (di - ch / BATTERY_RTE)) * spec["kwh"] / 100, np.nan, ch, di))
            continue
        a, b = _bounds(d, EVENING, True, MORNING)
        v = _slice(s, a, b)
        if v is None:
            continue
        six = round((_bounds(d, SIX_PM, False, SIX_PM)[0] - a) / SLOT)
        best, at_six = _shift_day(v, n, six)
        rows.append((d, best * spec["kwh"] / 100, at_six * spec["kwh"] / 100, best, at_six))
    return pd.DataFrame(rows, columns=["day", "best_gbp", "six_gbp", "best_p", "six_p"])


def monthly(s: pd.Series, key: str, spec: dict, cap_p: float) -> pd.DataFrame:
    """Per UK month: what the device mix's use costs shifted, and the savings, with usage scaled to the whole month."""
    d = daily(s, spec)
    if d.empty:
        return pd.DataFrame()
    d["month"] = d["day"].dt.to_period("M")
    d = d[d["month"].dt.month.isin(spec.get("months", range(1, 13)))]
    out = []
    for m, g in d.groupby("month"):
        uses = m.days_in_month * spec["per_week"] / 7
        if spec.get("battery"):
            cost = g["best_gbp"].mean() * uses
            save_six = cost
            baseline_cap = (cap_p * spec["kwh"] / 100) * uses
            save_cap = None
            agile = float("nan")
            if CAP_PERIOD[0] <= m.start_time.tz_localize(UK) < CAP_PERIOD[1]:
                charge_cost = (g["best_p"].mean() / BATTERY_RTE) * spec["kwh"] / 100 * uses
                save_cap = baseline_cap - charge_cost
                agile = charge_cost
            out.append((str(m), len(g), save_six, save_cap, agile))
            continue
        agile = g["best_gbp"].mean() * uses
        save_six = (g["six_gbp"] - g["best_gbp"]).mean() * uses
        in_cap = CAP_PERIOD[0] <= m.start_time.tz_localize(UK) < CAP_PERIOD[1]
        save_cap = (cap_p * spec["kwh"] / 100 * uses - agile) if in_cap else None
        out.append((str(m), len(g), save_six, save_cap, agile))
    return pd.DataFrame(out, columns=["month", "days", "save_six", "save_cap", "agile"])


def monthly_mix(region: str, keys: list[str], specs: dict) -> list[dict]:
    s = history(region)
    cap_p = cap_rate(region)
    frames = [monthly(s, k, specs[k], cap_p) for k in keys]
    frames = [f.set_index("month") for f in frames if not f.empty]
    if not frames:
        return []
    months = sorted(set().union(*[f.index for f in frames]))
    out = []
    for m in months:
        parts = [f.loc[m] for f in frames if m in f.index]
        days = int(min(p["days"] for p in parts))
        caps = [p["save_cap"] for p in parts]
        out.append({
            "month": m, "days": days, "partial": days < MIN_DAYS,
            "saving_vs_6pm_gbp": float(sum(p["save_six"] for p in parts)),
            "saving_vs_cap_gbp": None if any(c is None or pd.isna(c) for c in caps) else float(sum(caps)),
            "agile_cost_gbp": float(np.nansum([p["agile"] for p in parts])),
        })
    return out


def annual(months: list[dict], cap_p: float, keys: list[str], specs: dict) -> dict | None:
    full = [m for m in months if not m["partial"]]
    if not full:
        return None
    save = np.array([m["saving_vs_6pm_gbp"] for m in full]) * 12
    result = {"months_used": len(full), "saving_vs_6pm_gbp": {"low": float(save.min()), "mean": float(save.mean()), "high": float(save.max())},
              "saving_vs_cap_today_gbp": None}
    if any(specs[k].get("battery") for k in keys):
        return result
    cap_yr = []
    for m in full:
        agile = m["agile_cost_gbp"]
        kwh = sum(specs[k]["kwh"] * specs[k]["per_week"] / 7 * pd.Period(m["month"]).days_in_month for k in keys
                  if pd.Period(m["month"]).month in specs[k].get("months", range(1, 13)))
        cap_yr.append((cap_p * kwh / 100 - agile) * 12)
    if len(cap_yr) == len(full) and all(np.isfinite(cap_yr)):
        a = np.array(cap_yr)
        result["saving_vs_cap_today_gbp"] = {"low": float(a.min()), "mean": float(a.mean()), "high": float(a.max())}
    return result


def tonight(region: str, keys: list[str], specs: dict, fixed: float | None, now: pd.Timestamp) -> list[dict]:
    cap_p = cap_rate(region)
    start, end = hh.tonight(now)
    table = hh.price_table(region, now, now.floor(SLOT), max(end, now.floor(SLOT) + pd.Timedelta(hours=hh.HORIZON_H)))
    six = max(start, pd.Timestamp(_bounds(now.tz_convert(UK).normalize().tz_localize(None), SIX_PM, False, SIX_PM)[0]))
    if now.tz_convert(UK).hour < MORNING:
        six = start
    out = []
    for k in keys:
        spec = specs[k]
        if spec.get("battery"):
            continue
        n = round(spec["hours"] * 2)
        slots = pd.date_range(start, end - SLOT, freq=SLOT)
        best = None
        for i in range(len(slots) - n + 1):
            w = slots[i:i + n]
            if w.isin(table.index).all():
                avg = table.loc[w, list(hh.QUANTILES)].mean()
                if best is None or avg["p50"] < best[1]["p50"]:
                    best = (w, avg)
        sw = pd.date_range(six, periods=n, freq=SLOT)
        if best is None or not sw.isin(table.index).all():
            continue
        w, avg = best
        base = table.loc[sw, list(hh.QUANTILES)].mean()
        pounds = spec["kwh"] / 100

        def q(vals):
            v = np.sort(np.asarray(vals, dtype=float))
            return dict(zip(hh.QUANTILES, (float(x) for x in v), strict=True))

        kind = "actual" if (table.loc[w, "kind"] == "actual").all() and (table.loc[sw, "kind"] == "actual").all() else "forecast"
        out.append({
            "device": k, "label": spec["label"], "start": w[0].to_pydatetime(), "end": (w[-1] + SLOT).to_pydatetime(), "kind": kind,
            "cost_gbp": q([avg[c] * pounds for c in hh.QUANTILES]),
            "saving_vs_cap_gbp": q([(cap_p - avg[c]) * pounds for c in hh.QUANTILES]),
            "saving_vs_6pm_gbp": q([(base[c] - avg[c]) * pounds for c in hh.QUANTILES]),
            "saving_vs_fixed_gbp": None if fixed is None else q([(fixed - avg[c]) * pounds for c in hh.QUANTILES]),
        })
    return out


def build(region: str, keys: list[str] | None = None, fixed_p_kwh: float | None = None, now: datetime | None = None) -> dict:
    names = hh.regions()
    if region not in names:
        raise hh.UnknownRegion(region)
    specs = _devices()
    keys = list(keys or MIX_DEFAULT)
    for k in keys:
        if k not in specs:
            raise UnknownDevice(k)
    t = data.as_utc(now if now is not None else hh.clock())
    cap_p = cap_rate(region)
    months = monthly_mix(region, keys, specs)
    s = history(region)
    note = (
        "Unit rates only: standing charges are the same however you use the energy. Agile rates are Octopus's published half-hourly "
        "prices; tonight's later hours use our GB day-ahead forecast through the Agile formula and are labelled forecast. "
        f"The cap rate is Ofgem's for 1 October to 31 December 2026 ({cap_p:g}p/kWh in {names[region]}), so cap comparisons by month "
        "exist only for months inside that period and the annual cap figure assumes the whole year had been billed at that rate. "
        "No typical fixed tariff rate is verified, so a fixed comparison appears only if you supply fixed_p_kwh. "
        "Monthly savings take each day's best window against starting at 6 pm, scaled to the usage shown; months with under "
        f"{MIN_DAYS} days of prices are marked partial and left out of the range. Device usage marked assumption is ours."
    )
    return {
        "region": region, "name": names[region], "generated_at": t.to_pydatetime(), "cap": cap_info(region),
        "fixed_p_kwh": fixed_p_kwh,
        "devices": [{"device": k, "label": specs[k]["label"], "kwh_per_use": specs[k]["kwh"], "uses_per_week": specs[k]["per_week"],
                     "hours": specs[k]["hours"], "basis": specs[k]["basis"], "assumption": specs[k]["assumption"]} for k in keys],
        "tonight": tonight(region, keys, specs, fixed_p_kwh, t), "months": months,
        "annual": annual(months, cap_p, keys, specs),
        "history_from": None if s.empty else s.index.min().to_pydatetime(),
        "history_to": None if s.empty else s.index.max().to_pydatetime(), "note": note,
    }


def main() -> None:
    from pipeline.ingest import octopus

    ap = argparse.ArgumentParser(description="Backfill the Agile cache in 60-day chunks")
    ap.add_argument("--from", dest="start", default="2024-01-01")
    ap.add_argument("--to", dest="end", default=None)
    a = ap.parse_args()
    end = pd.Timestamp(a.end, tz="UTC") if a.end else pd.Timestamp.now(tz="UTC").ceil("D") + pd.Timedelta(days=1)
    cur = pd.Timestamp(a.start, tz="UTC")
    while cur < end:
        nxt = min(cur + pd.Timedelta(days=60), end)
        octopus.run(cur, nxt)
        print("fetched", cur.date(), nxt.date(), flush=True)
        cur = nxt


if __name__ == "__main__":
    main()
