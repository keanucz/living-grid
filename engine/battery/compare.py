"""Score the batteries on real outcomes: risk-aware vs median-only vs naive vs perfect foresight.

The forecast-driven batteries re-plan from their current state of charge each time a new forecast is
logged and act on that plan only until the next one (receding horizon). Every strategy is settled on
the same hours, and only on hours whose real day-ahead price is known, so profit is never computed
on a forecast.
"""

import pandas as pd

from engine import data
from engine.battery import baselines
from engine.battery.optimiser import Battery, optimise, settle
from engine.ghost_wind.boalf import read_live
from pipeline import cache

TARGET = "price_da"
FORECAST_LOG = "forecasts/log"
STRATEGIES = ("median_only", "risk_aware", "naive", "perfect_foresight")
MODES = {"median_only": "median", "risk_aware": "risk_aware"}
CURRENCY = {"GB": "GBP"}
EUR_PER_GBP = 1.15
# Below these, a share of perfect foresight is noise: report null with a reason instead of a number.
MIN_PERFECT_PROFIT = 10.0  # per zone, in its currency (a 1 MW / 2 MWh battery earns ~100-150 a day here)
MIN_HOURS = 12  # settled hours per zone


def _utc(s):
    return pd.to_datetime(s, utc=True)


def receding(forecasts: pd.DataFrame, actual: pd.DataFrame, mode: str, battery: Battery = Battery()) -> pd.DataFrame:
    """Execute and settle a forecast-driven battery for one zone.

    forecasts: made_at, ts, p10, p50, p90 (one zone, one target); actual: ts, price.
    Returns the executed plan rows with price and pnl, one row per settled hour.
    """
    prices = actual.assign(ts=_utc(actual["ts"])).drop_duplicates("ts").set_index("ts")["price"]
    f = forecasts.assign(made_at=_utc(forecasts["made_at"]), ts=_utc(forecasts["ts"]))
    issues = sorted(f["made_at"].unique())
    soc, last, done = 0.0, None, []
    for k, made in enumerate(issues):
        until = issues[k + 1] if k + 1 < len(issues) else None
        fc = f[(f["made_at"] == made) & (f["ts"] >= made)].drop_duplicates("ts").sort_values("ts")
        if last is not None:
            fc = fc[fc["ts"] > last]
        if fc.empty:
            continue
        plan = optimise(fc[["ts", "p10", "p50", "p90"]], mode, battery, soc)
        for r in plan.itertuples():
            if (until is not None and r.ts >= until) or r.ts not in prices.index:
                break
            done.append(r._asdict())
            soc, last = r.soc_mwh, r.ts
    if not done:
        return pd.DataFrame(columns=["ts", "action", "grid_mwh", "mw", "soc_mwh", "plan_price", "planned_pnl", "price", "pnl"])
    executed = pd.DataFrame(done).drop(columns="Index")
    return settle(executed, prices.rename("price").reset_index(), battery)


def compare_zone(forecasts: pd.DataFrame, actual: pd.DataFrame, battery: Battery = Battery()) -> dict[str, pd.DataFrame]:
    """Settled hourly rows for every strategy, all on the hours the forecast batteries could settle."""
    out = {name: receding(forecasts, actual, mode, battery) for name, mode in MODES.items()}
    hours = sorted(set(out["median_only"]["ts"]) & set(out["risk_aware"]["ts"]))
    real = actual.assign(ts=_utc(actual["ts"])).drop_duplicates("ts")
    real = real[real["ts"].isin(hours)].sort_values("ts")[["ts", "price"]]
    for name in MODES:
        out[name] = out[name][out[name]["ts"].isin(hours)].reset_index(drop=True)
    if real.empty:
        empty = out["median_only"].iloc[0:0]
        out["naive"] = out["perfect_foresight"] = empty
        return out
    out["naive"] = settle(baselines.naive(real["ts"], battery), real, battery)
    out["perfect_foresight"] = settle(baselines.perfect_foresight(real, battery), real, battery)
    return out


def terminal_value(rows: pd.DataFrame, mark_price: float, battery: Battery = Battery()) -> float:
    """Value of energy still stored when the settled window ends: sold at the window's mean real price.

    Without this, a battery that charged for a peak beyond the window shows the purchase as a pure loss.
    """
    if rows.empty:
        return 0.0
    sold = float(rows["soc_mwh"].iloc[-1]) * battery.eta
    return sold * mark_price - battery.degradation_per_mwh * sold


def summarise(zone: str, settled: dict[str, pd.DataFrame], battery: Battery = Battery()) -> list[dict]:
    """BatteryResult rows (engine.schemas) for one zone; empty when nothing has settled.

    Profit is hourly settled P&L plus the value of energy left in store at the end of the window.
    """
    if settled["perfect_foresight"].empty:
        return []
    mark = float(settled["perfect_foresight"]["price"].mean())
    profit = {name: float(settled[name]["pnl"].sum()) + terminal_value(settled[name], mark, battery) for name in STRATEGIES}
    best, hours = profit["perfect_foresight"], len(settled["perfect_foresight"])
    ok = best >= MIN_PERFECT_PROFIT and hours >= MIN_HOURS
    rows = []
    for name in STRATEGIES:
        pnl = settled[name]["pnl"]
        rows.append({
            "strategy": name, "zone": zone, "profit": round(profit[name], 2), "currency": CURRENCY.get(zone, "EUR"),
            "share_of_perfect": round(profit[name] / best, 4) if ok else None,
            "worst_hour_loss": round(max(0.0, -float(pnl.min())), 2) if len(pnl) else 0.0,
        })
    return rows


