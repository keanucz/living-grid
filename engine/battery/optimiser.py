"""Battery dispatch by dynamic programming over discretised state of charge (hourly steps).

Modes:
- median: optimise against the p50 path.
- risk_aware: p10, p50 and p90 are read as three whole price paths, because forecast errors move
  together across neighbouring hours: a day that comes in high is high at the charge hour and the
  discharge hour alike. The plan maximises its probability-weighted profit minus `risk_aversion`
  times its shortfall on the worst path, so uncertainty that differs between hours discourages
  trading, while uncertainty shared by every hour (which a charge-discharge spread cancels) does not.
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


def _plan(price: np.ndarray, battery: Battery, soc0_mwh: float) -> tuple[np.ndarray, np.ndarray]:
    """(grid MWh, end-of-hour state of charge) per hour maximising sum(-price * g) minus degradation."""
    g, ok = _grid_energy(battery)
    levels = battery.levels
    deg = battery.degradation_per_mwh * np.abs(g)
    n_t, n_s = len(price), len(levels)
    value = np.zeros(n_s)
    policy = np.zeros((n_t, n_s), dtype=np.int64)
    for t in range(n_t - 1, -1, -1):
        q = np.where(ok, -price[t] * g - deg + value[None, :], -np.inf)
        policy[t] = q.argmax(axis=1)
        value = q[np.arange(n_s), policy[t]]
    i = int(np.abs(levels - soc0_mwh).argmin())
    grid, soc = np.zeros(n_t), np.zeros(n_t)
    for t in range(n_t):
        j = policy[t, i]
        grid[t], soc[t] = g[i, j], levels[j]
        i = j
    return grid, soc


def path_objective(grid: np.ndarray, paths: np.ndarray, battery: Battery, risk_aversion: float) -> float:
    """Weighted profit across the three price paths minus risk_aversion times the shortfall to the worst."""
    profit = -(paths @ grid) - battery.degradation_per_mwh * np.abs(grid).sum()
    mean = float(WEIGHTS @ profit)
    return mean - risk_aversion * (mean - float(profit.min()))


BLENDS = np.linspace(0.0, 1.0, 21)


def _blend(paths: np.ndarray, theta: float) -> np.ndarray:
    """A price path sliding from p10 (theta 0) through p50 (0.5) to p90 (1)."""
    if theta <= 0.5:
        a = theta / 0.5
        return (1 - a) * paths[0] + a * paths[1]
    a = (theta - 0.5) / 0.5
    return (1 - a) * paths[1] + a * paths[2]


def _risk_aware(paths: np.ndarray, battery: Battery, soc0_mwh: float, risk_aversion: float):
    """paths: (3, n_t) for p10, p50, p90. The objective is a minimum over paths of
    (1 - r) * mean + r * profit_k, which is not additive over hours; any weighting of the paths is.
    So solve the plain DP on the family (1 - r) * pbar + r * blend(theta) and keep the plan whose true
    objective is best. The weighted-mean plan is always a candidate, so risk-aware never scores below it."""
    pbar = WEIGHTS @ paths
    candidates = [pbar] + [(1 - risk_aversion) * pbar + risk_aversion * _blend(paths, th) for th in BLENDS]
    best = None
    for price in candidates:
        grid, soc = _plan(price, battery, soc0_mwh)
        score = path_objective(grid, paths, battery, risk_aversion)
        if best is None or score > best[0] + 1e-9:
            best = (score, grid, soc)
    return best[1], best[2]


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

    if mode == "risk_aware":
        grid, soc = _risk_aware(p.T, battery, soc0_mwh, risk_aversion)
        plan_price = p[:, 1]
    else:
        grid, soc = _plan(p[:, 0], battery, soc0_mwh)
        plan_price = p[:, 0]
    rows = []
    for t in range(len(df)):
        e = float(grid[t])
        rows.append({
            "ts": df["ts"].iloc[t],
            "action": "charge" if e > 1e-9 else "discharge" if e < -1e-9 else "hold",
            "grid_mwh": e,
            "mw": -e,
            "soc_mwh": float(soc[t]),
            "plan_price": float(plan_price[t]),
            "planned_pnl": -plan_price[t] * e - battery.degradation_per_mwh * abs(e),
        })
    return pd.DataFrame(rows)


def settle(plan: pd.DataFrame, actual: pd.DataFrame, battery: Battery = Battery()) -> pd.DataFrame:
    """Hourly profit of a plan on realised prices. actual: columns ts, price."""
    m = plan.merge(actual[["ts", "price"]], on="ts", how="inner", validate="one_to_one")
    m["pnl"] = -m["price"] * m["grid_mwh"] - battery.degradation_per_mwh * m["grid_mwh"].abs()
    return m


def perfect(actual: pd.DataFrame, battery: Battery = Battery(), soc0_mwh: float = 0.0) -> pd.DataFrame:
    return optimise(actual, "perfect", battery, soc0_mwh)
