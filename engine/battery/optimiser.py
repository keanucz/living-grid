"""Battery dispatch by dynamic programming over discretised state of charge (hourly steps).

Modes:
- median: optimise against the p50 path.
- risk_aware: per hour, the probability-weighted reward across p10/p50/p90 minus `risk_aversion`
  times its shortfall to the worst of the three, so wide bands discourage trading.
- perfect: optimise against known prices (the perfect-foresight benchmark).

Grid energy is positive when bought (charging) and negative when sold. Profit is always settled
on realised prices with `settle`, never on the forecast used to plan.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

QUANTILES = ("p10", "p50", "p90")
# Swanson-Megill weights: a three-point approximation of the distribution from P10/P50/P90.
WEIGHTS = np.array([0.3, 0.4, 0.3])


@dataclass(frozen=True)
class Battery:
    power_mw: float = 1.0
    energy_mwh: float = 2.0
    round_trip: float = 0.88
    degradation_per_mwh: float = 2.0  # per MWh of grid throughput, in the price currency
    soc_step_mwh: float = 0.05

    @property
    def eta(self) -> float:
        return float(np.sqrt(self.round_trip))

    @property
    def levels(self) -> np.ndarray:
        n = int(round(self.energy_mwh / self.soc_step_mwh))
        return np.linspace(0.0, self.energy_mwh, n + 1)


def _grid_energy(battery: Battery) -> tuple[np.ndarray, np.ndarray]:
    """Grid MWh for each (from level i, to level j) move in one hour, and the feasibility mask."""
    s = battery.levels
    d = s[None, :] - s[:, None]
    g = np.where(d > 0, d / battery.eta, d * battery.eta)
    ok = np.abs(g) <= battery.power_mw + 1e-9
    return g, ok


def _hour_reward(g: np.ndarray, prices: np.ndarray, battery: Battery, mode: str, risk_aversion: float) -> np.ndarray:
    """Reward matrix for one hour. prices: shape (3,) for p10/p50/p90 or (1,) for a known price."""
    deg = battery.degradation_per_mwh * np.abs(g)
    if mode != "risk_aware":
        return -prices[0] * g - deg
    r = -prices[:, None, None] * g[None] - deg[None]
    mean = np.tensordot(WEIGHTS, r, axes=1)
    return mean - risk_aversion * (mean - r.min(axis=0))


def optimise(
    prices: pd.DataFrame,
    mode: str = "median",
    battery: Battery = Battery(),
    soc0_mwh: float = 0.0,
    risk_aversion: float = 0.5,
) -> pd.DataFrame:
    """Plan dispatch for an hourly price frame.

    prices: columns ts and p10, p50, p90 (median, risk_aware) or price (perfect), one row per hour.
    Returns ts, action, grid_mwh, mw (positive = discharging to the grid), soc_mwh (end of hour),
    plan_price (price the plan assumed) and planned_pnl.
    """
    if mode not in ("median", "risk_aware", "perfect"):
        raise ValueError(f"unknown mode {mode!r}")
    df = prices.sort_values("ts").reset_index(drop=True)
    if mode == "perfect":
        p = df[["price"]].to_numpy(float)
    elif mode == "median":
        p = df[["p50"]].to_numpy(float)
    else:
        p = df[list(QUANTILES)].to_numpy(float)
    if not np.isfinite(p).all():
        raise ValueError("prices must be finite")

    g, ok = _grid_energy(battery)
    levels = battery.levels
    n_t, n_s = len(df), len(levels)
    value = np.zeros(n_s)
    policy = np.zeros((n_t, n_s), dtype=np.int64)
    for t in range(n_t - 1, -1, -1):
        q = np.where(ok, _hour_reward(g, p[t], battery, mode, risk_aversion) + value[None, :], -np.inf)
        policy[t] = q.argmax(axis=1)
        value = q[np.arange(n_s), policy[t]]

    i = int(np.abs(levels - soc0_mwh).argmin())
    rows = []
    for t in range(n_t):
        j = policy[t, i]
        e = g[i, j]
        plan_price = p[t, 1] if mode == "risk_aware" else p[t, 0]
        rows.append({
            "ts": df["ts"].iloc[t],
            "action": "charge" if e > 1e-9 else "discharge" if e < -1e-9 else "hold",
            "grid_mwh": e,
            "mw": -e,
            "soc_mwh": levels[j],
            "plan_price": plan_price,
            "planned_pnl": -plan_price * e - battery.degradation_per_mwh * abs(e),
        })
        i = j
    return pd.DataFrame(rows)


def settle(plan: pd.DataFrame, actual: pd.DataFrame, battery: Battery = Battery()) -> pd.DataFrame:
    """Hourly profit of a plan on realised prices. actual: columns ts, price."""
    m = plan.merge(actual[["ts", "price"]], on="ts", how="inner", validate="one_to_one")
    m["pnl"] = -m["price"] * m["grid_mwh"] - battery.degradation_per_mwh * m["grid_mwh"].abs()
    return m


def perfect(actual: pd.DataFrame, battery: Battery = Battery(), soc0_mwh: float = 0.0) -> pd.DataFrame:
    return optimise(actual, "perfect", battery, soc0_mwh)
