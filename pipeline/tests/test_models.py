import json
import time

import numpy as np
import pandas as pd
import pytest

from pipeline import cache, forecast_log, scheduler, schemas
from pipeline.models import quantile, train
from pipeline.tests.test_features import MADE_AT, populated  # noqa: F401  (fixture)

REAL_FIXTURES = cache.FIXTURES
SMALL = {"n_estimators": 25, "num_leaves": 7, "min_child_samples": 10, "n_jobs": 1}


@pytest.fixture
def trained(populated, monkeypatch):  # noqa: F811
    path = train.train(["all"], trained_before=MADE_AT.floor("h"), version="lgbm-test", params=SMALL)
    return path


def fixture_features(monkeypatch=None):
    return schemas.validate(pd.read_parquet(REAL_FIXTURES / "features/latest.parquet"), "features/latest")


def test_train_writes_all_targets_and_meta(trained):
    meta = json.loads((trained / "meta.json").read_text())
    assert set(meta["targets"]) == {"price_da", "load", "wind", "gb_system_price"}
    assert meta["zones"]["gb_system_price"] == ["GB"]
    for t in meta["targets"]:
        for q in ("p10", "p50", "p90"):
            assert (trained / f"{t}_{q}.txt").exists()


def test_predict_all_matches_forecast_log_schema(trained, monkeypatch):
    feats = fixture_features(monkeypatch)
    model = quantile.QuantileModel.load(trained)
    long = model.predict_all(feats)
    made_at = feats.ts.min() - pd.Timedelta(hours=1)
    rows = scheduler.to_log_rows(long, made_at, model.version)
    out = schemas.validate(rows, "forecasts/log")
    assert set(out.target) == {"price_da", "load", "wind", "gb_system_price"}
    assert set(out[out.target == "gb_system_price"].zone) == {"GB"}
    assert set(out[out.target == "price_da"].zone) == set(schemas.ZONES)
    assert (out.model_version == "lgbm-test").all()


def test_quantiles_are_ordered_even_when_boosters_cross():
    class Const:
        def __init__(self, v):
            self.v = v

        def predict(self, x, **kw):
            return np.full(len(x), self.v)

    boosters = {"price_da": {"p10": Const(9.0), "p50": Const(5.0), "p90": Const(7.0)}}
    model = quantile.QuantileModel(boosters=boosters, meta={"version": "x", "targets": ["price_da"]})
    feats = fixture_features()
    out = model.predict_all(feats)
    assert (out.p10 == 5).all() and (out.p50 == 7).all() and (out.p90 == 9).all()


def test_predict_contract_adds_quantiles(trained, monkeypatch):
    feats = fixture_features(monkeypatch)
    out = quantile.QuantileModel.load(trained).predict(feats)
    assert {"p10", "p50", "p90"} <= set(out.columns) and len(out) == len(feats)
    assert (out.p10 <= out.p50).all() and (out.p50 <= out.p90).all()


def test_predict_latency_under_200ms_for_all_zones_24h(trained, monkeypatch):
    feats = fixture_features(monkeypatch)
    feats = feats[feats.ts < feats.ts.min() + pd.Timedelta(hours=24)]
    assert len(feats) == 6 * 24
    model = quantile.QuantileModel.load(trained)
    model.predict_all(feats)
    best = min(_time(model, feats) for _ in range(5))
    assert best < 0.2, f"{best * 1000:.0f} ms"


def _time(model, feats):
    t = time.perf_counter()
    model.predict_all(feats)
    return time.perf_counter() - t


def test_trained_before_excludes_later_rows(populated):  # noqa: F811
    inp = train.build.Inputs()
    hist = train.build.build_history(inputs=inp)
    wide = train.target_frames(inp)["price_da"]
    cut = pd.Timestamp("2026-10-25T00:00Z")
    df = train.training_frame(hist, wide, cut)
    assert df.ts.max() < cut and len(df) < len(train.training_frame(hist, wide, pd.Timestamp("2026-11-09T00:00Z")))


def test_current_is_stub_until_trained_then_newest(populated):  # noqa: F811
    assert quantile.current() is None and quantile.active().version == "stub-0"
    train.train(["price_da"], trained_before=MADE_AT, version="lgbm-a", params=SMALL)
    assert quantile.active().version == "lgbm-a"
    time.sleep(0.01)
    train.train(["price_da"], trained_before=MADE_AT, version="lgbm-b", params=SMALL)
    assert quantile.active().version == "lgbm-b"


def test_scheduler_uses_trained_model_else_stub(populated, monkeypatch):  # noqa: F811
    monkeypatch.setenv("LG_OFFLINE", "1")
    cache.write("features/latest", fixture_features())
    made_at = pd.Timestamp("2026-11-07T14:00Z")
    scheduler.run_once(now=made_at, do_refresh=False)
    assert set(forecast_log.read().model_version) == {"stub-0"}
    train.train(["all"], trained_before=MADE_AT.floor("h"), version="lgbm-test", params=SMALL)
    scheduler.run_once(now=made_at + pd.Timedelta(hours=1), do_refresh=False)
    log = forecast_log.read()
    new = log[log.made_at > made_at]
    assert set(new.model_version) == {"lgbm-test"} and {"load", "wind"} <= set(new.target)
    assert set(log[log.made_at == made_at].model_version) == {"stub-0"}


def test_cli(populated, monkeypatch, tmp_path):  # noqa: F811
    monkeypatch.setattr(train, "PARAMS", {**train.PARAMS, **SMALL})
    out = tmp_path / "elsewhere"
    assert train.main(["--targets", "price_da", "--version", "cli", "--out-dir", str(out), "--trained-before", "2026-11-06"]) == 0
    assert (out / "cli" / "meta.json").exists()
    assert train.main(["--targets", "nope"]) == 1


def test_cli_without_data_fails_cleanly(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.setattr(cache, "FIXTURES", tmp_path / "none")
    assert train.main(["--targets", "all"]) == 1


def test_stub_predict_all_without_models(monkeypatch):
    feats = fixture_features(monkeypatch)
    out = quantile.QuantileModel().predict_all(feats)
    assert set(out.target) == {"price_da", "gb_system_price"}
