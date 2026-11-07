"""Hourly model inputs for every zone, for training history and for the next 48 hours.

No leakage: each row has an origin, the time its forecast is made. Every input is read at a time at or
before the origin, and only hours that had finished by then count as known.
  future rows   origin is made_at (floored to the hour); inputs are also cut off at made_at before use.
  history rows  origin is ts minus HISTORY_LEAD_H, so the row looks like a forecast made that far ahead.
Same-hour lags use the freshest day that was already complete at the origin (24 h for horizons up to 23 h,
48 h for up to 47 h, and so on).

Modelled stand-ins, labelled as such on screen where they surface:
  wind_gen_fc_mw, solar_gen_fc_mw  weather-implied output: generic power curve or irradiance times a capacity
                                   proxy (trailing-year peak of metered output, rough table as fallback).
  load_fc_mw                       same hour a week earlier (persistence), not a published load forecast.
  import_ci_gco2_kwh               import-weighted typical production intensity per country (estimates).
Prices are as published: GB in GBP/MWh, the rest in EUR/MWh.
"""

import numpy as np
import pandas as pd

from pipeline import cache, schemas
from pipeline.features.calendar import calendar_features

HISTORY_LEAD_H = 12
FUTURE_H = 48
LATEST = "features/latest"

CUT_IN, RATED, CUT_OUT = 3.0, 12.0, 25.0
SOLAR_DERATE = 0.8

# Rough installed capacity in MW, used only until a trailing-year peak of metered output exists.
FALLBACK_CAPACITY_MW = {
    "wind": {"GB": 30000, "FR": 25000, "DE-LU": 70000, "NL": 12000, "BE": 6000, "NO2": 2500},
    "solar": {"GB": 17000, "FR": 25000, "DE-LU": 100000, "NL": 28000, "BE": 11000, "NO2": 200},
}
# Typical production intensity, gCO2/kWh. Standard-style estimates, replaced by carbon tracing later.
TYPICAL_CI = {"FR": 60, "DE-LU": 380, "NL": 330, "BE": 160, "NO2": 20, "GB": 200, "DK": 150, "DK1": 150, "SE": 30,
              "IE": 300, "NI": 300}
DEFAULT_CI = 250

WEATHER_VARS = {
    "wind_speed_100m": "wind_speed_100m",
    "temperature_c": "temperature_2m",
    "solar_irradiance_wm2": "shortwave_radiation",
}


def _read(name: str) -> pd.DataFrame | None:
    try:
        return cache.read(name)
    except FileNotFoundError:
        return None


def _actuals(names: list[str]) -> pd.DataFrame:
    parts = [d for d in (_read(f"actuals/{n}") for n in names) if d is not None]
    cols = ["ts", "zone", "series", "value"]
    return pd.concat([p[cols] for p in parts], ignore_index=True) if parts else pd.DataFrame(columns=cols)


def _wide(df: pd.DataFrame, series: str | list[str], zones=None, combine="sum") -> pd.DataFrame:
    series = [series] if isinstance(series, str) else series
    d = df[df["series"].isin(series)]
    if zones is not None:
        d = d[d["zone"].isin(zones)]
    if d.empty:
        return pd.DataFrame()
    agg = d.groupby(["ts", "zone"])["value"].agg(combine if combine != "sum" else lambda v: v.sum(min_count=1))
    return agg.unstack("zone").sort_index()


