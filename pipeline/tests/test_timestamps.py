"""Regression: real caches mix datetime units (s, ms, us, ns), naive values and two UTC tz objects.

pandas turns a concat of those into an object column and refuses to merge them, which crashed the live
scheduler (markets 'ts must be timezone-aware UTC', features MergeError). Every datetime column must cross
the cache boundary as datetime64[ns, UTC].
"""

import datetime as dt
import zoneinfo

import numpy as np
import pandas as pd
import pytest

from pipeline import cache, forecast_log, scheduler, schemas
from pipeline.features import build
from pipeline.ingest import markets

NS = cache.UTC_NS
ZI = zoneinfo.ZoneInfo("UTC")


def stamps(unit, tz, days=("2026-11-01", "2026-11-02", "2026-11-03")):
    s = pd.Series(pd.to_datetime(list(days))).astype(f"datetime64[{unit}]")
    return s.dt.tz_localize(tz) if tz is not None else s


def frame(unit, tz, **extra):
    return pd.DataFrame({"ts": stamps(unit, tz), "v": [1.0, 2.0, 3.0], **extra})


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.setenv("LG_OFFLINE", "1")


@pytest.mark.parametrize("unit", ["s", "ms", "us", "ns"])
@pytest.mark.parametrize("tz", [None, ZI, dt.UTC])
def test_normalise_ts_gives_ns_utc_for_every_unit_and_tz(unit, tz):
    out = cache.normalise_ts(frame(unit, tz))
    assert out["ts"].dtype == NS
    assert list(out["ts"]) == list(pd.to_datetime(["2026-11-01", "2026-11-02", "2026-11-03"], utc=True))
    assert out["v"].tolist() == [1.0, 2.0, 3.0]


def test_naive_values_are_taken_to_be_utc_and_other_zones_are_converted():
    naive = cache.normalise_ts(pd.DataFrame({"ts": pd.to_datetime(["2026-11-01 12:00"])}))
    assert naive["ts"].iloc[0] == pd.Timestamp("2026-11-01 12:00", tz="UTC")
    paris = cache.normalise_ts(pd.DataFrame({"ts": pd.to_datetime(["2026-11-01 12:00"]).tz_localize("Europe/Paris")}))
    assert paris["ts"].iloc[0] == pd.Timestamp("2026-11-01 11:00", tz="UTC")


def test_object_columns_of_mixed_timestamps_are_recovered():
    mixed = pd.DataFrame(
        {"ts": pd.Series([pd.Timestamp("2026-11-01", tz="UTC"), dt.datetime(2026, 11, 2), pd.Timestamp("2026-11-03", tz="Europe/Paris")], dtype=object)}
    )
    out = cache.normalise_ts(mixed)
    assert out["ts"].dtype == NS
    assert out["ts"].iloc[2] == pd.Timestamp("2026-11-02 23:00", tz="UTC")


def test_other_columns_are_left_alone_and_clean_frames_are_not_copied():
    df = pd.DataFrame({"ts": stamps("ns", "UTC"), "zone": ["GB", "FR", "NL"], "v": [1, 2, 3]})
    df["ts"] = df["ts"].astype(NS)
    assert cache.normalise_ts(df) is df
    out = cache.normalise_ts(frame("s", None, zone=["GB", "FR", "NL"]))
    assert out["zone"].tolist() == ["GB", "FR", "NL"]


def test_the_crash_combination_concats_to_ns_not_object():
    old, new = frame("ms", ZI), frame("s", dt.UTC)
    assert pd.concat([old, new])["ts"].dtype == object  # what pandas does without the guard
    assert cache.concat([old, new], ignore_index=True)["ts"].dtype == NS


@pytest.mark.parametrize("unit,tz", [("s", None), ("ms", ZI), ("us", dt.UTC), ("ns", ZI)])
def test_read_returns_ns_utc_whatever_is_on_disk(unit, tz):
    p = cache.path("actuals/x")
    p.parent.mkdir(parents=True)
    frame(unit, tz).to_parquet(p, index=False)
    assert cache.read("actuals/x")["ts"].dtype == NS
    assert cache.read_file(p)["ts"].dtype == NS


def test_write_stores_ns_utc():
    cache.write("actuals/y", frame("ms", None))
    assert pd.read_parquet(cache.path("actuals/y"))["ts"].dtype.unit == "ns"
    assert cache.read("actuals/y")["ts"].dtype == NS


def test_markets_validate_accepts_naive_dates_like_yfinance_returns():
    df = pd.DataFrame(
        {"ts": pd.to_datetime(["2026-11-03", "2026-11-04"]), "series": "gas_ttf", "value": [30.0, 31.0], "unit": "EUR/MWh", "source": "TTE=F"}
    )
    out = markets.validate(df)
    assert out["ts"].dtype == NS and out["ts"].iloc[0] == pd.Timestamp("2026-11-03", tz="UTC")


