import json

import pandas as pd
import pytest

from pipeline import cache
from pipeline.models import as_of, asof, quantile, train
from pipeline.tests.test_features import populated  # noqa: F401  (fixture)
from pipeline.tests.test_models import SMALL

DATE = pd.Timestamp("2026-10-25T00:00Z")


@pytest.fixture
def spy(monkeypatch):
    seen = []
    real = train.fit_target

    def fit(df, params):
        seen.append(df["ts"].max())
        return real(df, params)

    monkeypatch.setattr(train, "fit_target", fit)
    return seen


def test_max_training_ts_is_before_the_date(populated, spy):  # noqa: F811
    model = as_of("2026-10-25", targets=["price_da", "load"], params=SMALL)
    assert spy and all(t < DATE for t in spy)
    assert model.trained_before == DATE
    meta = json.loads((asof.asof_dir() / "asof-20261025" / "meta.json").read_text())
    assert all(pd.Timestamp(w["end"]) < DATE for w in meta["window"].values())
    inp_end = train.build.Inputs().price.index.max()
    assert inp_end > DATE, "the cache holds later data, so the cut really excludes something"


def test_cached_model_is_reused_not_retrained(populated, spy):  # noqa: F811
    as_of(DATE, targets=["price_da"], params=SMALL)
    n = len(spy)
    again = as_of(DATE, targets=["price_da"], params=SMALL)
    assert len(spy) == n and again.version == "asof-20261025"


def test_lives_apart_from_live_models_and_never_becomes_current(populated):  # noqa: F811
    as_of(DATE, targets=["price_da"], params=SMALL)
    assert (cache.DATA / "models-asof" / "asof-20261025" / "meta.json").exists()
    assert not (cache.DATA / "models").exists() and quantile.current() is None
    assert quantile.active().version == "stub-0"


def test_timezone_and_time_of_day_are_normalised(populated):  # noqa: F811
    assert asof.version_name("2026-10-25T01:00+01:00") == "asof-20261025"
    assert asof.version_name("2026-10-25T06:30Z") == "asof-20261025T0630"
    assert asof.version_name("2026-10-25") == asof.version_name(DATE)


def test_refuses_a_model_that_saw_data_at_or_after_the_date(populated):  # noqa: F811
    as_of(DATE, targets=["price_da"], params=SMALL)
    meta_path = asof.asof_dir() / "asof-20261025" / "meta.json"
    meta = json.loads(meta_path.read_text())
    meta["window"]["price_da"]["end"] = "2026-10-25T00:00:00+00:00"
    meta_path.write_text(json.dumps(meta))
    with pytest.raises(ValueError, match="refusing"):
        as_of(DATE, params=SMALL)


def test_refuses_wrong_date_or_missing_window(populated):  # noqa: F811
    as_of(DATE, targets=["price_da"], params=SMALL)
    path = asof.asof_dir() / "asof-20261025"
    with pytest.raises(ValueError, match="not"):
        asof.check_no_leakage(path, pd.Timestamp("2026-10-26T00:00Z"))
    meta = json.loads((path / "meta.json").read_text())
    del meta["window"]
    (path / "meta.json").write_text(json.dumps(meta))
    with pytest.raises(ValueError):
        asof.check_no_leakage(path, DATE)


def test_train_false_does_not_train(populated):  # noqa: F811
    with pytest.raises(FileNotFoundError, match="pipeline.models.asof"):
        as_of(DATE, train=False)
    assert not asof.asof_dir().exists()


def test_incomplete_cached_version_is_not_loaded(populated):  # noqa: F811
    as_of(DATE, targets=["price_da"], params=SMALL)
    (asof.asof_dir() / "asof-20261025" / "price_da_p10.txt").unlink()
    with pytest.raises(ValueError, match="incomplete"):
        as_of(DATE, params=SMALL)


def test_date_before_the_history_starts_fails_cleanly(populated):  # noqa: F811
    with pytest.raises(ValueError):
        as_of("2026-10-12", params=SMALL)
    assert not (asof.asof_dir() / "asof-20261012").exists()


def test_different_dates_give_different_models(populated):  # noqa: F811
    a = as_of("2026-10-25", targets=["price_da"], params=SMALL)
    b = as_of("2026-11-02", targets=["price_da"], params=SMALL)
    assert a.version != b.version and a.meta["rows"]["price_da"] < b.meta["rows"]["price_da"]


def test_asof_dir_override(populated, tmp_path, monkeypatch):  # noqa: F811
    monkeypatch.setenv("LG_ASOF_DIR", str(tmp_path / "elsewhere"))
    as_of(DATE, targets=["price_da"], params=SMALL)
    assert (tmp_path / "elsewhere" / "asof-20261025" / "meta.json").exists()


def test_cli(populated, monkeypatch):  # noqa: F811
    monkeypatch.setattr(train, "PARAMS", {**train.PARAMS, **SMALL})
    assert asof.main(["2026-10-25", "--targets", "price_da"]) == 0
    assert asof.main(["2026-10-12"]) == 1


def test_fixtures_only_checkout_gets_the_labelled_stub(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.setattr(cache, "FIXTURES", tmp_path / "none")
    m = as_of("2026-10-26")
    assert m.version == "stub-0" and m.trained_before == pd.Timestamp("2026-10-26", tz="UTC") and not m.boosters
    assert not list((tmp_path / "models-asof").glob("*")) if (tmp_path / "models-asof").exists() else True
