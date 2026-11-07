import time

import numpy as np
import pandas as pd
import pytest

from engine.battery import Battery, optimise, perfect, settle
from pipeline import cache

B = Battery()
TS = pd.date_range("2026-11-08", periods=24, freq="h", tz="UTC")


def frame(p50, spread=10.0):
    p50 = np.asarray(p50, float)
    spread = np.broadcast_to(np.asarray(spread, float), p50.shape)
    return pd.DataFrame({"ts": TS[: len(p50)], "p10": p50 - spread, "p50": p50, "p90": p50 + spread})


def actual(prices):
    return pd.DataFrame({"ts": TS[: len(prices)], "price": np.asarray(prices, float)})


def duck_curve():
    h = np.arange(24)
    return 60 + 40 * np.exp(-((h - 18) ** 2) / 4) - 25 * np.exp(-((h - 3) ** 2) / 6)


@pytest.mark.parametrize("mode", ["median", "risk_aware"])
def test_never_exceeds_limits(mode):
    rng = np.random.default_rng(0)
    plan = optimise(frame(rng.normal(80, 40, 24), rng.uniform(1, 50, 24)), mode)
    assert plan["soc_mwh"].between(-1e-9, B.energy_mwh + 1e-9).all()
    assert (plan["grid_mwh"].abs() <= B.power_mw + 1e-9).all()
    soc = np.concatenate([[0.0], plan["soc_mwh"].to_numpy()])
    stored = np.where(plan["grid_mwh"] > 0, plan["grid_mwh"] * B.eta, plan["grid_mwh"] / B.eta)
    assert np.allclose(np.diff(soc), stored, atol=1e-9)


def test_charges_cheap_discharges_dear():
    p = duck_curve()
    plan = optimise(frame(p), "median")
    charge = plan.loc[plan["action"] == "charge", "plan_price"]
    discharge = plan.loc[plan["action"] == "discharge", "plan_price"]
    assert len(charge) and len(discharge)
    assert charge.max() < discharge.min()
    assert plan.loc[plan["ts"].dt.hour == 18, "action"].item() == "discharge"
    assert plan.loc[plan["ts"].dt.hour == 3, "action"].item() == "charge"


def test_flat_prices_mean_no_trading():
    plan = optimise(frame(np.full(24, 70.0)), "median")
    assert (plan["action"] == "hold").all()


def test_round_trip_losses_stop_small_spreads():
    p = np.full(24, 100.0)
    p[2] = 95.0  # 5% spread is less than 12% round-trip loss
    assert (optimise(frame(p), "median")["action"] == "hold").all()


def test_perfect_foresight_beats_every_mode():
    log = cache.read("forecasts/log")
    fc = log[(log["zone"] == "GB") & (log["target"] == "price_da")].sort_values("ts").head(24)
    fc = fc[["ts", "p10", "p50", "p90"]].reset_index(drop=True)
    rng = np.random.default_rng(1)
    real = pd.DataFrame({"ts": fc["ts"], "price": fc["p50"] + rng.normal(0, 15, len(fc))})
    best = settle(perfect(real), real)["pnl"].sum()
    assert best > 0
    for mode in ("median", "risk_aware"):
        assert settle(optimise(fc, mode), real)["pnl"].sum() <= best + 1e-9


def test_risk_aware_loses_less_when_the_wide_band_hours_go_badly():
    # Bands 80 wide over the evening peak, 5 elsewhere. The median plan sells into the peak and loses on the
    # low path; risk-aware limits that exposure (by avoiding or hedging those hours), and more aversion
    # never makes the worst path worse.
    from engine.battery.optimiser import path_objective

    p = duck_curve()
    wide = (np.arange(24) >= 16) & (np.arange(24) <= 20)
    f = frame(p, np.where(wide, 80.0, 5.0))
    paths = f[["p10", "p50", "p90"]].to_numpy(float).T

    def worst(grid):
        return float((-(paths @ grid) - B.degradation_per_mwh * np.abs(grid).sum()).min())

    median = optimise(f, "median")["grid_mwh"].to_numpy()
    plans = [optimise(f, "risk_aware", risk_aversion=lam)["grid_mwh"].to_numpy() for lam in (0.0, 0.5, 0.75, 1.0)]
    assert worst(median) < 0
    assert worst(plans[-1]) > 0
    assert all(worst(a) <= worst(b) + 1e-6 for a, b in zip(plans, plans[1:]))
    assert path_objective(plans[1], paths, B, 0.5) >= path_objective(median, paths, B, 0.5)


def test_risk_aware_still_trades_when_every_hour_is_equally_uncertain():
    # Live regression (20:20 Sat): bands ~EUR 67 wide in every hour made the per-hour penalty idle the
    # battery (9% of perfect foresight in BE). Uncertainty shared by every hour cancels in a spread.
    f = frame(60 + 0.6 * (duck_curve() - 60), 34.0)  # bands 68 wide everywhere, close to live BE at 20:20
    median = optimise(f, "median")["grid_mwh"].abs().sum()
    risky = optimise(f, "risk_aware")["grid_mwh"].abs().sum()
    assert median > 1.0
    assert risky >= 0.8 * median


def test_risk_aware_plan_is_at_least_as_good_as_median_on_its_own_objective():
    from engine.battery.optimiser import path_objective

    p = duck_curve()
    f = frame(p, np.where((np.arange(24) >= 16) & (np.arange(24) <= 20), 60.0, 8.0))
    paths = f[["p10", "p50", "p90"]].to_numpy(float).T
    for lam in (0.0, 0.5, 1.0):
        risky = optimise(f, "risk_aware", risk_aversion=lam)["grid_mwh"].to_numpy()
        median = optimise(f, "median")["grid_mwh"].to_numpy()
        assert path_objective(risky, paths, B, lam) >= path_objective(median, paths, B, lam) - 1e-6


def test_settle_uses_realised_prices():
    plan = optimise(frame(duck_curve()), "median")
    real = actual(np.full(24, 70.0))
    pnl = settle(plan, real)
    assert pnl["pnl"].sum() < 0  # with flat outturn, any trade only loses to losses and degradation


def test_under_50ms_per_zone_day():
    f = frame(duck_curve())
    optimise(f, "risk_aware")
    start = time.perf_counter()
    for _ in range(10):
        optimise(f, "risk_aware")
    assert (time.perf_counter() - start) / 10 < 0.05


def test_rejects_bad_input():
    with pytest.raises(ValueError):
        optimise(frame(duck_curve()), "greedy")
    bad = frame(duck_curve())
    bad.loc[3, "p50"] = np.nan
    with pytest.raises(ValueError):
        optimise(bad, "median")
