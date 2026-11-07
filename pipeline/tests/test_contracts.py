import os
import time

import pandas as pd
import pytest

from pipeline import cache, features, forecast_log, ingest, models, schemas

os.environ["LG_OFFLINE"] = "1"

FIXTURE_NAMES = sorted(p.relative_to(cache.FIXTURES).with_suffix("").as_posix() for p in cache.FIXTURES.rglob("*.parquet"))


def test_fixtures_cover_every_schema():
    assert {n for n in FIXTURE_NAMES if not n.startswith(("actuals/", "weather/"))} == set(schemas.SCHEMAS) - {"actuals", "weather"}
    assert any(n.startswith("actuals/") for n in FIXTURE_NAMES)
    assert any(n.startswith("weather/") for n in FIXTURE_NAMES)


@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_fixture_validates(name):
    schemas.validate(cache.read(name), name)


def test_validate_rejects_bad_input():
    df = cache.read("forecasts/log")
    with pytest.raises(ValueError):
        schemas.validate(df.drop(columns=["made_at"]), "forecasts/log")
    with pytest.raises(ValueError):
        schemas.validate(df.assign(p10=df["p90"] + 1), "forecasts/log")
    with pytest.raises(ValueError):
        schemas.validate(df.assign(ts=df["ts"].dt.tz_localize(None)), "forecasts/log")
    act = cache.read("actuals/energycharts_load")
    with pytest.raises(ValueError):
        schemas.validate(act.assign(series="bogus"), "actuals/x")


def test_feature_groups_cover_features():
    assert set(schemas.FEATURE_GROUPS.values()) == set(schemas.GROUPS)
    assert set(schemas.FEATURES_LATEST.names) == {"ts", "zone", *schemas.FEATURE_COLUMNS}


def test_stub_interfaces():
    f = features.latest()
    assert len(f) == 6 * 24
    t = time.perf_counter()
    p = models.predict(f)
    assert time.perf_counter() - t < 0.2
    assert {"p10", "p50", "p90"} <= set(p.columns) and len(p) == len(f)
    e = models.explain(f)
    assert list(e.columns) == schemas.EXPLANATION_COLUMNS and len(e) == len(f)
    m = models.as_of("2026-10-26")
    assert m.trained_before == pd.Timestamp("2026-10-26", tz="UTC")
    assert {"p10", "p50", "p90"} <= set(m.predict(f).columns)


def test_forecast_log_is_append_only(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    df = cache.read("forecasts/log")
    assert forecast_log.append(df) == len(df)
    with pytest.raises(ValueError, match="append-only"):
        forecast_log.append(df)
    later = df.assign(made_at=df["made_at"] + pd.Timedelta(hours=1))
    forecast_log.append(later)
    assert len(pd.read_parquet(cache.path("forecasts/log"))) == 2 * len(df)
    with pytest.raises(ValueError):
        forecast_log.append(df.drop(columns=["made_at"]))


def test_cache_roundtrip_and_offline(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    df = cache.read("carbon/consumption_intensity")
    cache.write("carbon/x", df)
    pd.testing.assert_frame_equal(cache.read("carbon/x"), df)
    monkeypatch.setenv("LG_OFFLINE", "1")
    assert cache.offline()
    with pytest.raises(FileNotFoundError):
        cache.read("nope/missing")


def test_ingest_autodiscovery():
    assert isinstance(ingest.sources(), dict)


def test_wind_metered_reads_offline_from_the_fixture(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    df = schemas.validate(cache.read("boalf/wind_metered"), "boalf/wind_metered")
    assert list(df.columns) == ["ts", "bm_unit", "mwh", "source"] and set(df["source"]) <= {"B1610", "PN"}
