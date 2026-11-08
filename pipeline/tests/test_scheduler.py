import os

import pandas as pd
import pytest

from pipeline import cache, forecast_log, scheduler
from pipeline.ingest import boalf, carbon_intensity, elexon, elhub, energy_charts, markets, metered, neso, neso_boundaries, nordpool, octopus, open_meteo, uk_ets, weather_grid

T1 = pd.Timestamp("2026-11-07T14:00Z")
T2 = pd.Timestamp("2026-11-07T15:00Z")


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.setenv("LG_OFFLINE", "1")


def test_two_runs_append_two_batches_and_keep_earlier_rows():
    n1 = scheduler.run_once(now=T1)
    first = forecast_log.read().copy()
    n2 = scheduler.run_once(now=T2)
    log = forecast_log.read()
    assert n1 > 0 and n2 > 0 and len(log) == n1 + n2
    assert sorted(log.made_at.unique()) == [T1, T2]
    pd.testing.assert_frame_equal(log.iloc[:n1].reset_index(drop=True), first.reset_index(drop=True))
    assert (log.model_version == "stub-0").all()


def test_rows_are_future_only_with_consistent_horizon():
    scheduler.run_once(now=T1)
    log = forecast_log.read()
    assert (log.ts > log.made_at).all()
    assert (log.horizon_h == ((log.ts - log.made_at) / pd.Timedelta(hours=1)).round()).all()
    assert (log.p10 <= log.p50).all() and (log.p50 <= log.p90).all()
    assert set(log[log.zone == "GB"].target) == {"price_da", "gb_system_price"}
    assert set(log[log.zone != "GB"].target) == {"price_da"}


def test_past_feature_rows_are_not_logged():
    n = scheduler.run_once(now=pd.Timestamp("2026-11-09T00:00Z"))
    assert n == 0 and not cache.exists("forecasts/log")


def test_same_made_at_cannot_overwrite():
    scheduler.run_once(now=T1)
    with pytest.raises(ValueError, match="append-only"):
        scheduler.run_once(now=T1)


