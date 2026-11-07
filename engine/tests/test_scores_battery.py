import pandas as pd
import pytest

from engine.battery import compare
from engine.battery.optimiser import Battery

B = Battery()
TS = pd.date_range("2026-11-07T00:00Z", periods=24, freq="h")


def rows(prices, grid):
    """Settled rows: grid MWh per hour (positive = charging) on real prices, with SOC tracked."""
    soc, socs = 0.0, []
    for g in grid:
        soc += g * B.eta if g > 0 else g / B.eta
        socs.append(soc)
    df = pd.DataFrame({"ts": TS[: len(prices)], "grid_mwh": grid, "soc_mwh": socs, "price": prices})
    df["pnl"] = -df["price"] * df["grid_mwh"] - B.degradation_per_mwh * df["grid_mwh"].abs()
    return df


def settled(prices, strategies):
    return {name: rows(prices, grid) for name, grid in strategies.items()}


def test_energy_left_in_store_is_valued_not_counted_as_a_loss():
    prices = [100.0] * 12 + [200.0] * 12
    # Charges 2 MWh early and never sells inside the window (waiting for a peak beyond it).
    holder = [1.0, 1.0] + [0.0] * 22
    perfect = [1.0, 1.0] + [0.0] * 10 + [-0.9, -0.9] + [0.0] * 10
    s = settled(prices, {"median_only": holder, "risk_aware": holder, "naive": perfect, "perfect_foresight": perfect})
    res = {r["strategy"]: r for r in compare.summarise("DE-LU", s, B)}
    hourly_only = float(s["risk_aware"]["pnl"].sum())
    assert hourly_only < -150, "without terminal value the purchase looks like a pure loss"
    assert res["risk_aware"]["profit"] > hourly_only + 200
    assert res["risk_aware"]["share_of_perfect"] is not None and res["risk_aware"]["share_of_perfect"] > -0.5


def test_near_zero_perfect_profit_zone_reports_null_not_a_huge_ratio():
    flat = [200.0] * 24
    s = settled(flat, {"median_only": [1.0] + [0.0] * 23, "risk_aware": [1.0] + [0.0] * 23,
                       "naive": [0.0] * 24, "perfect_foresight": [0.0] * 24})
    res = compare.summarise("NO2", s, B)
    assert all(r["share_of_perfect"] is None for r in res)


def test_headline_pools_sums_not_mean_of_ratios():
    results = [
        {"zone": "FR", "strategy": "risk_aware", "profit": 120.0, "currency": "EUR"},
        {"zone": "FR", "strategy": "perfect_foresight", "profit": 130.0, "currency": "EUR"},
        {"zone": "NO2", "strategy": "risk_aware", "profit": -20.0, "currency": "EUR"},
        {"zone": "NO2", "strategy": "perfect_foresight", "profit": 11.0, "currency": "EUR"},
    ]
    share, n, note = compare.pooled_share(results, {"FR": 24, "NO2": 24})
    mean_of_ratios = (120 / 130 + -20 / 11) / 2
    assert mean_of_ratios < 0 < share
    assert share == pytest.approx(100 / 141, abs=1e-4) and n == 48 and "Pooled over 2 zones" in note


def test_gbp_converted_before_pooling():
    results = [
        {"zone": "GB", "strategy": "risk_aware", "profit": 100.0, "currency": "GBP"},
        {"zone": "GB", "strategy": "perfect_foresight", "profit": 100.0, "currency": "GBP"},
        {"zone": "FR", "strategy": "risk_aware", "profit": 0.0, "currency": "EUR"},
        {"zone": "FR", "strategy": "perfect_foresight", "profit": 115.0, "currency": "EUR"},
    ]
    share, _, _ = compare.pooled_share(results, {"GB": 24, "FR": 24})
    assert share == pytest.approx(115 / 230, abs=1e-4)


def test_too_few_hours_is_null_with_reason():
    results = [{"zone": "GB", "strategy": s, "profit": 50.0, "currency": "GBP"} for s in ("risk_aware", "perfect_foresight")]
    share, n, note = compare.pooled_share(results, {"GB": 3})
    assert share is None and n == 3 and "Too few settled hours" in note


def test_flat_prices_everywhere_is_null_with_reason():
    results = [{"zone": "NO2", "strategy": s, "profit": 1.0, "currency": "EUR"} for s in ("risk_aware", "perfect_foresight")]
    share, _, note = compare.pooled_share(results, {"NO2": 24})
    assert share is None and "too flat" in note
