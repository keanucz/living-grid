"""Score the batteries on real outcomes: risk-aware vs median-only vs naive vs perfect foresight.

The forecast-driven batteries re-plan from their current state of charge each time a new forecast is
logged and act on that plan only until the next one (receding horizon). Every strategy is settled on
the same hours, and only on hours whose real day-ahead price is known, so profit is never computed
on a forecast.
"""

import numpy as np
import pandas as pd

from engine.battery import baselines
from engine.battery.optimiser import Battery, optimise, settle
from engine.ghost_wind.boalf import read_live
from pipeline import cache

TARGET = "price_da"
FORECAST_LOG = "forecasts/log"
STRATEGIES = ("median_only", "risk_aware", "naive", "perfect_foresight")
MODES = {"median_only": "median", "risk_aware": "risk_aware"}
CURRENCY = {"GB": "GBP"}


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


def summarise(zone: str, settled: dict[str, pd.DataFrame]) -> list[dict]:
    """BatteryResult rows (engine.schemas) for one zone; empty when nothing has settled."""
    if settled["perfect_foresight"].empty:
        return []
    best = float(settled["perfect_foresight"]["pnl"].sum())
    rows = []
    for name in STRATEGIES:
        pnl = settled[name]["pnl"]
        profit = float(pnl.sum())
        rows.append({
            "strategy": name, "zone": zone, "profit": round(profit, 2), "currency": CURRENCY.get(zone, "EUR"),
            "share_of_perfect": round(profit / best, 4) if best > 0 else 0.0,
            "worst_hour_loss": round(max(0.0, -float(pnl.min())), 2),
        })
    return rows


def load_inputs() -> tuple[pd.DataFrame | None, pd.DataFrame | None]:
    """(forecast log rows for the day-ahead price, actual day-ahead prices); fixtures only offline."""
    bases = (cache.DATA, cache.FIXTURES) if cache.offline() else (cache.DATA,)
    log = read_live(FORECAST_LOG)
    names = sorted({p.stem for base in bases for p in (base / "actuals").glob("*.parquet")})
    frames = []
    for name in names:
        df = read_live(f"actuals/{name}")
        if (df["series"] == TARGET).any():
            frames.append(df[df["series"] == TARGET])
    actual = pd.concat(frames, ignore_index=True) if frames else None
    if log is not None:
        log = log[log["target"] == TARGET]
    return log, actual


def run(log: pd.DataFrame | None = None, actual: pd.DataFrame | None = None, battery: Battery = Battery()) -> dict:
    """Every zone: {'results': [BatteryResult...], 'settled': {zone: {strategy: rows}}, 'share': float}."""
    if log is None or actual is None:
        log, actual = load_inputs()
    if log is None or actual is None or log.empty or actual.empty:
        return {"results": [], "settled": {}, "share": 0.0, "bad_hours": {}}
    actual = actual.assign(ts=_utc(actual["ts"]).dt.floor("h")).groupby(["zone", "ts"], as_index=False)["value"].mean()
    results, settled, shares, bad = [], {}, [], {}
    for zone, fz in log.groupby("zone"):
        az = actual[actual["zone"] == zone].rename(columns={"value": "price"})
        s = compare_zone(fz, az, battery)
        rows = summarise(zone, s)
        if rows:
            results += rows
            settled[zone] = s
            shares.append(next(r["share_of_perfect"] for r in rows if r["strategy"] == "risk_aware"))
            bad[zone] = bad_hour_saving(s)
    return {"results": results, "settled": settled, "share": float(np.mean(shares)) if shares else 0.0, "bad_hours": bad}


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
                         "profit": r["profit"], "currency": r["currency"], "share_of_perfect": r["share_of_perfect"]})
            acts.append(rows[["ts", "action", "mw", "soc_mwh", "price"]].assign(zone=zone, strategy=r["strategy"]))
    actions = pd.concat(acts, ignore_index=True) if acts else pd.DataFrame(
        columns=["ts", "zone", "strategy", "action", "mw", "soc_mwh", "price"])
    return pd.DataFrame(bats, columns=["zone", "strategy", "soc_mwh", "profit", "currency", "share_of_perfect"]), actions
