"""What wind and sun did to prices: a merit-order estimate per zone and hour.

Method (an estimate, not a market finding): for each zone, regress the hourly day-ahead price on wind output,
solar output, load, the gas price and time of day over the previous WINDOW_DAYS. The wind (solar) slope is the
price change per extra GW. The effect of an hour is slope x that hour's output, i.e. the price against an
otherwise identical hour with no wind (no solar). The money effect is that price effect x the hour's load.
The slope is linear and the merit order is not, so large effects are approximate; the response says so.
Cross-check: LightGBM pred_contrib wind and solar groups (pipeline.models.explain) on the forecast hours.
"""

import numpy as np
import pandas as pd

from engine import data
from pipeline import cache

WINDOW_DAYS = 180
MIN_HOURS = 48
MIN_SOLAR_MW = 500  # below this the series is a rounding error, not a fleet
SYMBOL = {"GB": "£"}
PRICE_SOURCE_ORDER = ["nordpool", "energycharts", "entsoe"]
WIND_NAMES = ["gen_wind", "gen_wind_onshore", "gen_wind_offshore"]
CAVEAT = ("Estimated from a regression of hourly day-ahead prices on wind, solar, load, gas and time of day; "
          "the effect is against an hour with none of that generation, so it is a guide, not a market result.")


def _hourly(df: pd.DataFrame) -> pd.Series:
    return df.set_index("ts")["value"].resample("h").mean()


def _price(price: pd.DataFrame) -> pd.Series:
    """Hourly price, preferred source first and longer-history sources filling the gaps."""
    if "source" not in price or price["source"].nunique() < 2:
        return _hourly(price)
    out = None
    for s in PRICE_SOURCE_ORDER:
        part = price[price["source"] == s]
        if len(part):
            h = _hourly(part)
            out = h if out is None else out.combine_first(h)
    return out


def _gas() -> pd.Series | None:
    try:
        g = cache.read("markets/gas_carbon")
    except FileNotFoundError:
        return None
    g = g[g["series"] == "gas_ttf"]
    if g.empty:
        return None
    return g.set_index("ts")["value"].sort_index()


def panel(zone: str, a: pd.DataFrame | None = None, gas: pd.Series | None = None) -> pd.DataFrame:
    """Hourly price, wind_mw, solar_mw (NaN if not metered), load_mw, gas for one zone. Columns missing = no data."""
    a = data.actuals() if a is None else a
    z = a[a["zone"] == zone]
    price = z[z["series"] == "price_da"]
    wind = z[z["series"].isin(WIND_NAMES)]
    if wind["series"].isin(["gen_wind_onshore", "gen_wind_offshore"]).any():
        wind = wind[wind["series"] != "gen_wind"]
    cols = {"price": _price(price)}
    if len(wind):
        cols["wind_mw"] = wind.groupby("ts")["value"].sum().resample("h").mean()
    solar = z[z["series"] == "gen_solar"]
    if len(solar) and solar["value"].quantile(0.95) >= MIN_SOLAR_MW:
        cols["solar_mw"] = _hourly(solar)
    load = z[z["series"] == "load"]
    if len(load):
        cols["load_mw"] = _hourly(load)
    out = pd.DataFrame(cols)
    gas = _gas() if gas is None else gas
    if gas is not None and len(out):
        out["gas"] = gas.reindex(gas.index.union(out.index)).ffill().reindex(out.index)
    return out


def _design(p: pd.DataFrame, has: list[str]) -> np.ndarray:
    h = p.index.hour.to_numpy() / 24 * 2 * np.pi
    cols = [np.ones(len(p))] + [p[c].to_numpy() / (1000 if c.endswith("_mw") else 1) for c in has]
    cols += [np.sin(h), np.cos(h)]
    return np.column_stack(cols)


def fit(p: pd.DataFrame) -> dict | None:
    """OLS slopes per GW. None when there is too little data or no wind series."""
    if "wind_mw" not in p or "price" not in p:
        return None
    has = [c for c in ("wind_mw", "solar_mw", "load_mw", "gas") if c in p and p[c].notna().sum() > 0]
    d = p.dropna(subset=["price", *has])
    if len(d) < MIN_HOURS:
        return None
    has = [c for c in has if d[c].std() > 1e-9]
    if "wind_mw" not in has:
        return None
    X, y = _design(d, has), d["price"].to_numpy()
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ beta
    dof = max(len(y) - X.shape[1], 1)
    cov = np.linalg.pinv(X.T @ X) * (resid @ resid / dof)
    se = np.sqrt(np.diag(cov))
    r2 = 1 - (resid @ resid) / max(((y - y.mean()) ** 2).sum(), 1e-12)
    out = {"n_hours": int(len(d)), "r2": round(float(r2), 3), "window_from": d.index.min(), "window_to": d.index.max()}
    for c, name in (("wind_mw", "wind"), ("solar_mw", "solar")):
        if c in has:
            i = 1 + has.index(c)
            out[f"{name}_per_gw"] = float(beta[i])
            out[f"{name}_se"] = float(se[i])
    return out


