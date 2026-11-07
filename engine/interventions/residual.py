"""Shared pieces for residual-load events: verified capacities, spill-over to neighbours, wind output change."""

import numpy as np
import pandas as pd

from engine import data
from engine.ghost_wind.weather_gap import AVAILABILITY, power_curve, to_hub_height
from engine.interventions.base import MERIT_SLOPE_PER_GW

# Verified (engine/reference/facts/events.json); test_interventions_more checks the ids.
FR_NUCLEAR_MW = 63_000  # ev_fr_nuclear_capacity
FR_REACTOR_MW = (900, 1300, 1450, 1630)  # ev_fr_reactor_size (Flamanville 3 is 1630)
FR_LOAD_PER_DEG_C_MW = 2400  # ev_fr_temp_sensitivity (RTE, winter)
GB_WIND_MW = 14_300 + 16_000  # ev_gb_wind_capacity (onshore + offshore)

# TODO(#76): replace with the re-researched figure from engine/reference/facts/events.json
GB_LOAD_PER_DEG_C_MW = 450
# TODO(#76): replace with the re-researched figure from engine/reference/facts/events.json
SCOTLAND_WIND_MW = 15_200

# Standard estimates, labelled as such on screen.
BE_NUCLEAR_MW = 2_100
LOAD_PER_DEG_C_MW = {"FR": FR_LOAD_PER_DEG_C_MW, "GB": GB_LOAD_PER_DEG_C_MW, "DE-LU": 900, "NL": 300, "BE": 250, "NO2": 350}
WIND_MW = {"GB": GB_WIND_MW, "DE-LU": 72_000, "FR": 23_000, "NL": 12_000, "BE": 5_500, "NO2": 1_500}
IMPORT_SHARE = 0.3  # share of a zone's shortfall (or surplus) met by its neighbours through the links


def neighbours(zone: str) -> dict[str, float]:
    """v1 neighbours of `zone` and the total link capacity to each, in MW."""
    out: dict[str, float] = {}
    for link in data.interconnectors():
        a, b = link["from_zone"], link["to_zone"]
        other = b if a == zone else a if b == zone else None
        if other in data.ZONES:
            out[other] = out.get(other, 0.0) + link["capacity_mw"]
    return out


def spread(residual_mw: dict[str, float], import_share: float = IMPORT_SHARE) -> dict[str, float]:
    """Pass part of each zone's residual-load change to its neighbours, in proportion to link capacity."""
    out = dict.fromkeys(data.ZONES, 0.0)
    for zone, d in residual_mw.items():
        nb = {z: c for z, c in neighbours(zone).items() if z not in residual_mw}
        total = sum(nb.values())
        if not total:
            out[zone] += d
            continue
        out[zone] += d * (1 - import_share)
        for z, c in nb.items():
            out[z] += d * import_share * c / total
    return out


def wind_change_mw(feats: pd.DataFrame, speed_factor: float, capacity_mw: dict[str, float]) -> np.ndarray:
    """Per-row change in wind output (MW) when wind speeds are scaled by `speed_factor`."""
    ws = to_hub_height(feats["wind_speed_100m"].to_numpy(float))
    cap = feats["zone"].map(capacity_mw).fillna(0.0).to_numpy(float)
    d = cap * AVAILABILITY * (power_curve(ws * speed_factor) - power_curve(ws))
    return np.nan_to_num(d)


def price_from_residual(feats: pd.DataFrame, residual_rows_mw: np.ndarray) -> np.ndarray:
    """Per-row price change from a per-row residual-load change, through the merit-order slope."""
    slope = feats["zone"].map(MERIT_SLOPE_PER_GW).fillna(0.0).to_numpy(float)
    return residual_rows_mw / 1000 * slope


def headline(result: dict, zone: str, phrase: str) -> None:
    """Lead the explanation with the zone the event hits, rather than GB."""
    z = next((x for x in result["zones"] if x["zone"] == zone), None)
    if z is None or zone == "GB":
        return
    sym = "£" if z["currency"] == "GBP" else "€"
    d = z["avg_delta"]
    gb = next((x["avg_delta"] for x in result["zones"] if x["zone"] == "GB"), None)
    tail = f"; GB {'+' if gb >= 0 else '-'}£{abs(gb):.0f}" if gb is not None else ""
    name = data.NAMES[zone] if zone != "NO2" else "Norway"
    result["explanation"]["sentence"] = (
        f"{name} price {'up' if d >= 0 else 'down'} {sym}{abs(d):.0f}: {phrase} ({'+' if d >= 0 else '-'}{sym}{abs(d):.0f}){tail}"
    )
