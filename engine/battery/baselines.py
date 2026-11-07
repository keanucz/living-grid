"""Benchmarks for the forecast-driven batteries: a naive fixed schedule and perfect foresight."""

import pandas as pd

from engine.battery.optimiser import Battery, optimise

# Naive: charge in the small hours, discharge into the evening peak, every day, ignoring prices.
NAIVE_CHARGE_HOURS_UTC = (2, 3)
NAIVE_DISCHARGE_HOURS_UTC = (17, 18)


def naive(hours: pd.Series, battery: Battery = Battery(), soc0_mwh: float = 0.0) -> pd.DataFrame:
    """Plan in the optimiser's format for the given hourly timestamps."""
    soc, rows = soc0_mwh, []
    for ts in pd.to_datetime(pd.Series(hours), utc=True).sort_values():
        e = 0.0
        if ts.hour in NAIVE_CHARGE_HOURS_UTC:
            stored = min(battery.power_mw * battery.eta, battery.energy_mwh - soc)
            e, soc = stored / battery.eta, soc + stored
        elif ts.hour in NAIVE_DISCHARGE_HOURS_UTC:
            drawn = min(battery.power_mw / battery.eta, soc)
            e, soc = -drawn * battery.eta, soc - drawn
        rows.append({"ts": ts, "action": "charge" if e > 1e-9 else "discharge" if e < -1e-9 else "hold",
                     "grid_mwh": e, "mw": -e, "soc_mwh": soc, "plan_price": float("nan"), "planned_pnl": float("nan")})
    return pd.DataFrame(rows)


def perfect_foresight(actual: pd.DataFrame, battery: Battery = Battery(), soc0_mwh: float = 0.0) -> pd.DataFrame:
    """actual: ts, price. The best any battery could have done on these hours."""
    return optimise(actual[["ts", "price"]], "perfect", battery, soc0_mwh)
