"""The agent player: plans its half-hours with the risk-aware battery optimiser on our latest GB forecast."""

import pandas as pd

from engine import data
from engine.battery.optimiser import Battery, optimise
from engine.game.settle import SLOT, GameBattery, simulate

AGENT_HEX = "0000000000000000000000000000000000000000000000000000000000a9e470"  # matches AGENT_HEX in spacetime game.ts
AGENT_NAME = "Grid agent (our forecast)"
TARGETS = ("gb_system_price", "price_da")
HORIZON_H = 12


def latest_forecast(now: pd.Timestamp, log: pd.DataFrame | None = None) -> pd.DataFrame:
    """ts, p10, p50, p90 for GB hours from now on, from the newest run made by now (system price preferred)."""
    f = data.forecast_log() if log is None else log
    f = f[(f["zone"] == "GB") & (f["made_at"] <= now) & (f["ts"] >= now.floor("h"))]
    for target in TARGETS:
        g = f[f["target"] == target]
        if len(g):
            g = g[g["made_at"] == g["made_at"].max()]
            return g.sort_values("ts")[["ts", "p10", "p50", "p90"]].head(HORIZON_H).reset_index(drop=True)
    return pd.DataFrame(columns=["ts", "p10", "p50", "p90"])


def current_soc(decisions: pd.DataFrame, before: pd.Timestamp, b: GameBattery = GameBattery()) -> float:
    mine = decisions[(decisions["identity"] == AGENT_HEX) & (decisions["slot"] < before)]
    if mine.empty:
        return b.soc0_mwh
    return float(simulate(mine, b).sort_values("slot")["soc_mwh"].iloc[-1])


def plan(forecast: pd.DataFrame, soc0_mwh: float, now: pd.Timestamp, b: GameBattery = GameBattery()) -> list[dict]:
    """Agent decisions for future half-hours: each planned hour's action applied to both of its half-hours.

    One hour at 1 MW is two half-hour slots of 0.5 MWh, so the hourly plan maps exactly onto game slots.
    """
    if forecast.empty:
        return []
    battery = Battery(power_mw=b.power_mw, energy_mwh=b.energy_mwh, round_trip=b.round_trip,
                      degradation_per_mwh=b.degradation_per_mwh)
    hourly = optimise(forecast, "risk_aware", battery, soc0_mwh)
    out = []
    for r in hourly.itertuples():
        for slot in (r.ts, r.ts + SLOT):
            if slot > now:
                out.append({"slot_us": int(slot.value // 1000), "action": r.action})
    return out