class Inputs:
    """Hourly input series, optionally cut off at what was known at made_at."""

    def __init__(self, made_at: pd.Timestamp | None = None):
        self.made_at = made_at
        ec = _actuals(["energy_charts_price_da", "energy_charts_generation", "energy_charts_load", "energy_charts_flows"])
        npl = _actuals(["nordpool_price_da"])
        elx = _actuals(["elexon_system_price", "elexon_load", "elexon_gen_wind"])
        elx_flows = _read_flows_elexon()
        if made_at is not None:
            last = made_at - pd.Timedelta(hours=1)
            ec, npl, elx, elx_flows = (d[d["ts"] <= last] for d in (ec, npl, elx, elx_flows))

        price = _wide(ec, "price_da")
        np_price = _wide(npl, "price_da")
        price = np_price.combine_first(price) if len(price) else np_price
        sysp = _wide(elx, "system_price")
        if "GB" in sysp:
            price["GB"] = price["GB"].combine_first(sysp["GB"]) if "GB" in price else sysp["GB"]
        self.price = price
        load = _wide(ec, "load")
        gb_load = _wide(elx, "load")
        self.load = pd.concat([load, gb_load], axis=1) if len(gb_load) else load
        wind = _wide(ec, ["gen_wind_onshore", "gen_wind_offshore"])
        gb_wind = _wide(elx, "gen_wind")
        self.wind = pd.concat([wind, gb_wind], axis=1) if len(gb_wind) else wind
        self.solar = _wide(ec, "gen_solar")
        self.net_import = _net_import(ec, elx_flows)
        self.partner_imports = _partner_imports(ec, elx_flows)
        self.weather = _weather(made_at)
        self.markets = _markets(made_at)
        self.gas_share = _read("features/gas_marginal_share")


def _read_flows_elexon() -> pd.DataFrame:
    parts = []
    base = cache.DATA / "actuals"
    for p in sorted(base.glob("elexon_flow_GB_*.parquet")):
        parts.append(pd.read_parquet(p)[["ts", "zone", "series", "value"]])
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=["ts", "zone", "series", "value"])


def _net_import(ec: pd.DataFrame, elx_flows: pd.DataFrame) -> pd.DataFrame:
    out = {}
    for z in schemas.ZONES:
        if z == "GB":
            g = elx_flows[elx_flows["series"].str.startswith("flow_GB_")]
            if len(g):
                out[z] = -g.groupby("ts")["value"].sum()
        else:
            s = ec[(ec["series"] == f"flow_net_{z}") & (ec["zone"] == z)]
            if len(s):
                out[z] = s.set_index("ts")["value"]
    return pd.DataFrame(out).sort_index()


