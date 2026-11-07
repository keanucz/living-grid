import json
import time

import numpy as np
import pandas as pd
import pytest

from pipeline import cache, forecast_log, scheduler, schemas
from pipeline.models import promote, quantile, train
from pipeline.tests.test_features import MADE_AT, populated  # noqa: F401  (fixture)

REAL_FIXTURES = cache.FIXTURES
T_LATER = MADE_AT + pd.Timedelta(hours=1)
SMALL = {"n_estimators": 25, "num_leaves": 7, "min_child_samples": 10, "n_jobs": 1}


@pytest.fixture
def trained(populated, monkeypatch):  # noqa: F811
    path = train.train(["all"], trained_before=MADE_AT.floor("h"), trained_at=MADE_AT, version="lgbm-test", params=SMALL)
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
    train.train(["price_da"], trained_before=MADE_AT, trained_at=MADE_AT, version="lgbm-a", params=SMALL)
    assert quantile.active().version == "lgbm-a"
    train.train(["price_da"], trained_before=MADE_AT, trained_at=T_LATER, version="lgbm-b", params=SMALL)
    assert quantile.active().version == "lgbm-b"


def test_scheduler_uses_trained_model_else_stub(populated, monkeypatch):  # noqa: F811
    monkeypatch.setenv("LG_OFFLINE", "1")
    cache.write("features/latest", fixture_features())
    made_at = pd.Timestamp("2026-11-07T14:00Z")
    scheduler.run_once(now=made_at, do_refresh=False)
    assert set(forecast_log.read().model_version) == {"stub-0"}
    train.train(["all"], trained_before=MADE_AT.floor("h"), trained_at=MADE_AT, version="lgbm-test", params=SMALL)
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


def test_version_dir_holds_only_text_and_json_with_per_model_metadata(trained):
    assert {p.suffix for p in trained.iterdir()} == {".txt", ".json"}
    info = json.loads((trained / "load_p90.json").read_text())
    assert info["model_version"] == "lgbm-test" and info["target"] == "load" and info["quantile"] == 0.9
    assert info["features"] == quantile.FEATURES
    start, end = pd.Timestamp(info["train_window"]["start"]), pd.Timestamp(info["train_window"]["end"])
    assert start < end < MADE_AT.floor("h")
    meta = json.loads((trained / "meta.json").read_text())
    assert set(meta["files"]) == {p.name for p in trained.iterdir() if p.name != "meta.json"}
    assert not [p for p in trained.parent.iterdir() if p.name.startswith(".")]


def test_failed_training_leaves_no_version_or_temp_dir(populated):  # noqa: F811
    with pytest.raises(ValueError):
        train.train(["price_da"], trained_before=pd.Timestamp("2026-10-11T00:00Z"), version="too-early", params=SMALL)
    root = quantile.models_dir()
    assert not root.exists() or not list(root.iterdir())


def test_existing_version_is_never_overwritten(trained):
    with pytest.raises(FileExistsError):
        train.train(["price_da"], trained_before=MADE_AT, trained_at=MADE_AT, version="lgbm-test", params=SMALL)
    assert quantile.QuantileModel.load(trained).version == "lgbm-test"


def test_half_copied_or_temp_versions_are_skipped(populated):  # noqa: F811
    train.train(["price_da"], trained_before=MADE_AT, trained_at=MADE_AT, version="lgbm-old", params=SMALL)
    newer = train.train(["price_da"], trained_before=MADE_AT, trained_at=T_LATER, version="lgbm-new", params=SMALL)
    assert quantile.active().version == "lgbm-new"

    (newer / "price_da_p90.txt").write_bytes((newer / "price_da_p90.txt").read_bytes()[:50])
    assert quantile.incomplete(newer) == ["price_da_p90.txt"]
    assert quantile.active().version == "lgbm-old"
    with pytest.raises(ValueError, match="not a complete"):
        quantile.QuantileModel.load(newer)

    (newer / "price_da_p90.txt").unlink()
    assert quantile.active().version == "lgbm-old"

    copying = quantile.models_dir() / ".tmp-lgbm-copying"
    copying.mkdir()
    (copying / "meta.json").write_text(json.dumps({"files": {}, "trained_at": "9999", "targets": []}))
    assert quantile.active().version == "lgbm-old"

    no_meta = quantile.models_dir() / "lgbm-no-meta"
    no_meta.mkdir()
    (no_meta / "price_da_p10.txt").write_text("x")
    assert quantile.active().version == "lgbm-old"