def _model_check(zone: str, start: pd.Timestamp, end: pd.Timestamp) -> dict | None:
    """Mean wind and solar attribution of the price model on forecast hours in range (against the model's average hour)."""
    try:
        from pipeline.features import latest
        from pipeline.models.explain import explain

        f = latest()
        f = f[(f["zone"] == zone) & (f["ts"] >= start) & (f["ts"] <= end)]
        if f.empty:
            return None
        c = explain(f)
    except Exception:  # noqa: BLE001 - a cross-check must never break the endpoint
        return None
    if not (c[["wind", "solar"]].abs().to_numpy() > 0).any():
        return None
    return {"hours": int(len(c)), "wind_mean": round(float(c["wind"].mean()), 2), "solar_mean": round(float(c["solar"].mean()), 2),
            "note": "Model attribution (LightGBM pred_contrib) on forecast hours, against the model's average hour."}


def _amount(v: float, sym: str) -> str:
    a = abs(v)
    return f"{sym}{a / 1e9:.1f}bn" if a >= 1e9 else f"{sym}{a / 1e6:.0f}m" if a >= 1e6 else f"{sym}{a / 1e3:.0f}k"


def sentence(zone: str, name: str, when: str, wind_eff: float, wind_money: float, solar_eff: float | None, solar_money: float | None) -> str:
    sym = SYMBOL.get(zone, "€")

    def part(label, eff, money):
        verb = "cut" if eff < 0 else "raised"
        return f"{label} {verb} {name} prices by {sym}{abs(eff):.0f}/MWh on average {when}, about {_amount(money, sym)}"

    s = part("Wind", wind_eff, wind_money)
    if solar_eff is not None and abs(solar_eff) >= 0.5:
        s += "; " + part("solar", solar_eff, solar_money).replace(f" {name} prices", " prices")
    return s + " (estimate)."


def renewables(zone: str, start, end, a: pd.DataFrame | None = None, gas: pd.Series | None = None) -> dict:
    start, end = data.as_utc(start).floor("h"), data.as_utc(end).floor("h")
    p = panel(zone, a, gas)
    if p.empty:
        raise LookupError(f"no price data for {zone}")
    train = p[(p.index > end - pd.Timedelta(days=WINDOW_DAYS)) & (p.index <= end + pd.Timedelta(hours=24))]
    m = fit(train)
    if m is None:
        raise LookupError(f"not enough wind and price history for {zone} to estimate an effect")
    sel = p[(p.index >= start) & (p.index <= end) & p["wind_mw"].notna()]
    sym = SYMBOL.get(zone, "€")
    hours = []
    for ts, r in sel.iterrows():
        w = m["wind_per_gw"] * r["wind_mw"] / 1000
        s = m["solar_per_gw"] * r["solar_mw"] / 1000 if "solar_per_gw" in m and pd.notna(r.get("solar_mw")) else None
        load = r.get("load_mw")
        hours.append({
            "ts": ts.to_pydatetime(), "price": None if pd.isna(r["price"]) else round(float(r["price"]), 2),
            "wind_mw": round(float(r["wind_mw"])), "solar_mw": None if pd.isna(r.get("solar_mw", np.nan)) else round(float(r["solar_mw"])),
            "wind_effect_per_mwh": round(float(w), 2), "solar_effect_per_mwh": None if s is None else round(float(s), 2),
            "wind_effect_money": None if pd.isna(load) else round(float(w * load)),
            "solar_effect_money": None if s is None or pd.isna(load) else round(float(s * load)),
        })
    if not hours:
        raise LookupError(f"no wind data for {zone} between {start} and {end}")
    df = pd.DataFrame(hours)
    wm = float(df["wind_effect_money"].sum(skipna=True))
    we = float(df["wind_effect_per_mwh"].mean())
    has_solar = df["solar_effect_per_mwh"].notna().any()
    se_ = float(df["solar_effect_per_mwh"].mean()) if has_solar else None
    sm = float(df["solar_effect_money"].sum(skipna=True)) if has_solar else None
    name = data.NAMES.get(zone, zone)
    when = f"between {start:%d %b %H:%M} and {end:%d %b %H:%M} UTC"
    sig = abs(m["wind_per_gw"]) > 2 * m["wind_se"] and m["wind_per_gw"] < 0
    return {
        "zone": zone, "from": start.to_pydatetime(), "to": end.to_pydatetime(),
        "currency": "GBP" if zone == "GB" else "EUR",
        "wind_per_gw": round(m["wind_per_gw"], 3), "solar_per_gw": None if "solar_per_gw" not in m else round(m["solar_per_gw"], 3),
        "wind_mean_effect_per_mwh": round(we, 2), "wind_total_money": round(wm),
        "solar_mean_effect_per_mwh": None if se_ is None else round(se_, 2), "solar_total_money": None if sm is None else round(sm),
        "sentence": sentence(zone, name, when, we, wm, se_, sm),
        "hours": hours,
        "fit": {"n_hours": m["n_hours"], "r2": m["r2"], "window_from": m["window_from"].to_pydatetime(),
                "window_to": m["window_to"].to_pydatetime(), "wind_se": round(m["wind_se"], 3), "wind_slope_clear": bool(sig)},
        "model_check": _model_check(zone, start, end),
        "kind": "estimated",
        "note": CAVEAT + ("" if sig else " The wind slope is weak or has an unexpected sign in this window: treat the figures with care.")
        + ("" if has_solar else " Solar output is not metered for this zone in our data, so no solar effect is shown."),
        "source": "Energy-Charts / Nord Pool day-ahead prices, Energy-Charts and Elexon generation and load, yfinance TTF gas",
    }