@pytest.mark.parametrize("new_unit,new_tz", [("s", dt.UTC), ("us", None), ("ns", ZI)])
def test_markets_write_merges_into_a_cache_stored_with_other_units(new_unit, new_tz):
    old = pd.DataFrame({"ts": stamps("ms", ZI), "series": "gas_ttf", "value": [30.0, 31.0, 32.0], "unit": "EUR/MWh", "source": "TTE=F"})
    p = cache.path(markets.NAME)
    p.parent.mkdir(parents=True)
    old.to_parquet(p, index=False)
    new = pd.DataFrame(
        {"ts": stamps(new_unit, new_tz, ("2026-11-03", "2026-11-04")), "series": "gas_ttf", "value": [99.0, 40.0], "unit": "EUR/MWh", "source": "TTE=F"}
    )
    assert markets.write(markets.validate(new)) == [markets.NAME]
    out = cache.read(markets.NAME)
    assert out["ts"].dtype == NS and len(out) == 4
    assert out[out.ts == pd.Timestamp("2026-11-03", tz="UTC")]["value"].iloc[0] == 99.0  # newest wins


def test_forecast_log_appends_across_units_and_still_refuses_rewrites():
    row = {"made_at": pd.Timestamp("2026-11-07 10:00", tz="UTC"), "zone": "GB", "target": "price_da", "ts": pd.Timestamp("2026-11-07 12:00", tz="UTC"),
           "horizon_h": 2, "p10": 1.0, "p50": 2.0, "p90": 3.0, "model_version": "m"}
    old = pd.DataFrame([row])
    for c in ("made_at", "ts"):
        old[c] = old[c].astype("datetime64[ms, UTC]")
    p = cache.path("forecasts/log")
    p.parent.mkdir(parents=True)
    old.to_parquet(p, index=False)
    later = {**row, "made_at": pd.Timestamp("2026-11-07 11:00", tz="UTC")}
    assert forecast_log.append(pd.DataFrame([later])) == 1
    assert len(forecast_log.read()) == 2 and forecast_log.read()["made_at"].dtype == NS
    with pytest.raises(ValueError, match="append-only"):
        forecast_log.append(pd.DataFrame([row]))


def test_asof_merge_in_the_feature_builder_with_mixed_key_units():
    series = pd.Series([1.0, 2.0], index=pd.DatetimeIndex(stamps("ms", ZI, ("2026-11-01", "2026-11-02"))))
    times = pd.DatetimeIndex(pd.date_range("2026-11-02 06:00", periods=3, freq="h", tz="UTC")).as_unit("us")
    assert build._at(series, times, "10D").tolist() == [2.0, 2.0, 2.0]


def test_scheduler_runs_on_a_cache_with_mixed_units_and_naive_stamps(monkeypatch):
    """The live failure: a real cache whose files disagree about datetime units."""
    units = ["s", "ms", "us", "ns"]
    for i, f in enumerate(sorted(cache.FIXTURES.rglob("*.parquet"))):
        name = f.relative_to(cache.FIXTURES).with_suffix("").as_posix()
        if name in ("forecasts/log", "forecasts/frozen_monday"):
            continue
        df = pd.read_parquet(f)
        for c in df.columns:
            if isinstance(df[c].dtype, pd.DatetimeTZDtype):
                col = df[c].astype(f"datetime64[{units[i % 4]}, UTC]")
                df[c] = col.dt.tz_localize(None) if i % 5 == 0 else col
        p = cache.path(name)
        p.parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(p, index=False)
    gas = pd.DataFrame(
        {"ts": stamps("ms", ZI, ("2026-11-04", "2026-11-05", "2026-11-06")), "series": "gas_ttf", "value": [30.0, 31.0, 32.0], "unit": "EUR/MWh", "source": "TTE=F"}
    )
    cache.path(markets.NAME).parent.mkdir(parents=True, exist_ok=True)
    gas.to_parquet(cache.path(markets.NAME), index=False)
    first = scheduler.run_once(now=pd.Timestamp("2026-11-07T14:00Z"), do_refresh=False)
    second = scheduler.run_once(now=pd.Timestamp("2026-11-07T15:00Z"), do_refresh=False)
    assert first > 0 and second > 0
    log = forecast_log.read()
    assert len(log) == first + second and log["made_at"].dtype == NS and log["ts"].dtype == NS
    schemas.validate(log, "forecasts/log")
    assert np.isfinite(log["p50"]).all()
