"""Settle room-game decisions on GB prices.

Each player runs one 1 MW / 2 MWh battery, 88% round trip, starting half full. A decision covers one half-hour:
charge buys 0.5 MWh from the grid, discharge sells up to 0.5 MWh, hold does nothing; an action the battery cannot
do (charge when full, discharge when empty) is clipped. Undecided half-hours are holds.

Final price: the GB system price. Until it is published the settlement is provisional, on the market index price
when cached (actuals series `market_index`), else on the GB day-ahead price. Our actuals are hourly, so both
half-hours of an hour settle on that hour's price (an approximation of half-hourly settlement).
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from engine import data

SLOT = pd.Timedelta(minutes=30)
FINAL_SERIES = "system_price"
PROVISIONAL_SERIES = ("market_index", "price_da")
COLUMNS = ["key", "identity", "slot", "action", "grid_mwh", "soc_mwh", "price", "final", "pnl"]


@dataclass(frozen=True)
class GameBattery:
    power_mw: float = 1.0
    energy_mwh: float = 2.0
    round_trip: float = 0.88
    degradation_per_mwh: float = 2.0
    soc0_mwh: float = 1.0

    @property
    def eta(self) -> float:
        return float(np.sqrt(self.round_trip))

    @property
    def slot_mwh(self) -> float:
        return self.power_mw * SLOT / pd.Timedelta(hours=1)


def parse_key(key: str) -> tuple[str, pd.Timestamp]:
    """Decision keys are `<identity hex>|<slot microseconds>` (see game.ts decisionKey)."""
    identity, slot_us = key.rsplit("|", 1)
    return identity, pd.Timestamp(int(slot_us), unit="us", tz="UTC")


def decisions_frame(rows: list[list]) -> pd.DataFrame:
    """SQL rows of `SELECT key, action, settled FROM player_decision` as key, identity, slot, action, settled."""
    out = []
    for key, action, settled in rows:
        identity, slot = parse_key(key)
        out.append({"key": key, "identity": identity, "slot": slot, "action": action, "settled": bool(settled)})
    df = pd.DataFrame(out, columns=["key", "identity", "slot", "action", "settled"])
    return df.astype({"slot": "datetime64[us, UTC]", "settled": bool})


def step(soc: float, action: str, b: GameBattery) -> tuple[float, float]:
    """(grid MWh, new state of charge) for one half-hour. Grid is positive when buying."""
    if action == "charge":
        stored = min(b.slot_mwh * b.eta, b.energy_mwh - soc)
        return stored / b.eta, soc + stored
    if action == "discharge":
        sold = min(b.slot_mwh, soc * b.eta)
        return -sold, soc - sold / b.eta
    return 0.0, soc


def simulate(decisions: pd.DataFrame, b: GameBattery = GameBattery()) -> pd.DataFrame:
    """Adds grid_mwh and soc_mwh (end of slot) per decision, walking each player's slots in order."""
    parts = []
    for _, g in decisions.sort_values("slot").groupby("identity", sort=False):
        soc, grid, socs = b.soc0_mwh, [], []
        for action in g["action"]:
            e, soc = step(soc, action, b)
            grid.append(e)
            socs.append(soc)
        parts.append(g.assign(grid_mwh=grid, soc_mwh=socs))
    if not parts:
        return decisions.assign(grid_mwh=pd.Series(dtype=float), soc_mwh=pd.Series(dtype=float))
    return pd.concat(parts)


def gb_prices(actuals: pd.DataFrame | None = None) -> tuple[pd.Series, pd.Series]:
    """(final, provisional) GB prices in GBP/MWh indexed by hourly UTC ts."""
    a = data.actuals() if actuals is None else actuals
    a = a[a["zone"] == "GB"]

    def series(name: str) -> pd.Series:
        return data.best_rows(a, name).set_index("ts")["value"].sort_index()

    final = series(FINAL_SERIES)
    provisional = pd.Series(dtype=float)
    for name in PROVISIONAL_SERIES:
        provisional = provisional.combine_first(series(name))
    return final, provisional


def settle(decisions: pd.DataFrame, final: pd.Series, provisional: pd.Series, now: pd.Timestamp,
           b: GameBattery = GameBattery()) -> pd.DataFrame:
    """Rows to send to settle_decisions: unsettled decisions whose half-hour has ended and has a price."""
    sim = simulate(decisions, b)
    sim = sim[(sim["slot"] + SLOT <= now) & ~sim["settled"]]
    if sim.empty:
        return pd.DataFrame(columns=COLUMNS)
    hour = sim["slot"].dt.floor("h")
    fin = hour.map(final)
    prov = hour.map(provisional)
    sim = sim.assign(final=fin.notna(), price=fin.combine_first(prov))
    sim = sim[sim["price"].notna()]
    sim["pnl"] = (-sim["price"] * sim["grid_mwh"] - b.degradation_per_mwh * sim["grid_mwh"].abs()).round(2)
    return sim[COLUMNS].reset_index(drop=True)


def settlement_rows(settled: pd.DataFrame) -> list[dict]:
    return [{"key": r.key, "pnl": float(r.pnl), "final": bool(r.final)} for r in settled.itertuples()]