def test_models_dir_override_for_copied_in_models(populated, tmp_path, monkeypatch):  # noqa: F811
    elsewhere = tmp_path / "mac-models"
    train.train(["price_da"], trained_before=MADE_AT, trained_at=MADE_AT, version="from-mac", params=SMALL, out_dir=elsewhere)
    assert quantile.current() is None
    monkeypatch.setenv("LG_MODELS_DIR", str(elsewhere))
    assert quantile.models_dir() == elsewhere and quantile.active().version == "from-mac"


def test_as_of_model_trained_later_never_becomes_current(populated):  # noqa: F811
    live = train.train(["price_da"], trained_before=MADE_AT, trained_at=MADE_AT, version="live", params=SMALL)
    replay = train.train(
        ["price_da"], trained_before=pd.Timestamp("2026-10-26T00:00Z"), trained_at=T_LATER, version="asof-1026", params=SMALL
    )
    assert quantile.is_as_of(json.loads((replay / "meta.json").read_text()))
    assert not quantile.is_as_of(json.loads((live / "meta.json").read_text()))
    assert quantile.active().version == "live"


def test_as_of_model_in_its_own_dir_is_loadable_but_not_scanned(populated, tmp_path):  # noqa: F811
    asof = tmp_path / "models-asof"
    path = train.train(["price_da"], trained_before=pd.Timestamp("2026-10-26T00:00Z"), trained_at=T_LATER,
                       version="asof-1026", params=SMALL, out_dir=asof)
    assert quantile.QuantileModel.load(path).trained_before == pd.Timestamp("2026-10-26T00:00Z")
    assert quantile.current() is None


def test_one_day_tolerance_boundary():
    meta = {"trained_before": "2026-11-06T14:00:00+00:00", "trained_at": "2026-11-07T14:00:00+00:00"}
    assert not quantile.is_as_of(meta)
    assert quantile.is_as_of({**meta, "trained_at": "2026-11-07T14:00:01+00:00"})
    assert not quantile.is_as_of({"trained_at": "2026-11-07T14:00:00+00:00"})


def test_promote_moves_incoming_version_in_one_rename(populated):  # noqa: F811
    incoming = promote.incoming_dir()
    train.train(["price_da"], trained_before=MADE_AT, trained_at=MADE_AT, version="from-mac", params=SMALL, out_dir=incoming)
    assert quantile.current() is None
    assert promote.main(["from-mac"]) == 0
    assert not (incoming / "from-mac").exists()
    assert quantile.active().version == "from-mac"
    assert promote.main(["from-mac"]) == 1


def test_promote_refuses_incomplete_and_existing(populated):  # noqa: F811
    incoming = promote.incoming_dir()
    path = train.train(["price_da"], trained_before=MADE_AT, trained_at=MADE_AT, version="partial", params=SMALL, out_dir=incoming)
    (path / "price_da_p10.txt").unlink()
    with pytest.raises(ValueError, match="incomplete"):
        promote.promote("partial")
    assert path.exists() and quantile.current() is None
    with pytest.raises(FileNotFoundError):
        promote.promote("nothing-here")


def test_country_level_norway_load_and_wind_are_not_training_targets(populated):  # noqa: F811
    wides = train.target_frames(train.build.Inputs())
    assert "NO2" in wides["price_da"] and "NO2" not in wides["load"] and "NO2" not in wides["wind"]
    assert {"GB", "FR"} <= set(wides["load"])
    path = train.train(["load", "wind"], trained_before=MADE_AT, trained_at=MADE_AT, version="no-no2", params=SMALL)
    meta = json.loads((path / "meta.json").read_text())
    assert "NO2" not in meta["zones"]["load"] and "NO2" not in meta["zones"]["wind"]
