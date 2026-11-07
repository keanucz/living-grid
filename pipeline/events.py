"""Event library: the big days in our own data, each with numbers, timed moments and a narration script.

    uv run python -m pipeline.events build [--data DIR]    # write data/events/<slug>.json and index.json from the cache
    uv run python -m pipeline.events check                 # validate every committed bundle

Every event date comes from a detector run over the cached actuals (the peak, the deepest dip, the longest outage), not
from a remembered date, and `build` refuses to write a bundle when the data does not support the claim. Figures in the
key numbers, moments and script are computed from the same series the bundle carries, so a viewer can check them.
The script says what the data shows; it does not guess at causes the data cannot show.

Each bundle carries hourly series for the window (daily for the gas crisis) for playback. The replay entry says whether an as-of
forecast replay exists (engine.replay needs a model trained before the date) and gives the command that makes one.
All timestamps are UTC.
"""

import argparse
import json
import logging
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import pandas as pd

from pipeline import cache

log = logging.getLogger("pipeline.events")

OUT_DIR = cache.ROOT / "data" / "events"
HOURLY_CONTEXT = pd.Timedelta(days=3)
RECENT_FACT = "con_2026_10_26_cost"


class NotConfirmed(RuntimeError):
    pass


def out_dir() -> Path:
    return OUT_DIR


def read_actuals() -> pd.DataFrame:
    """Every cached actual, long format ts/zone/series/value/source; committed fixtures too when offline."""
    bases = [cache.DATA / "actuals"] + ([cache.FIXTURES / "actuals"] if cache.offline() else [])
    parts, seen = [], set()
    for base in bases:
        for p in sorted(base.glob("*.parquet")) if base.is_dir() else []:
            if p.stem in seen:
                continue
            seen.add(p.stem)
            df = cache.read_file(p)
            if len(df):
                src = p.stem.split("_", 1)[0]
                parts.append(df[["ts", "zone", "series", "value"]].assign(source=src))
    if not parts:
        return pd.DataFrame(columns=["ts", "zone", "series", "value", "source"])
    return cache.concat(parts, ignore_index=True)


def read_markets() -> pd.DataFrame:
    try:
        return cache.read("markets/gas_carbon")
    except FileNotFoundError:
        return pd.DataFrame(columns=["ts", "series", "value"])


def read_constraint_costs() -> pd.DataFrame:
    try:
        return cache.read("neso/constraint_costs")
    except FileNotFoundError:
        return pd.DataFrame(columns=["date", "total_cost_gbp"])


@dataclass
class Data:
    actuals: pd.DataFrame
    markets: pd.DataFrame
    costs: pd.DataFrame
    _cache: dict = field(default_factory=dict)

    def hourly(self, zone: str, series: str, source: str | None = None) -> pd.Series:
        key = (zone, series, source)
        if key not in self._cache:
            a = self.actuals
            a = a[(a["zone"] == zone) & (a["series"] == series)]
            if source:
                a = a[a["source"] == source]
            self._cache[key] = (a.assign(ts=pd.to_datetime(a["ts"], utc=True).dt.floor("h")).groupby("ts")["value"].mean().sort_index()
                                if len(a) else pd.Series(dtype=float))
        return self._cache[key]

    def daily_market(self, series: str) -> pd.Series:
        m = self.markets[self.markets["series"] == series]
        return m.assign(ts=pd.to_datetime(m["ts"], utc=True).dt.floor("D")).groupby("ts")["value"].last().sort_index()


def load() -> Data:
    return Data(read_actuals(), read_markets(), read_constraint_costs())


# ---------- formatting ----------

def ts_text(t: pd.Timestamp) -> str:
    return f"{t:%-d %B %Y, %H:%M} UTC"


def day_text(t: pd.Timestamp) -> str:
    return f"{t:%-d %B %Y}"


def money(v: float, cur: str) -> str:
    sym = {"GBP": "£", "EUR": "€"}[cur]
    dp = 2 if abs(v) < 10 and v != round(v) else 0
    return f"-{sym}{abs(v):,.{dp}f}" if v < 0 else f"{sym}{v:,.{dp}f}"


def gw(mw: float) -> str:
    return f"{mw / 1000:.1f} GW"


@dataclass
class SeriesSpec:
    key: str
    label: str
    unit: str
    zone: str
    series: str
    source: str | None = None


def window_series(d: Data, specs: list[SeriesSpec], start: pd.Timestamp, end: pd.Timestamp) -> list[dict]:
    out = []
    for s in specs:
        v = d.hourly(s.zone, s.series, s.source)
        v = v[(v.index >= start) & (v.index < end)]
        out.append({"key": s.key, "label": s.label, "unit": s.unit, "zone": s.zone, "series": s.series,
                    "points": [[t.isoformat(), round(float(x), 2)] for t, x in v.items()]})
    return out