def test_refresh_is_skipped_offline(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("network used while offline")

    for mod, fn in ((elexon, "run"), (energy_charts, "fetch"), (nordpool, "run"), (markets, "run"), (carbon_intensity, "run"), (octopus, "run"),
                    (boalf, "run"), (metered, "run"), (neso, "run"), (neso_boundaries, "run"), (weather_grid, "fetch"),
                    (uk_ets, "run"), (elhub, "run")):
        monkeypatch.setattr(mod, fn, boom)
    assert scheduler.refresh(T1) == []


def test_failing_source_does_not_stop_the_forecast(monkeypatch):
    monkeypatch.delenv("LG_OFFLINE")
    called = []

    def boom(*a, **k):
        raise RuntimeError("503")

    def ok(name):
        return lambda *a, **k: called.append(name)

    monkeypatch.setattr(elexon, "run", boom)
    monkeypatch.setattr(energy_charts, "fetch", ok("ec"))
    monkeypatch.setattr(nordpool, "run", ok("np"))
    monkeypatch.setattr(markets, "run", ok("mk"))
    monkeypatch.setattr(carbon_intensity, "run", ok("ci"))
    monkeypatch.setattr(octopus, "run", ok("oc"))
    monkeypatch.setattr(open_meteo, "fetch_live", ok("om"))
    monkeypatch.setattr(open_meteo, "write", lambda *a, **k: "weather/live_forecast")
    monkeypatch.setattr(boalf, "run", ok("bo"))
    monkeypatch.setattr(metered, "run", ok("me"))
    monkeypatch.setattr(neso, "run", boom)
    monkeypatch.setattr(neso_boundaries, "run", ok("nb"))
    monkeypatch.setattr(weather_grid, "fetch", boom)
    monkeypatch.setattr(uk_ets, "run", ok("ets"))
    monkeypatch.setattr(elhub, "run", ok("el"))
    assert scheduler.refresh(T1) == ["elexon", "neso", "weather_grid"]
    assert called == ["ec", "np", "mk", "ci", "oc", "om", "bo", "me", "nb", "ets", "el"]
    monkeypatch.setenv("LG_OFFLINE", "1")
    assert scheduler.run_once(now=T1, do_refresh=False) > 0


def _stub_hourly_sources(monkeypatch):
    for mod, fn in ((elexon, "run"), (energy_charts, "fetch"), (nordpool, "run"), (markets, "run"), (carbon_intensity, "run"),
                    (octopus, "run"), (boalf, "run"), (metered, "run"), (neso, "run"), (neso_boundaries, "run"), (elhub, "run")):
        monkeypatch.setattr(mod, fn, lambda *a, **k: None)
    monkeypatch.setattr(open_meteo, "fetch_live", lambda *a, **k: None)
    monkeypatch.setattr(open_meteo, "write", lambda *a, **k: None)


def _written_at(name, ts):
    p = cache.path(name)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.touch()
    os.utime(p, (ts.timestamp(), ts.timestamp()))


def test_slow_sources_run_only_when_their_cache_is_old(monkeypatch):
    monkeypatch.delenv("LG_OFFLINE")
    _stub_hourly_sources(monkeypatch)
    calls = []
    monkeypatch.setattr(weather_grid, "fetch", lambda past_days, **k: calls.append(("grid", past_days)) or pd.DataFrame())
    monkeypatch.setattr(weather_grid, "write", lambda df: weather_grid.NAME)
    monkeypatch.setattr(uk_ets, "run", lambda *a, **k: calls.append("ets"))

    assert scheduler.refresh(T1) == []
    assert calls == [("grid", 1), "ets"], "nothing cached yet, so both run"

    calls.clear()
    _written_at(weather_grid.NAME, T1 - pd.Timedelta(hours=1))
    _written_at(uk_ets.NAME, T1 - pd.Timedelta(hours=1))
    scheduler.refresh(T1)
    assert calls == []

    calls.clear()
    _written_at(weather_grid.NAME, T1 - pd.Timedelta(hours=6))
    _written_at(uk_ets.NAME, T1 - pd.Timedelta(hours=12))
    scheduler.refresh(T1)
    assert calls == [("grid", 1)], "the grid refreshes every 6 h, UK ETS daily"

    calls.clear()
    _written_at(uk_ets.NAME, T1 - pd.Timedelta(hours=24))
    scheduler.refresh(T1)
    assert "ets" in calls


def test_neso_boundaries_window_covers_yesterday_to_day_ahead(monkeypatch):
    monkeypatch.delenv("LG_OFFLINE")
    _stub_hourly_sources(monkeypatch)
    seen = []
    monkeypatch.setattr(neso_boundaries, "run", lambda start, end, **k: seen.append((start, end)))
    monkeypatch.setattr(weather_grid, "fetch", lambda *a, **k: pd.DataFrame())
    monkeypatch.setattr(weather_grid, "write", lambda df: weather_grid.NAME)
    monkeypatch.setattr(uk_ets, "run", lambda *a, **k: None)
    scheduler.refresh(T1)
    assert seen == [(T1 - pd.Timedelta(days=1), T1 + pd.Timedelta(days=2))]


def test_once_cli(monkeypatch):
    real = scheduler.run_once
    monkeypatch.setattr(scheduler, "run_once", lambda do_refresh: real(now=T1, do_refresh=do_refresh))
    scheduler.main(["--once", "--no-refresh"])
    assert cache.exists("forecasts/log")


def test_elhub_is_refreshed_hourly_over_five_days_because_hours_land_a_day_or_two_late(monkeypatch):
    monkeypatch.delenv("LG_OFFLINE")
    _stub_hourly_sources(monkeypatch)
    monkeypatch.setattr(weather_grid, "fetch", lambda *a, **k: pd.DataFrame())
    monkeypatch.setattr(weather_grid, "write", lambda df: weather_grid.NAME)
    monkeypatch.setattr(uk_ets, "run", lambda *a, **k: None)
    seen = []
    monkeypatch.setattr(elhub, "run", lambda start, end, *a, **k: seen.append((start, end)))
    scheduler.refresh(T1)
    scheduler.refresh(T1 + pd.Timedelta(hours=1))
    assert seen == [(T1 - pd.Timedelta(days=5), T1), (T1 + pd.Timedelta(hours=1) - pd.Timedelta(days=5), T1 + pd.Timedelta(hours=1))]
