import numpy as np
import pandas as pd
import pytest

from pipeline.models import calibrate, quantile


def narrow_bands(n=4000, seed=0, width=0.6):
    """Truth ~ N(0, 1); bands at +-width*1.2816 (true P10/P90 at width=1), so they are too narrow."""
    rng = np.random.default_rng(seed)
    y = rng.normal(0, 1, n)
    z = 1.2816 * width
    q = np.column_stack([np.full(n, -z), np.zeros(n), np.full(n, z)])
    return y, q


def test_scale_reaches_target_out_of_sample():
    y_cal, q_cal = narrow_bands(seed=1)
    y_test, q_test = narrow_bands(seed=2)
    assert calibrate.coverage(y_test, q_test) < 0.6
    s = calibrate.scale(y_cal, q_cal)
    assert s == pytest.approx(1 / 0.6, rel=0.08)
    assert calibrate.coverage(y_test, calibrate.apply(q_test, s)) == pytest.approx(0.8, abs=0.03)


def test_scale_can_narrow_wide_bands():
    y, q = narrow_bands(width=2.0)
    assert calibrate.scale(y, q) < 1


def test_apply_keeps_p50_and_order_and_skew():
    q = np.array([[8.0, 10.0, 16.0], [0.0, 0.0, 0.0]])
    out = calibrate.apply(q, 1.5)
    assert np.array_equal(out[:, 1], q[:, 1])
    assert (out[:, 0] <= out[:, 1]).all() and (out[:, 1] <= out[:, 2]).all()
    assert out[0].tolist() == [7.0, 10.0, 19.0]


def test_needed_handles_zero_width_and_inside_rows():
    q = np.array([[10.0, 10.0, 10.0], [5.0, 10.0, 15.0]])
    f = calibrate.needed(np.array([10.0, 12.0]), q)
    assert f[0] == 0 and f[1] == pytest.approx(0.4)
    assert np.isfinite(calibrate.needed(np.array([11.0]), q[:1])).all()


def test_scale_is_capped():
    q = np.column_stack([np.full(100, -1e-3), np.zeros(100), np.full(100, 1e-3)])
    assert calibrate.scale(np.full(100, 50.0), q) == calibrate.MAX_SCALE


def test_fit_uses_only_rows_held_out_from_the_calibrating_fit():
    ts = pd.date_range("2026-10-01", periods=24 * 30, freq="h", tz="UTC")
    df = pd.DataFrame({"ts": ts, "y": np.random.default_rng(0).normal(0, 1, len(ts))})
    seen = {}

    def fit_target(rows):
        seen["fit_max"] = rows["ts"].max()
        return None

    def predict(_boosters, rows):
        seen["held_min"] = rows["ts"].min()
        return np.column_stack([np.full(len(rows), -0.5), np.zeros(len(rows)), np.full(len(rows), 0.5)])

    cal = calibrate.fit(df, fit_target, predict)
    assert seen["fit_max"] < seen["held_min"] - pd.Timedelta(hours=calibrate.PURGE_HOURS - 1)
    assert seen["held_min"] >= ts.max() - pd.Timedelta(days=calibrate.HOLDOUT_DAYS)
    assert cal["scale"] > 1 and cal["coverage_after"] >= 0.8 > cal["coverage_before"]


def test_fit_needs_enough_rows():
    ts = pd.date_range("2026-10-01", periods=40, freq="h", tz="UTC")
    assert calibrate.fit(pd.DataFrame({"ts": ts, "y": 0.0}), lambda r: None, lambda b, r: None) is None


def test_model_applies_scale_from_meta():
    class Const:
        def __init__(self, v):
            self.v = v

        def predict(self, x, **kw):
            return np.full(len(x), self.v)

    feats = pd.DataFrame({"ts": pd.Timestamp("2026-11-08", tz="UTC"), "zone": ["GB"]})
    for c in quantile.FEATURES[1:]:
        feats[c] = 0.0
    boosters = {"price_da": {"p10": Const(90.0), "p50": Const(100.0), "p90": Const(120.0)}}
    raw = quantile.QuantileModel(boosters=boosters, meta={"version": "t"}).predict(feats)
    cal = quantile.QuantileModel(boosters=boosters, meta={"version": "t", "calibration": {"price_da": {"scale": 2.0}}})
    out = cal.predict(feats)
    assert raw[["p10", "p50", "p90"]].iloc[0].tolist() == [90, 100, 120]
    assert out[["p10", "p50", "p90"]].iloc[0].tolist() == [80, 100, 140]