def peak(s: pd.Series, lo: pd.Timestamp, hi: pd.Timestamp, low: bool = False) -> tuple[pd.Timestamp, float]:
    w = s[(s.index >= lo) & (s.index < hi)]
    if w.empty:
        raise NotConfirmed("no data in the window")
    t = w.idxmin() if low else w.idxmax()
    return t, float(w[t])


def moment(t: pd.Timestamp, label: str, text: str) -> dict:
    return {"ts": t.isoformat(), "label": label, "text": text}


@dataclass
class Event:
    slug: str
    title: str
    kind: str
    resolution: str
    start: pd.Timestamp
    end: pd.Timestamp
    headline: str
    key_numbers: list[dict]
    moments: list[dict]
    script: list[str]
    series: list[dict]
    sources: list[str]
    caveats: list[str]
    confirmed_by: str
    focus: date | None = None


def number(label: str, value: float, unit: str, source: str, note: str | None = None) -> dict:
    return {"label": label, "value": round(float(value), 2), "unit": unit, "source": source, **({"note": note} if note else {})}


# ---------- detectors and builders ----------

def storm(d: Data) -> Event:
    c = d.costs
    if c.empty:
        raise NotConfirmed("no NESO constraint costs cached")
    c = c.assign(date=pd.to_datetime(c["date"].astype(str)))
    row = c.loc[c["total_cost_gbp"].idxmax()]
    day = pd.Timestamp(row["date"], tz="UTC")
    cost = float(row["total_cost_gbp"])
    prev = c[c["date"] == row["date"] - pd.Timedelta(days=1)]
    lo, hi = day - pd.Timedelta(days=2), day + pd.Timedelta(days=2)
    wind, price, bids = d.hourly("GB", "gen_wind", "elexon"), d.hourly("GB", "system_price", "elexon"), d.hourly("GB", "boalf_mwh")
    tw, vw = peak(wind, day, day + pd.Timedelta(days=1))
    tp, vp = peak(price, day, day + pd.Timedelta(days=1))
    tb, vb = peak(bids, day, day + pd.Timedelta(days=1))
    bid_gwh = float(bids[(bids.index >= day) & (bids.index < day + pd.Timedelta(days=1))].sum()) / 1000
    mean_price = float(price[(price.index >= day) & (price.index < day + pd.Timedelta(days=1))].mean())
    quiet = price[(price.index >= lo) & (price.index < day)].mean()
    keys = [number("NESO constraint cost, the day", cost, "GBP", "NESO data portal, daily constraint costs"),
            number("Peak GB wind output", vw, "MW", "Elexon FUELHH, hourly mean"),
            number("Accepted turn-down bids, the day", bid_gwh, "GWh", "Elexon BOALF accepted bids, every unit, summed over the day"),
            number("GB system price, the day's mean", mean_price, "GBP/MWh", "Elexon system price")]
    moms = [moment(tw, "Wind peaks", f"GB wind reaches {gw(vw)}, the day's highest hour."),
            moment(tb, "Most turn-down bids accepted", f"Accepted bids to turn generation down peak at {vb:,.0f} MWh in the hour."),
            moment(tp, "Price peak", f"The GB system price peaks at {money(vp, 'GBP')}/MWh.")]
    if len(prev):
        moms.insert(0, moment(day - pd.Timedelta(days=1), "The day before", f"NESO's constraint bill for the day before was {money(float(prev['total_cost_gbp'].iloc[0]), 'GBP')}."))
    script = [f"{day_text(day)} was the most expensive day for constraints in the days we hold: NESO's bill came to {money(cost, 'GBP')}.",
              f"Constraint costs are what NESO pays to keep power flows within the grid's limits. GB wind peaked at {gw(vw)} at {tw:%H:%M} UTC, and about {bid_gwh:,.0f} GWh of accepted bids asked generators to turn down.",
              f"The system price averaged {money(mean_price, 'GBP')}/MWh across the day, against {money(float(quiet), 'GBP')}/MWh over the two days before.",
              "Our forecast replay asks whether a model that had seen nothing from that day onwards would have seen it coming."]
    specs = [SeriesSpec("wind_gb", "GB wind", "MW", "GB", "gen_wind", "elexon"), SeriesSpec("price_gb", "GB system price", "GBP/MWh", "GB", "system_price", "elexon"),
             SeriesSpec("bids_gb", "Accepted turn-down bids", "MWh", "GB", "boalf_mwh"), SeriesSpec("flow_gb_no2", "GB-Norway flow", "MW", "GB", "flow_GB_NO2", "elexon")]
    return Event("storm", f"The storm that cost £{cost / 1e6:.1f} million", "storm", "hourly", lo, hi, f"{money(cost, 'GBP')} of constraint costs in a day",
                 keys, moms, script, window_series(d, specs, lo, hi), ["NESO data portal (constraint costs)", "Elexon (FUELHH, BOALF, system price)"],
                 ["Constraint costs come from NESO's daily totals; our cache holds only the last few weeks of them.",
                  "Bid volumes are every accepted turn-down bid, not only wind."],
                 f"largest daily NESO constraint cost in the cache ({day_text(day)})", focus=day.date())