def _partner_imports(ec: pd.DataFrame, elx_flows: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """zone -> hourly imports in MW by partner. Flows are positive away from the zone, so imports are negative."""
    out = {}
    for z in schemas.ZONES:
        src = elx_flows if z == "GB" else ec
        d = src[src["series"].str.startswith(f"flow_{z}_") & (src["zone"] == z)]
        d = d[d["series"] != f"flow_net_{z}"]
        if d.empty:
            continue
        d = d.assign(partner=d["series"].str.removeprefix(f"flow_{z}_"))
        w = d.groupby(["ts", "partner"])["value"].sum().unstack("partner").sort_index()
        out[z] = (-w).clip(lower=0)
    return out


def _weather(made_at: pd.Timestamp | None) -> dict[str, pd.DataFrame]:
    hist, live = _read("weather/historical_forecast"), _read("weather/live_forecast")
    out = {}
    for feat, var in WEATHER_VARS.items():
        parts = []
        if hist is not None:
            h = hist[hist["variable"] == var]
            if made_at is not None:
                h = h[h["ts"] <= made_at]
            parts.append(h.groupby(["ts", "zone"])["value"].mean().unstack("zone"))
        if live is not None:
            lv = live[live["variable"] == var]
            if made_at is not None:
                lv = lv[lv["issued_at"] <= made_at]
            lv = lv.sort_values("issued_at").drop_duplicates(["ts", "zone", "point"], keep="last")
            if len(lv):
                latest = lv.groupby(["ts", "zone"])["value"].mean().unstack("zone")
                if made_at is not None:
                    parts.insert(0, latest[latest.index > made_at])
                    parts.append(latest)
                else:
                    parts.append(latest)
        wide = parts[0] if parts else pd.DataFrame()
        for p in parts[1:]:
            wide = wide.combine_first(p)
        out[feat] = wide.sort_index()
    return out


def _markets(made_at: pd.Timestamp | None) -> dict[str, pd.Series]:
    df = _read("markets/gas_carbon")
    if df is None:
        return {}
    return {s: g.set_index("ts")["value"].sort_index() for s, g in df.groupby("series")}


def _at(series: pd.Series | None, times: pd.DatetimeIndex, tol: str = "6h") -> np.ndarray:
    """Latest value at or before each time, within tol; NaN where there is none."""
    nan = np.full(len(times), np.nan)
    if series is None:
        return nan
    s = series.dropna()
    if s.empty:
        return nan
    left = pd.DataFrame({"t": times, "i": np.arange(len(times))}).sort_values("t")
    right = pd.DataFrame({"t": s.index, "v": s.values}).sort_values("t")
    m = pd.merge_asof(left, right, on="t", tolerance=pd.Timedelta(tol), direction="backward")
    out = nan.copy()
    out[m["i"].to_numpy()] = m["v"].to_numpy()
    return out


def _col(wide: pd.DataFrame, zone: str) -> pd.Series | None:
    return wide[zone] if len(wide) and zone in wide else None


def _capacity(series: pd.Series | None, kind: str, zone: str, times: pd.DatetimeIndex) -> np.ndarray:
    fb = FALLBACK_CAPACITY_MW[kind][zone]
    if series is None or series.dropna().empty:
        return np.full(len(times), float(fb))
    s = series.dropna()
    hourly = s.reindex(pd.date_range(s.index.min(), s.index.max(), freq="h"))
    peak = hourly.rolling("365D", min_periods=24).max().shift(1)
    got = _at(peak, times, tol="3650D")
    return np.where(np.isnan(got) | (got <= 0), fb, got)


def power_curve(speed: np.ndarray) -> np.ndarray:
    """Generic wind turbine curve as a fraction of rated output."""
    x = np.clip((speed - CUT_IN) / (RATED - CUT_IN), 0, 1) ** 3
    return np.where(speed >= CUT_OUT, 0.0, x)


def _import_ci(zone: str, partners: pd.DataFrame | None, times: pd.DatetimeIndex) -> np.ndarray:
    if partners is None:
        return np.zeros(len(times))
    num, den = np.zeros(len(times)), np.zeros(len(times))
    for p in partners.columns:
        v = np.nan_to_num(_at(partners[p], times))
        num += v * TYPICAL_CI.get(p, DEFAULT_CI)
        den += v
    return np.divide(num, den, out=np.zeros(len(times)), where=den > 0)


def _zone_features(zone: str, ts: pd.DatetimeIndex, origin: pd.DatetimeIndex, inp: Inputs) -> pd.DataFrame:
    hours_ahead = ((ts - origin) / pd.Timedelta(hours=1)).to_numpy()
    k = np.maximum(1, np.ceil((hours_ahead + 1) / 24)).astype(int)
    lag_k = ts - pd.to_timedelta(24 * k, unit="h")
    last_known = origin - pd.Timedelta(hours=1)

    price, load, wind = _col(inp.price, zone), _col(inp.load, zone), _col(inp.wind, zone)
    solar = _col(inp.solar, zone)
    ws = _at(_col(inp.weather["wind_speed_100m"], zone), ts, "3h")
    irr = _at(_col(inp.weather["solar_irradiance_wm2"], zone), ts, "3h")
    wind_fc = power_curve(ws) * _capacity(wind, "wind", zone, origin)
    solar_fc = np.clip(irr, 0, None) / 1000 * SOLAR_DERATE * _capacity(solar, "solar", zone, origin)
    load_fc = _at(load, ts - pd.Timedelta(hours=168), "3h")
    load_fc = np.where(np.isnan(load_fc), _at(load, lag_k, "3h"), load_fc)

    day_before = origin.floor("D") - pd.Timedelta(days=1)
    share = np.full(len(ts), np.nan)
    if inp.gas_share is not None:
        g = inp.gas_share[inp.gas_share["zone"] == zone].set_index(["hour_of_day", "month"])["share"]
        g = g[~g.index.duplicated()]
        share = g.reindex(pd.MultiIndex.from_arrays([ts.hour, ts.month])).to_numpy()

    out = pd.DataFrame(
        {
            "ts": ts,
            "zone": zone,
            "wind_speed_100m": ws,
            "wind_gen_fc_mw": wind_fc,
            "wind_gen_lag_24h": _at(wind, lag_k, "3h"),
            "solar_irradiance_wm2": irr,
            "solar_gen_fc_mw": solar_fc,
            "load_fc_mw": load_fc,
            "temperature_c": _at(_col(inp.weather["temperature_c"], zone), ts, "3h"),
            "price_lag_24h": _at(price, lag_k, "3h"),
            "price_lag_168h": _at(price, ts - pd.Timedelta(hours=168), "3h"),
            "gas_ttf_eur_mwh": _at(inp.markets.get("gas_ttf"), day_before, "10D"),
            "gas_marginal_share": share,
            "eua_eur_t": _at(inp.markets.get("eua"), day_before, "10D"),
            "import_net_mw": _at(_col(inp.net_import, zone), last_known, "6h"),
            "import_ci_gco2_kwh": _import_ci(zone, inp.partner_imports.get(zone), last_known),
        }
    )
    out["residual_load_mw"] = out["load_fc_mw"] - out["wind_gen_fc_mw"] - out["solar_gen_fc_mw"]
    cal = calendar_features(ts).reset_index(drop=True)
    for c in cal:
        out[c] = cal[c].to_numpy()
    return out


def _finish(df: pd.DataFrame) -> pd.DataFrame:
    return df[["ts", "zone", *schemas.FEATURE_COLUMNS]].sort_values(["ts", "zone"]).reset_index(drop=True)


def build_future(made_at=None, horizon_h: int = FUTURE_H, inputs: Inputs | None = None) -> pd.DataFrame:
    """One row per zone and hour in (origin, origin + horizon_h]. Raises if any feature cannot be built."""
    made_at = pd.Timestamp.now(tz="UTC") if made_at is None else pd.Timestamp(made_at)
    origin = made_at.floor("h")
    inp = inputs or Inputs(made_at)
    ts = pd.date_range(origin + pd.Timedelta(hours=1), periods=horizon_h, freq="h")
    df = _finish(pd.concat([_zone_features(z, ts, pd.DatetimeIndex([origin] * len(ts)), inp) for z in schemas.ZONES]))
    bad = df.columns[df.isna().any()].tolist()
    if bad:
        missing = {c: sorted(df.loc[df[c].isna(), "zone"].unique()) for c in bad}
        raise ValueError(f"cannot build features at {origin}: missing inputs {missing}")
    return df


def build_history(start=None, end=None, lead_h: int = HISTORY_LEAD_H, inputs: Inputs | None = None) -> pd.DataFrame:
    """Training rows for every hour in [start, end], each as if forecast lead_h hours earlier. Incomplete rows are dropped."""
    inp = inputs or Inputs()
    first = [s.index.min() for s in (inp.price[c] for c in inp.price.columns)] if len(inp.price) else []
    if start is None and not first:
        return pd.DataFrame(columns=["ts", "zone", *schemas.FEATURE_COLUMNS])
    start = pd.Timestamp(start) if start is not None else min(first) + pd.Timedelta(days=8)
    end = pd.Timestamp(end) if end is not None else inp.price.index.max()
    ts = pd.date_range(start.ceil("h"), end.floor("h"), freq="h")
    origin = ts - pd.Timedelta(hours=lead_h)
    df = _finish(pd.concat([_zone_features(z, ts, origin, inp) for z in schemas.ZONES]))
    return df.dropna().reset_index(drop=True)


def latest(now=None, rebuild: bool | None = None) -> pd.DataFrame:
    """One row per zone and future hour with every model input.

    Online it rebuilds from the cached inputs and writes data/features/latest.parquet. Offline (LG_OFFLINE=1)
    it serves the cached or fixture file, so the app runs with no network.
    """
    rebuild = (not cache.offline()) if rebuild is None else rebuild
    if not rebuild:
        return schemas.validate(cache.read(LATEST), LATEST)
    df = schemas.validate(build_future(now), LATEST)
    cache.write(LATEST, df)
    return df