def pooled_share(results: list[dict], hours: dict[str, int]) -> tuple[float | None, int, str]:
    """Risk-aware profit over perfect-foresight profit, summed over zones in EUR (not a mean of zone ratios).

    Only zones that have a share of their own are pooled (the rule summarise() uses: enough settled hours and enough
    perfect-foresight profit). A zone that cannot be scored, such as NO2 when prices were flat, would otherwise add its
    loss to the pool while adding nothing to the denominator. Returns (share, settled hours of the pooled zones, note).
    """
    def profit(zone: str, strategy: str) -> float:
        return sum(r["profit"] * (EUR_PER_GBP if r["currency"] == "GBP" else 1.0)
                   for r in results if r["zone"] == zone and r["strategy"] == strategy)

    scored = [z for z, h in hours.items() if h >= MIN_HOURS and profit(z, "perfect_foresight") >= MIN_PERFECT_PROFIT]
    skipped = sorted(set(hours) - set(scored))
    if not scored:
        n = sum(hours.values())
        if not hours or max(hours.values()) < MIN_HOURS:
            return None, n, f"Too few settled hours ({n}) on real day-ahead prices to score the batteries yet"
        return None, n, "Prices have been too flat for perfect foresight to earn much, so a share would be noise"
    n = sum(hours[z] for z in scored)
    best = sum(profit(z, "perfect_foresight") for z in scored)
    note = f"Pooled over {len(scored)} zone{'' if len(scored) == 1 else 's'} and {n} settled hours; energy still stored at the end is valued at the mean real price"
    if skipped:
        note += f". Not scored (too flat or too few hours): {', '.join(skipped)}"
    return round(sum(profit(z, "risk_aware") for z in scored) / best, 4), n, note


def load_inputs() -> tuple[pd.DataFrame | None, pd.DataFrame | None]:
    """(forecast log rows for the day-ahead price, actual day-ahead prices); fixtures only offline."""
    bases = (cache.DATA, cache.FIXTURES) if cache.offline() else (cache.DATA,)
    log = read_live(FORECAST_LOG)
    names = sorted({p.stem for base in bases for p in (base / "actuals").glob("*.parquet")})
    frames = []
    for name in names:
        df = read_live(f"actuals/{name}")
        if (df["series"] == TARGET).any():
            frames.append(df[df["series"] == TARGET].assign(source=data.source_of(name)))
    actual = data.best_rows(pd.concat(frames, ignore_index=True)) if frames else None
    if log is not None:
        log = log[log["target"] == TARGET]
    return log, actual


def run(log: pd.DataFrame | None = None, actual: pd.DataFrame | None = None, battery: Battery = Battery()) -> dict:
    """Every zone: {'results': [BatteryResult...], 'settled': {zone: {strategy: rows}}, 'share': float}."""
    if log is None or actual is None:
        log, actual = load_inputs()
    if log is None or actual is None or log.empty or actual.empty:
        return {"results": [], "settled": {}, "share": None, "n_hours": 0, "note": "No settled hours yet", "bad_hours": {}}
    actual = actual.assign(ts=_utc(actual["ts"]).dt.floor("h")).groupby(["zone", "ts"], as_index=False)["value"].mean()
    results, settled, hours, bad = [], {}, {}, {}
    for zone, fz in log.groupby("zone"):
        az = actual[actual["zone"] == zone].rename(columns={"value": "price"})
        s = compare_zone(fz, az, battery)
        rows = summarise(zone, s, battery)
        if rows:
            results += rows
            settled[zone] = s
            hours[zone] = len(s["perfect_foresight"])
            bad[zone] = bad_hour_saving(s)
    share, n_hours, note = pooled_share(results, hours)
    return {"results": results, "settled": settled, "share": share, "n_hours": n_hours, "note": note, "bad_hours": bad}


def bad_hour_saving(settled: dict[str, pd.DataFrame]) -> float:
    """How much less the risk-aware battery lost than the median-only one across its losing hours."""
    def loss(df: pd.DataFrame) -> float:
        return float(-df.loc[df["pnl"] < 0, "pnl"].sum())

    return loss(settled["median_only"]) - loss(settled["risk_aware"])


def battery_rows(out: dict, battery: Battery = Battery()) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(battery, battery_action) frames for engine.publisher.publish_batteries / publish_battery_actions."""
    bats, acts = [], []
    for zone, s in out["settled"].items():
        for r in (x for x in out["results"] if x["zone"] == zone):
            rows = s[r["strategy"]]
            bats.append({"zone": zone, "strategy": r["strategy"], "soc_mwh": float(rows["soc_mwh"].iloc[-1]),
                         "profit": r["profit"], "currency": r["currency"],
                         "share_of_perfect": float("nan") if r["share_of_perfect"] is None else r["share_of_perfect"]})
            acts.append(rows[["ts", "action", "mw", "soc_mwh", "price"]].assign(zone=zone, strategy=r["strategy"]))
    actions = pd.concat(acts, ignore_index=True) if acts else pd.DataFrame(
        columns=["ts", "zone", "strategy", "action", "mw", "soc_mwh", "price"])
    return pd.DataFrame(bats, columns=["zone", "strategy", "soc_mwh", "profit", "currency", "share_of_perfect"]), actions