def dunkelflaute(d: Data) -> Event:
    price = d.hourly("DE-LU", "price_da")
    winter = price[price.index.month.isin([11, 12, 1, 2])]
    if winter.empty:
        raise NotConfirmed("no DE-LU winter prices")
    t0 = winter.idxmax()
    day = t0.normalize()
    lo, hi = day - pd.Timedelta(days=3), day + pd.Timedelta(days=3)
    ren = sum(d.hourly("DE-LU", s) for s in ("gen_wind_onshore", "gen_wind_offshore", "gen_solar"))
    ren_d = ren.resample("D").mean()
    week = pd.Timestamp(lo)
    before = float(ren_d[(ren_d.index >= week) & (ren_d.index < day - pd.Timedelta(days=1))].mean())
    lowd, lowv = ren_d[(ren_d.index >= lo) & (ren_d.index < hi)].idxmin(), float(ren_d[(ren_d.index >= lo) & (ren_d.index < hi)].min())
    pd_ = price.resample("D").mean()
    mean_day = float(pd_[day])
    base = float(pd_[(pd_.index >= lo) & (pd_.index < day - pd.Timedelta(days=1))].mean())
    fr = d.hourly("FR", "price_da")
    frp = float(fr[t0]) if t0 in fr.index else None
    tr, vr = peak(ren, lo, hi, low=True)
    keys = [number("Peak German day-ahead price", price[t0], "EUR/MWh", "Energy-Charts day-ahead price, DE-LU"),
            number("German price, that day's mean", mean_day, "EUR/MWh", "Energy-Charts"),
            number("German price, the days before (mean)", base, "EUR/MWh", "Energy-Charts"),
            number("German wind and solar, lowest day (mean)", lowv, "MW", "Energy-Charts generation, DE-LU"),
            number("German wind and solar, days before (mean)", before, "MW", "Energy-Charts generation, DE-LU")]
    moms = [moment(tr, "Wind and sun almost vanish", f"German wind and solar fall to {gw(vr)} in the hour."),
            moment(t0, "Price peak", f"The German day-ahead price peaks at {money(float(price[t0]), 'EUR')}/MWh.")]
    if frp is not None:
        moms.append(moment(t0, "Neighbours follow", f"France clears at {money(frp, 'EUR')}/MWh in the same hour."))
    script = [f"Wind and sun, which usually carry a large part of German power, nearly stopped around {day_text(lowd)}: on average they supplied {gw(lowv)}, against {gw(before)} in the days before.",
              f"Prices answered. The day-ahead price in Germany averaged {money(mean_day, 'EUR')}/MWh on {day_text(day)} and reached {money(float(price[t0]), 'EUR')}/MWh at {t0:%H:%M} UTC, against {money(base, 'EUR')}/MWh in the days before.",
              "The Germans call this a Dunkelflaute, a dark lull. The shortfall is met by gas, coal and imports, so the price follows the dearest plant that has to run.",
              "Our data shows the lull and the price. It does not show which plants filled the gap hour by hour in the neighbours, so we do not claim that."]
    specs = [SeriesSpec("price_de", "Germany day-ahead price", "EUR/MWh", "DE-LU", "price_da"), SeriesSpec("price_fr", "France day-ahead price", "EUR/MWh", "FR", "price_da"),
             SeriesSpec("price_nl", "Netherlands day-ahead price", "EUR/MWh", "NL", "price_da"), SeriesSpec("load_de", "Germany load", "MW", "DE-LU", "load")]
    e = Event("dunkelflaute", "The dark lull: Germany without wind or sun", "dunkelflaute", "hourly", lo, hi, f"Peak {money(float(price[t0]), 'EUR')}/MWh in Germany",
              keys, moms, script, window_series(d, specs, lo, hi), ["Energy-Charts (prices, generation, load)"],
              ["Wind and solar are the sum of onshore, offshore and solar generation reported for DE-LU."],
              f"highest DE-LU day-ahead price in November to February ({ts_text(t0)})")
    e.series.append({"key": "renewables_de", "label": "Germany wind and solar", "unit": "MW", "zone": "DE-LU", "series": "gen_wind+gen_solar",
                     "points": [[t.isoformat(), round(float(x), 2)] for t, x in ren[(ren.index >= lo) & (ren.index < hi)].items()]})
    return e


