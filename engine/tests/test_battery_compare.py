import numpy as np
import pandas as pd
import pytest

from engine import schemas as s
from engine.battery import Battery, baselines, compare
from engine.battery.optimiser import settle
from engine.routes import scores as scores_route

START = pd.Timestamp("2026-11-05 00:00", tz="UTC")
HOURS = pd.date_range(START, periods=72, freq="h")


def duck(ts):
    h = ts.hour.to_numpy()
    return 60 + 45 * np.exp(-((h - 18) ** 2) / 4) - 25 * np.exp(-((h - 3) ** 2) / 6)


def make(zone="GB", noise=12.0, spread=15.0, seed=0, issue_every=6):
    """A forecast log issued every few hours over 3 days, and noisy real prices."""
    rng = np.random.default_rng(seed)
    real = duck(HOURS) + rng.normal(0, noise, len(HOURS))
    actual = pd.DataFrame({"ts": HOURS, "zone": zone, "series": "price_da", "value": real, "unit": "x"})
    rows = []
    for made in HOURS[::issue_every]:
        ts = pd.date_range(made, periods=24, freq="h")
        p50 = duck(ts) + rng.normal(0, 3, len(ts))
        for t, m in zip(ts, p50, strict=True):
            rows.append({"made_at": made, "zone": zone, "target": "price_da", "ts": t, "horizon_h": 1,
                         "p10": m - spread, "p50": m, "p90": m + spread, "model_version": "test"})
    return pd.DataFrame(rows), actual


def test_naive_schedule_respects_limits():
    plan = baselines.naive(pd.Series(HOURS))
    b = Battery()
    assert plan["soc_mwh"].between(-1e-9, b.energy_mwh + 1e-9).all()
    assert (plan["grid_mwh"].abs() <= b.power_mw + 1e-9).all()
    assert set(plan.loc[plan["action"] == "charge", "ts"].dt.hour) == set(baselines.NAIVE_CHARGE_HOURS_UTC)
    assert set(plan.loc[plan["action"] == "discharge", "ts"].dt.hour) == set(baselines.NAIVE_DISCHARGE_HOURS_UTC)


def test_receding_only_settles_real_hours_once():
    log, actual = make()
    actual = actual[actual["ts"] < START + pd.Timedelta(hours=50)]
    rows = compare.receding(log, actual.rename(columns={"value": "price"}), "median")
    assert rows["ts"].is_unique and rows["ts"].is_monotonic_increasing
    assert rows["ts"].max() < START + pd.Timedelta(hours=50)
    assert np.allclose(rows["pnl"], -rows["price"] * rows["grid_mwh"] - Battery().degradation_per_mwh * rows["grid_mwh"].abs())


def test_receding_soc_is_continuous():
    log, actual = make()
    rows = compare.receding(log, actual.rename(columns={"value": "price"}), "risk_aware")
    soc = np.concatenate([[0.0], rows["soc_mwh"].to_numpy()])
    b = Battery()
    stored = np.where(rows["grid_mwh"] > 0, rows["grid_mwh"] * b.eta, rows["grid_mwh"] / b.eta)
    assert np.allclose(np.diff(soc), stored, atol=1e-9)


def test_perfect_foresight_tops_every_strategy():
    for seed in range(3):
        log, actual = make(seed=seed)
        out = compare.run(log, actual)
        res = {r["strategy"]: r for r in out["results"]}
        assert set(res) == set(compare.STRATEGIES)
        best = res["perfect_foresight"]["profit"]
        assert best > 0 and res["perfect_foresight"]["share_of_perfect"] == 1.0
        for name in ("median_only", "risk_aware", "naive"):
            assert res[name]["profit"] <= best + 1e-6
        assert res["median_only"]["share_of_perfect"] > 0.3


def test_all_strategies_settled_on_same_hours():
    log, actual = make()
    out = compare.run(log, actual)
    hours = [set(df["ts"]) for df in out["settled"]["GB"].values()]
    assert all(h == hours[0] for h in hours) and len(hours[0]) > 24


def test_results_match_contract_and_currency():
    a, b = make("GB"), make("FR", seed=4)
    out = compare.run(pd.concat([a[0], b[0]]), pd.concat([a[1], b[1]]))
    for r in out["results"]:
        s.BatteryResult.model_validate(r)
    cur = {r["zone"]: r["currency"] for r in out["results"]}
    assert cur == {"GB": "GBP", "FR": "EUR"}
    assert 0 < out["share"] <= 1


def test_no_settled_hours_means_no_results():
    log, actual = make()
    future = actual.assign(ts=actual["ts"] + pd.Timedelta(days=30))
    out = compare.run(log, future)
    assert out["results"] == [] and out["share"] is None and out["n_hours"] == 0


def test_publish_rows_shape():
    log, actual = make()
    out = compare.run(log, actual)
    bats, acts = compare.battery_rows(out)
    assert set(bats["strategy"]) == set(compare.STRATEGIES)
    from engine.publisher import rows as R

    assert set(R.batteries(bats)[0]) == {"zone", "strategy", "currency", "soc_mwh", "profit", "share_of_perfect"}
    assert set(R.battery_actions(acts)[0]) == {"ts_us", "zone", "strategy", "action", "mw", "soc_mwh", "price"}


def test_scores_route_uses_comparison(monkeypatch):
    log, actual = make()
    monkeypatch.setattr(scores_route.cache, "exists", lambda name: True)
    real_run = compare.run
    monkeypatch.setattr(compare, "run", lambda: real_run(log, actual))
    body = s.ScoresResponse.model_validate(scores_route.build_scores())
    assert {b.strategy for b in body.battery} == set(compare.STRATEGIES)
    risk = next(b for b in body.battery if b.strategy == "risk_aware")
    assert body.headline.battery_share_of_perfect == pytest.approx(risk.share_of_perfect)


def test_settle_against_perfect_on_flat_prices_is_zero():
    flat = pd.DataFrame({"ts": HOURS[:24], "price": 50.0})
    assert settle(baselines.perfect_foresight(flat), flat)["pnl"].sum() == pytest.approx(0.0)
