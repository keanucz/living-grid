import json

import numpy as np
import pandas as pd
import pytest

from pipeline import evaluation
from pipeline.tests.test_backtest import KW
from pipeline.tests.test_features import populated  # noqa: F401  (fixture)


def test_dm_detects_a_clearly_better_model_and_a_clearly_worse_one():
    rng = np.random.default_rng(0)
    base = rng.normal(0, 10, 2000)
    good = evaluation.diebold_mariano(rng.normal(0, 4, 2000), base)
    bad = evaluation.diebold_mariano(base, rng.normal(0, 4, 2000))
    assert good["significant"] and good["mean_gain"] > 0 and good["dm_stat"] > 5
    assert bad["significant"] and bad["mean_gain"] < 0


def test_dm_identical_errors_and_tiny_samples_are_not_significant():
    e = np.random.default_rng(1).normal(0, 5, 500)
    same = evaluation.diebold_mariano(e, e)
    assert same["mean_gain"] == 0 and not same["significant"] and same["p_value"] is None
    short = evaluation.diebold_mariano(e[:10], e[10:20] * 3)
    assert short["n"] == 10 and short["dm_stat"] is None and not short["significant"]


def test_pit_bins_sum_to_one_and_match_known_positions():
    q = np.tile([10.0, 20.0, 30.0], (4, 1))
    y = np.array([5.0, 15.0, 25.0, 35.0])
    assert evaluation.pit_bins(y, q) == [0.25, 0.25, 0.25, 0.25]
    assert sum(evaluation.pit_bins(np.random.default_rng(3).normal(20, 9, 300), np.tile([10.0, 20.0, 30.0], (300, 1)))) == pytest.approx(1)


def rows_for(n_days=10):
    ts = pd.date_range("2026-10-01", periods=24 * n_days, freq="h", tz="UTC")
    rng = np.random.default_rng(4)
    y = rng.normal(50, 10, len(ts))
    return pd.DataFrame({"fold": 0, "ts": ts, "zone": "FR", "target": "price_da", "y": y, "p10": 50 - 13.0, "p50": 50.0,
                         "p90": 50 + 13.0, "persistence": np.roll(y, 24), "yesterday": np.roll(y, 24)})


def test_storm_days_are_the_windiest_and_calibration_splits_by_regime():
    rows = rows_for()
    wind = pd.DataFrame({"ts": rows["ts"], "zone": "GB", "series": "gen_wind", "value": 1000.0 + 100 * np.arange(len(rows)) // 24})
    storms = evaluation.storm_days(wind, 0.95)
    assert storms == {pd.Timestamp("2026-10-10").date()}
    storm = rows["ts"].dt.date == pd.Timestamp("2026-10-10").date()
    rows.loc[storm, "y"] = 500.0
    cal = pd.DataFrame(evaluation.calibration_table(rows, storms))
    allz = cal[(cal.zone == "all")].set_index("regime")
    assert allz.loc["storm", "coverage_p10_p90"] == 0 and allz.loc["storm", "pit"]["above_p90"] == 1
    assert allz.loc["calm", "coverage_p10_p90"] > 0.7
    assert allz.loc["all", "n"] == len(rows) and allz.loc["storm", "n"] == 24
    assert evaluation.storm_days(wind.iloc[0:0]) == set()


def test_pass_through_recovers_a_known_beta():
    days = pd.date_range("2025-01-01", periods=240, freq="D", tz="UTC")
    rng = np.random.default_rng(5)
    ttf = 30 + np.cumsum(rng.normal(0, 1.5, len(days)))
    eua = 70 + np.cumsum(rng.normal(0, 1.0, len(days)))
    price = 20 + 1.6 * ttf + 0.3 * eua + rng.normal(0, 0.5, len(days))
    markets = pd.concat([pd.DataFrame({"ts": days, "series": "gas_ttf", "value": ttf}),
                         pd.DataFrame({"ts": days, "series": "eua", "value": eua})])
    hours = pd.date_range(days[0], periods=24 * len(days), freq="h", tz="UTC")
    eur = np.repeat(price, 24)
    prices = pd.concat([pd.DataFrame({"ts": hours, "zone": "NL", "series": "price_da", "value": eur}),
                        pd.DataFrame({"ts": hours, "zone": "GB", "series": "price_da", "value": eur / 1.15})])
    out = evaluation.pass_through(prices, markets)
    by = {r["zone"]: r for r in out["overall"]}
    assert by["NL"]["beta_gas"] == pytest.approx(1.6, abs=0.15) and by["NL"]["beta_eua"] == pytest.approx(0.3, abs=0.15)
    assert by["GB"]["beta_gas"] == pytest.approx(by["NL"]["beta_gas"], rel=0.02)
    assert by["NL"]["share_of_theory"] == pytest.approx(0.8, abs=0.1) and by["NL"]["r2"] > 0.9 and by["NL"]["reliable"]
    assert {r["quarter"] for r in out["by_quarter"] if r["zone"] == "NL"} >= {"2025Q1", "2025Q2"}
    assert evaluation.pass_through(prices, markets[markets.series == "eua"]) == {"overall": [], "by_quarter": []}


def test_report_is_json_serialisable_and_losses_are_labelled():
    rows = rows_for()
    rows["persistence"] = rows["y"] + 0.01
    actuals = pd.DataFrame({"ts": rows["ts"], "zone": "GB", "series": "gen_wind", "value": np.arange(len(rows)) + 1.0})
    rep = evaluation.build_report(rows, actuals, None, 12, {"folds": 1})
    json.dumps(rep, allow_nan=False)
    dm = {(r["baseline"]): r for r in rep["dm"]}
    assert dm["persistence"]["verdict"] == "baseline better"
    assert "persistence better in price_da FR" in evaluation.headline(rep)
    assert rep["pass_through"]["overall"] == [] and rep["regimes"]["storm_days_in_test"]


def test_end_to_end_on_the_fixture_history(populated):  # noqa: F811
    rows = evaluation.collect_rows(targets=["price_da"], **KW)
    assert {"y", "p10", "p50", "p90", "persistence", "yesterday"} <= set(rows.columns)
    assert (rows["p10"] <= rows["p50"]).all() and (rows["p50"] <= rows["p90"]).all()
    assert rows.groupby(["zone", "ts"]).size().max() == 1
    rep = evaluation.build_report(rows, pd.DataFrame(columns=["ts", "zone", "series", "value"]), None, 12, {})
    assert {r["baseline"] for r in rep["dm"]} == {"persistence", "yesterday"}
    assert all(0 <= r["coverage_p10_p90"] <= 1 for r in rep["calibration"])