def sunny_weekend(d: Data) -> Event:
    price = d.hourly("DE-LU", "price_da")
    wk = price[(price.index.day_of_week >= 5) & price.index.month.isin([4, 5, 6, 7, 8, 9])]
    if wk.empty:
        raise NotConfirmed("no DE-LU weekend prices in April to September")
    t0 = wk.idxmin()
    day = t0.normalize()
    lo, hi = day - pd.Timedelta(days=1), day + pd.Timedelta(days=2)
    solar = d.hourly("DE-LU", "gen_solar")
    wind = d.hourly("DE-LU", "gen_wind_onshore") + d.hourly("DE-LU", "gen_wind_offshore")
    dd = price[(price.index >= day) & (price.index < day + pd.Timedelta(days=1))]
    neg = int((dd < 0).sum())
    ts_, vs = peak(solar, day, day + pd.Timedelta(days=1))
    wmean = float(wind[(wind.index >= day) & (wind.index < day + pd.Timedelta(days=1))].mean())
    weekday = price[(price.index >= day - pd.Timedelta(days=5)) & (price.index < day - pd.Timedelta(days=2))]
    first_neg = dd[dd < 0].index.min()
    last_neg = dd[dd < 0].index.max()
    keys = [number("Lowest German day-ahead price", price[t0], "EUR/MWh", "Energy-Charts day-ahead price, DE-LU"),
            number("Hours at a negative price, the day", neg, "hours", "Energy-Charts"),
            number("German solar peak", vs, "MW", "Energy-Charts generation, DE-LU"),
            number("German price, mean of the weekdays before", weekday.mean(), "EUR/MWh", "Energy-Charts")]
    moms = [moment(first_neg, "Prices turn negative", f"The first negative hour of the day, at {money(float(price[first_neg]), 'EUR')}/MWh."),
            moment(ts_, "Solar peak", f"German solar reaches {gw(vs)}."),
            moment(t0, "Deepest dip", f"The day-ahead price bottoms at {money(float(price[t0]), 'EUR')}/MWh."),
            moment(last_neg, "Last negative hour", "Prices climb back above zero as the sun drops.")]
    script = [f"On {day_text(day)}, a {day:%A}, the sun did what the market could not absorb: German solar peaked at {gw(vs)} at {ts_:%H:%M} UTC. It was a weekend, so demand was lower.",
              f"The day-ahead price was negative for {neg} hours and fell to {money(float(price[t0]), 'EUR')}/MWh. Generators were paying to be allowed to produce.",
              f"For comparison, the weekdays before averaged {money(float(weekday.mean()), 'EUR')}/MWh. Wind averaged {gw(wmean)} across the day, against {gw(vs)} of solar at its peak.",
              "Cheap hours like these are what flexible demand and batteries are for."]
    specs = [SeriesSpec("price_de", "Germany day-ahead price", "EUR/MWh", "DE-LU", "price_da"), SeriesSpec("price_nl", "Netherlands day-ahead price", "EUR/MWh", "NL", "price_da"),
             SeriesSpec("price_fr", "France day-ahead price", "EUR/MWh", "FR", "price_da"), SeriesSpec("solar_de", "Germany solar", "MW", "DE-LU", "gen_solar"),
             SeriesSpec("load_de", "Germany load", "MW", "DE-LU", "load")]
    return Event("sunny-weekend", "A sunny weekend with negative prices", "negative-prices", "hourly", lo, hi, f"{neg} negative-price hours; low {money(float(price[t0]), 'EUR')}/MWh",
                 keys, moms, script, window_series(d, specs, lo, hi), ["Energy-Charts (prices, generation, load)"],
                 ["The date is the weekend day in April to September with the lowest German day-ahead price in the data."],
                 f"lowest DE-LU day-ahead price on a weekend, April to September ({ts_text(t0)})")


