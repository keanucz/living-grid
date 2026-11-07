import itertools

import numpy as np
import pandas as pd
import pytest

from pipeline import backtest, cache, schemas
from pipeline.models import train
from pipeline.tests.test_features import populated  # noqa: F401  (fixture)
from pipeline.tests.test_models import SMALL

KW = {"n_folds": 3, "test_days": 3, "purge_h": 24, "params": SMALL, "min_train_rows": 100}


def test_fold_boundaries_expand_purge_and_do_not_overlap():
    first, last = pd.Timestamp("2026-10-01T00:00Z"), pd.Timestamp("2026-11-06T23:00Z")
    folds = backtest.make_folds(first, last, 4, 7, 48)
    assert len(folds) == 4
    for train_end, test_start, test_end in folds:
        assert train_end == test_start - pd.Timedelta(hours=48)
    assert [f[0] for f in folds] == sorted(f[0] for f in folds)
    assert all(a[2] == b[1] for a, b in itertools.pairwise(folds))
    assert folds[-1][2] == last.floor("h") + pd.Timedelta(hours=1)


def test_no_fold_trains_on_data_at_or_after_its_test_start(populated, monkeypatch):  # noqa: F811
    seen = []
    real = train.fit_target

    def spy(df, params):
        seen.append(df["ts"].max())
        return real(df, params)

    monkeypatch.setattr(train, "fit_target", spy)
    out = backtest.run(targets=["price_da"], **KW)
    hist_ts = train.build.build_history()["ts"]
    folds = backtest.make_folds(hist_ts.min(), hist_ts.max(), KW["n_folds"], KW["test_days"], KW["purge_h"])
    # Two fits per fold: the conformal calibration fit (on the fold's earlier training rows), then the main fit.
    assert len(seen) == 2 * out["fold"].nunique() == 6
    for k, (train_end, test_start, _) in enumerate(folds):
        calib_fit, main_fit = seen[2 * k], seen[2 * k + 1]
        assert calib_fit < main_fit < train_end <= test_start - pd.Timedelta(hours=24) < test_start


def test_uncalibrated_backtest_fits_once_per_fold(populated, monkeypatch):  # noqa: F811
    seen = []
    real = train.fit_target
    monkeypatch.setattr(train, "fit_target", lambda df, params: seen.append(1) or real(df, params))
    out = backtest.run(targets=["price_da"], calibrate_bands=False, **KW)
    assert len(seen) == out["fold"].nunique()


def test_output_matches_contract_and_compares_models_on_same_rows(populated):  # noqa: F811
    out = backtest.check(backtest.run(targets=["price_da", "load"], **KW))
    assert list(out.columns) == schemas.WALK_FORWARD.names
    assert set(out.model) == {"lgbm_q", "persistence", "yesterday"}
    assert set(out.zone) == set(schemas.ZONES[1:]) | {"GB"}
    per = out.groupby(["fold", "zone", "target"])["n"].nunique()
    assert (per == 1).all()
    model, base = out[out.model == "lgbm_q"], out[out.model != "lgbm_q"]
    assert model["coverage_p10_p90"].between(0, 1).all() and base["coverage_p10_p90"].isna().all()
    assert np.isfinite(out["mae"]).all() and (out["mae"] >= 0).all() and (out["n"] > 0).all()


def test_persistence_and_yesterday_use_only_known_values():
    ts = pd.date_range("2026-11-03T00:00Z", periods=48, freq="h")
    wide = pd.DataFrame({"FR": np.arange(len(ts), dtype=float)}, index=ts)
    b = backtest.baselines(wide, "FR", pd.DatetimeIndex([pd.Timestamp("2026-11-04T18:00Z")]), 12)
    assert b["persistence"].iloc[0] == wide.loc["2026-11-04T05:00Z", "FR"]
    assert b["yesterday"].iloc[0] == wide.loc["2026-11-03T18:00Z", "FR"]
    assert backtest.baselines(wide, "GB", ts[:2], 12).isna().all().all()


def frame(rows):
    return pd.DataFrame(rows, columns=schemas.WALK_FORWARD.names)


def test_summary_and_losses_report_baseline_wins_honestly():
    rows = []
    for zone, m, p, y in (("GB", 10.0, 8.0, 9.0), ("FR", 5.0, 9.0, 8.0)):
        for fold in (0, 1):
            rows += [(fold, zone, "price_da", "lgbm_q", m, 0.7, 100), (fold, zone, "price_da", "persistence", p, np.nan, 100),
                     (fold, zone, "price_da", "yesterday", y, np.nan, 100)]
    df = frame(rows)
    s = backtest.summary(df).set_index("zone")
    assert s.loc["GB", "ratio_vs_persistence"] == pytest.approx(1.25)
    assert s.loc["FR", "ratio_vs_yesterday"] == pytest.approx(5 / 8)
    assert list(backtest.losses(s.reset_index())["zone"]) == ["GB"]
    text = backtest.report(df)
    assert "LOSS price_da GB: worse than persistence and yesterday" in text and "LOSS price_da FR" not in text
    assert "beats both baselines in 1 of 2" in text


def test_check_accepts_null_baseline_coverage_that_validate_rejects():
    df = frame([(0, "GB", "price_da", "persistence", 1.0, np.nan, 10)]).astype({"fold": "int32", "n": "int64"})
    backtest.check(df)
    with pytest.raises(ValueError):
        schemas.validate(df, "backtest/walk_forward")


def test_cli_writes_parquet_and_fails_cleanly_without_data(populated, monkeypatch, tmp_path):  # noqa: F811
    monkeypatch.setattr(train, "PARAMS", {**train.PARAMS, **SMALL})
    monkeypatch.setattr(backtest, "MIN_TRAIN_ROWS", 100)
    assert backtest.main(["--folds", "3", "--test-days", "3", "--purge-hours", "24", "--targets", "price_da"]) == 0
    assert len(pd.read_parquet(cache.path("backtest/walk_forward")))
    monkeypatch.setattr(cache, "DATA", tmp_path / "empty")
    monkeypatch.setattr(cache, "FIXTURES", tmp_path / "none")
    assert backtest.main(["--targets", "all"]) == 1