def record_wind(d: Data) -> Event:
    wind = d.hourly("GB", "gen_wind", "elexon")
    if wind.empty:
        raise NotConfirmed("no GB wind")
    daily = wind.resample("D").mean()
    day = daily.idxmax()
    lo, hi = day - pd.Timedelta(days=1), day + pd.Timedelta(days=2)
    price, load, bids = d.hourly("GB", "system_price", "elexon"), d.hourly("GB", "load", "elexon"), d.hourly("GB", "boalf_mwh")
    end = day + pd.Timedelta(days=1)
    tw, vw = peak(wind, day, end)
    share = float((wind[day:end - pd.Timedelta(hours=1)] / load[day:end - pd.Timedelta(hours=1)]).mean())
    bid_gwh = float(bids[(bids.index >= day) & (bids.index < end)].sum()) / 1000
    tp, vp = peak(price, day, end, low=True)
    keys = [number("GB wind, the day's mean (highest day in our data)", daily[day], "MW", "Elexon FUELHH"),
            number("GB wind, peak hour", vw, "MW", "Elexon FUELHH"),
            number("Wind as a share of GB demand, the day's mean", 100 * share, "%", "Elexon FUELHH generation over Elexon demand"),
            number("Accepted turn-down bids, the day", bid_gwh, "GWh", "Elexon BOALF"),
            number("Lowest GB system price, the day", vp, "GBP/MWh", "Elexon system price")]
    moms = [moment(tw, "Wind peaks", f"GB wind reaches {gw(vw)}."),
            moment(tp, "Lowest price", f"The system price bottoms at {money(vp, 'GBP')}/MWh.")]
    script = [f"{day_text(day)} was the windiest day in the data we hold since 2024: GB wind averaged {gw(float(daily[day]))} and peaked at {gw(vw)}.",
              f"At its best the wind alone matched {100 * share:.0f}% of demand on average across the day.",
              f"Not all of it could be used where it was made: generators were accepted to turn down for about {bid_gwh:,.0f} GWh across the day.",
              "The constraint bill for that day is not in our cache, so we do not put a pound figure on it."]
    specs = [SeriesSpec("wind_gb", "GB wind", "MW", "GB", "gen_wind", "elexon"), SeriesSpec("price_gb", "GB system price", "GBP/MWh", "GB", "system_price", "elexon"),
             SeriesSpec("load_gb", "GB demand", "MW", "GB", "load", "elexon"), SeriesSpec("bids_gb", "Accepted turn-down bids", "MWh", "GB", "boalf_mwh")]
    return Event("record-wind", "The windiest day in the data", "wind", "hourly", lo, hi, f"GB wind averaged {gw(float(daily[day]))}", keys, moms, script,
                 window_series(d, specs, lo, hi), ["Elexon (FUELHH, BOALF, system price)"],
                 ["Constraint costs for this day are not cached, so only volumes are shown.", "Demand here is Elexon's transmission demand, which excludes embedded generation."],
                 f"highest daily mean GB wind output in the data ({day_text(day)})")


def cable_out(d: Data) -> Event:
    flow = d.hourly("GB", "flow_GB_NO2", "elexon")
    if flow.empty:
        raise NotConfirmed("no GB-NO2 flow")
    daily = flow.resample("D").mean()
    low = (daily.abs() < 100).astype(int)
    runs, best, cur = [], None, None
    for t, v in low.items():
        if v:
            cur = [t, t] if cur is None else [cur[0], t]
        elif cur:
            runs.append(cur)
            cur = None
    if cur:
        runs.append(cur)
    if not runs:
        raise NotConfirmed("no North Sea Link outage in the data")
    best = max(runs, key=lambda r: (r[1] - r[0]))
    s, e = best
    n = (e - s).days + 1
    if n < 3:
        raise NotConfirmed("no outage of three days or more")
    lo, hi = s - pd.Timedelta(days=3), e + pd.Timedelta(days=4)
    gb, no2 = d.hourly("GB", "system_price", "elexon"), d.hourly("NO2", "price_da")
    before = (s - pd.Timedelta(days=14), s)
    during = (s, e + pd.Timedelta(days=1))

    def mean(x, w):
        return float(x[(x.index >= w[0]) & (x.index < w[1])].mean())
    usual = mean(flow, before)
    keys = [number("Days with the link near zero", n, "days", "Elexon interconnector flow, GB-NO2 (daily mean under 100 MW)"),
            number("Flow, the 14 days before", usual, "MW", "Elexon", "negative means power flowing into GB"),
            number("GB system price during", mean(gb, during), "GBP/MWh", "Elexon system price"),
            number("GB system price, 14 days before", mean(gb, before), "GBP/MWh", "Elexon system price"),
            number("Norway (NO2) day-ahead price during", mean(no2, during), "EUR/MWh", "Energy-Charts"),
            number("Norway (NO2) day-ahead price, 14 days before", mean(no2, before), "EUR/MWh", "Energy-Charts")]
    moms = [moment(s, "Flow stops", f"The daily mean flow between Norway and GB drops under 100 MW from {day_text(s)}."),
            moment(e + pd.Timedelta(days=1), "Flow returns", f"The link is back above that threshold from {day_text(e + pd.Timedelta(days=1))}.")]
    script = [f"For {n} days from {day_text(s)}, the North Sea Link, the 1.4 GW cable between Norway and Britain, carried almost nothing.",
              f"Before that it had been bringing about {abs(usual):,.0f} MW into Britain on average. Our flow data shows when the flow stopped and restarted; it does not say why.",
              f"GB's system price averaged {money(mean(gb, during), 'GBP')}/MWh during the gap, against {money(mean(gb, before), 'GBP')}/MWh in the fortnight before. Norway's price went from {money(mean(no2, before), 'EUR')} to {money(mean(no2, during), 'EUR')}/MWh.",
              "Prices move for many reasons at once, so this is a before-and-after, not a measurement of the cable alone."]
    specs = [SeriesSpec("flow_gb_no2", "GB-Norway flow", "MW", "GB", "flow_GB_NO2", "elexon"), SeriesSpec("price_gb", "GB system price", "GBP/MWh", "GB", "system_price", "elexon"),
             SeriesSpec("price_no2", "Norway (NO2) day-ahead price", "EUR/MWh", "NO2", "price_da"), SeriesSpec("flow_gb_fr", "GB-France flow", "MW", "GB", "flow_GB_FR", "elexon")]
    return Event("cable-out", "The Norway cable goes quiet", "interconnector-outage", "hourly", lo, hi, f"North Sea Link near zero for {n} days", keys, moms, script,
                 window_series(d, specs, lo, hi), ["Elexon (interconnector flows, system price)", "Energy-Charts (NO2 price)"],
                 ["The cause (maintenance, fault, or a market decision) is not in our data.", "Before-and-after price comparisons are not causal."],
                 f"longest run of days with the GB-NO2 daily mean flow under 100 MW ({day_text(s)} to {day_text(e)})")


def price_spike(d: Data) -> Event:
    price = d.hourly("GB", "system_price", "elexon")
    if price.empty:
        raise NotConfirmed("no GB system price")
    daily = price.resample("D").mean()
    day = daily.idxmax()
    end = day + pd.Timedelta(days=1)
    lo, hi = day - pd.Timedelta(days=2), day + pd.Timedelta(days=3)
    t0, v0 = peak(price, day, end)
    wind, gas = d.hourly("GB", "gen_wind", "elexon"), d.hourly("GB", "gen_gas", "elexon")
    high = int((price[(price.index >= day) & (price.index < end)] >= 0.9 * v0).sum())
    prior = price[(price.index >= day - pd.Timedelta(days=7)) & (price.index < day)].mean()
    wmean = float(wind[(wind.index >= day) & (wind.index < end)].mean())
    wprior = float(wind[(wind.index >= day - pd.Timedelta(days=7)) & (wind.index < day)].mean())
    keys = [number("GB system price, peak hour", v0, "GBP/MWh", "Elexon system price, hourly mean"),
            number("GB system price, the day's mean (highest day in our data)", daily[day], "GBP/MWh", "Elexon"),
            number("Hours within 10% of the peak", high, "hours", "Elexon"),
            number("GB system price, the week before (mean)", prior, "GBP/MWh", "Elexon"),
            number("GB wind, the day's mean", wmean, "MW", "Elexon FUELHH"), number("GB wind, the week before (mean)", wprior, "MW", "Elexon FUELHH")]
    tg, vg = peak(gas, day, end)
    moms = [moment(t0, "Price peak", f"The GB system price reaches {money(v0, 'GBP')}/MWh."),
            moment(tg, "Gas at its highest", f"Gas generation peaks at {gw(vg)}.")]
    script = [f"{day_text(day)} was the most expensive day in our GB data: the system price averaged {money(float(daily[day]), 'GBP')}/MWh and touched {money(v0, 'GBP')}/MWh at {t0:%H:%M} UTC.",
              f"In the week before it had averaged {money(float(prior), 'GBP')}/MWh. Wind averaged {gw(wmean)} that day, against {gw(wprior)} in the week before.",
              "The system price is the price of fixing imbalance at the last minute, so it spikes when the system is tight. It is not the price most people or generators pay for their power.",
              "Our data shows how tight the day was; it does not show every cause."]
    specs = [SeriesSpec("price_gb", "GB system price", "GBP/MWh", "GB", "system_price", "elexon"), SeriesSpec("wind_gb", "GB wind", "MW", "GB", "gen_wind", "elexon"),
             SeriesSpec("gas_gb", "GB gas generation", "MW", "GB", "gen_gas", "elexon"), SeriesSpec("load_gb", "GB demand", "MW", "GB", "load", "elexon")]
    return Event("price-spike", "The most expensive day in Britain", "price-spike", "hourly", lo, hi, f"System price peaked at {money(v0, 'GBP')}/MWh", keys, moms, script,
                 window_series(d, specs, lo, hi), ["Elexon (system price, FUELHH)"], ["The system price is a balancing price, not a wholesale or retail price."],
                 f"highest daily mean GB system price in the data ({day_text(day)})")


def gas_crisis(d: Data) -> Event:
    gas, eua = d.daily_market("gas_ttf"), d.daily_market("eua")
    if gas.empty:
        raise NotConfirmed("no gas prices")
    g22 = gas[(gas.index >= "2022-01-01") & (gas.index < "2023-01-01")]
    t0, v0 = g22.idxmax(), float(g22.max())
    lo, hi = pd.Timestamp("2022-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC")
    e0 = float(eua[t0]) if t0 in eua.index else None
    jan21 = gas[(gas.index >= "2021-01-01") & (gas.index < "2021-02-01")].mean()
    last = gas.iloc[-1]
    keys = [number("Peak gas price, TTF front month", v0, "EUR/MWh", "yfinance TTE=F converted from USD/MMBtu at EUR/USD", f"on {day_text(t0)}"),
            number("Gas price, January 2021 (mean)", jan21, "EUR/MWh", "yfinance TTE=F"),
            number("Peak as a multiple of January 2021", v0 / jan21, "x", "computed from the two above"),
            number("Latest gas price in our data", float(last), "EUR/MWh", "yfinance TTE=F", f"on {day_text(gas.index[-1])}")]
    if e0 is not None:
        keys.append(number("Carbon allowance price, same day", e0, "EUR/t", "yfinance CO2.L"))
    moms = [moment(t0, "Peak", f"TTF closes at {money(v0, 'EUR')}/MWh.")]
    h1 = g22[g22.index >= "2022-03-01"]
    mar = h1.iloc[0] if len(h1) else None
    s_ = g22.resample("ME").mean()
    for m, val in [(s_.idxmax(), float(s_.max()))]:
        moms.append(moment(m.normalize().replace(day=1), "Dearest month", f"{m:%B %Y} averages {money(val, 'EUR')}/MWh."))
    if mar is not None:
        moms.append(moment(h1.index[0], "March 2022", f"Gas has already jumped to {money(float(mar), 'EUR')}/MWh."))
    script = [f"In 2022 gas became the price of electricity. Europe's benchmark gas price peaked at {money(v0, 'EUR')} per MWh on {day_text(t0)}, about {v0 / jan21:.0f} times where it had been in January 2021.",
              f"Because gas plants usually set the power price, that moved straight into electricity bills. For comparison, the latest price in our data is {money(float(last), 'EUR')}/MWh on {day_text(gas.index[-1])}.",
              "This event is gas and carbon only: our power-price history starts in 2024, so we show what gas did and not what it did to prices then.",
              "That is why our gas pass-through is calibrated on prices back to 2021, not only the two years of power prices we hold."]
    gas_pts = [[t.isoformat(), round(float(x), 2)] for t, x in gas[(gas.index >= lo) & (gas.index < hi)].items()]
    eua_pts = [[t.isoformat(), round(float(x), 2)] for t, x in eua[(eua.index >= lo) & (eua.index < hi)].items()]
    series = [{"key": "gas_ttf", "label": "Gas price (TTF)", "unit": "EUR/MWh", "zone": "EU", "series": "gas_ttf", "points": gas_pts},
              {"key": "eua", "label": "Carbon allowance price", "unit": "EUR/t", "zone": "EU", "series": "eua", "points": eua_pts}]
    return Event("gas-crisis", "The 2022 gas crisis", "gas-crisis", "daily", lo, hi, f"Gas peaked at {money(v0, 'EUR')}/MWh", keys, moms, script, series,
                 ["yfinance (TTE=F, CO2.L)"],
                 ["Daily data, gas and carbon only: no power prices exist in our data for 2022.",
                  "TTE=F is quoted in USD per MMBtu and converted to EUR/MWh; the verified reference fact for the peak (EUR 339.20) is a settlement figure and differs by under 1%."],
                 f"highest TTF close in 2022 ({day_text(t0)})")


BUILDERS: list[Callable[[Data], Event]] = [storm, dunkelflaute, sunny_weekend, record_wind, cable_out, price_spike, gas_crisis]


def replay_entry(ev: Event) -> dict:
    day = ev.focus or ev.start.date()
    p = cache.DATA / "replay" / f"{day.isoformat()}.json"
    if ev.focus and p.exists():
        return {"available": True, "event": day.isoformat(), "file": f"data/replay/{day.isoformat()}.json"}
    return {"available": False, "event": day.isoformat(),
            "how": f"uv run python -m pipeline.models.asof {day.isoformat()} && uv run python -m engine.replay --event {day.isoformat()}",
            "reason": "an as-of forecast replay needs a model trained only on data before the date; none is cached" if ev.focus else
                      "no forecast replay: this event is outside the period the price models cover"}


def bundle(ev: Event) -> dict:
    return {"slug": ev.slug, "title": ev.title, "kind": ev.kind, "headline": ev.headline, "resolution": ev.resolution,
            "start": ev.start.isoformat(), "end": ev.end.isoformat(), "confirmed_by": ev.confirmed_by, "key_numbers": ev.key_numbers,
            "moments": sorted(ev.moments, key=lambda m: m["ts"]), "script": ev.script, "series": ev.series, "sources": ev.sources,
            "caveats": ev.caveats, "replay": replay_entry(ev), "label": "computed from cached public data"}


def build(d: Data | None = None) -> list[dict]:
    d = d or load()
    out = []
    for fn in BUILDERS:
        try:
            ev = fn(d)
        except (NotConfirmed, KeyError, ValueError) as e:
            log.warning("skipped %s: %s", fn.__name__, e)
            continue
        out.append(bundle(ev))
    return out


def write(bundles: list[dict]) -> list[Path]:
    d = out_dir()
    d.mkdir(parents=True, exist_ok=True)
    paths = []
    for b in bundles:
        p = d / f"{b['slug']}.json"
        p.write_text(json.dumps(b, indent=1, ensure_ascii=False) + "\n")
        paths.append(p)
    idx = [{"slug": b["slug"], "title": b["title"], "kind": b["kind"], "headline": b["headline"], "start": b["start"], "end": b["end"],
            "resolution": b["resolution"], "moments": len(b["moments"]), "replay_available": b["replay"]["available"],
            "confirmed_by": b["confirmed_by"]} for b in bundles]
    ip = d / "index.json"
    ip.write_text(json.dumps({"events": idx}, indent=1, ensure_ascii=False) + "\n")
    return [*paths, ip]


def problems(b: dict) -> list[str]:
    """What is wrong with a bundle: missing parts, moments outside the window, series outside the window."""
    errs = []
    start, end = pd.Timestamp(b["start"]), pd.Timestamp(b["end"])
    for k in ("slug", "title", "headline", "key_numbers", "moments", "script", "series", "sources", "replay", "confirmed_by"):
        if not b.get(k):
            errs.append(f"{b.get('slug')}: missing {k}")
    if not 2 <= len(b.get("moments", [])) <= 8:
        errs.append(f"{b.get('slug')}: expected 2 to 8 moments, found {len(b.get('moments', []))}")
    for m in b.get("moments", []):
        t = pd.Timestamp(m["ts"])
        if not start <= t <= end:
            errs.append(f"{b['slug']}: moment {m['label']!r} at {m['ts']} is outside the window")
    for s in b.get("series", []):
        if not s["points"]:
            errs.append(f"{b['slug']}: series {s['key']} has no points")
        elif not all(start <= pd.Timestamp(t) < end for t, _ in s["points"]):
            errs.append(f"{b['slug']}: series {s['key']} has points outside the window")
    for n in b.get("key_numbers", []):
        if not n.get("source"):
            errs.append(f"{b['slug']}: key number {n.get('label')!r} has no source")
    return errs


def check() -> list[str]:
    d = out_dir()
    idx = d / "index.json"
    if not idx.exists():
        return [f"{idx} is missing"]
    errs = []
    for e in json.loads(idx.read_text())["events"]:
        p = d / f"{e['slug']}.json"
        errs += problems(json.loads(p.read_text())) if p.exists() else [f"{p} is missing"]
    return errs


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Build or check the event library.")
    ap.add_argument("cmd", choices=["build", "check"])
    ap.add_argument("--data", help="read the cache from this directory instead of data/")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.data:
        cache.DATA = Path(args.data)
    if args.cmd == "build":
        bundles = build()
        errs = [e for b in bundles for e in problems(b)]
        if errs:
            log.error("\n".join(errs))
            return 1
        for p in write(bundles):
            log.info("wrote %s", p)
        return 0
    errs = check()
    for e in errs:
        log.error(e)
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
