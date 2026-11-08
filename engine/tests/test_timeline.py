import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine import data, timeline
from engine.app import app
from engine.routes import state as state_route
from pipeline import cache

client = TestClient(app)


def row(ts, zone, series, value, source, unit="MW"):
    return {"ts": pd.Timestamp(ts), "zone": zone, "series": series, "value": value, "unit": unit, "source": source}


@pytest.fixture
def actuals(monkeypatch, tmp_path):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    rows = []
    for h in range(48):
        t = pd.Timestamp("2025-06-01", tz="UTC") + pd.Timedelta(hours=h)
        rows += [
            row(t, "GB", "price_da", 50.0 + h, "mid", "GBP/MWh"),
            row(t, "GB", "gen_wind", 2000.0, "elexon"),
            row(t, "GB", "gen_gas", 6000.0, "elexon"),
            row(t, "GB", "flow_GB_FR", -1000.0, "elexon"),
            row(t, "FR", "price_da", 40.0, "energycharts", "EUR/MWh"),
            row(t, "FR", "gen_solar", 1000.0, "energycharts"),
            row(t, "FR", "gen_nuclear", 9000.0, "energycharts"),
            row(t, "FR", "gen_hydro_pumped_storage_consumption", 500.0, "energycharts"),
            row(t, "FR", "flow_net_FR", -8000.0, "energycharts"),
        ]
    df = pd.DataFrame(rows)
    monkeypatch.setattr(data, "actuals", lambda: df)
    monkeypatch.setattr(timeline, "_signature", lambda: ("test", len(df)))
    timeline._build.cache_clear()
    yield df
    timeline._build.cache_clear()


def test_daily_series_shares_and_signs(actuals):
    r = timeline.build("2025-06-01", "2025-06-02", "day")
    assert len(r["ts"]) == 2
    gb, fr = r["zones"]["GB"], r["zones"]["FR"]
    assert gb["price"][0] == pytest.approx(61.5) and gb["price_proxy"] == [True, True]
    assert gb["wind_share"][0] == pytest.approx(0.25) and gb["solar_share"][0] is None
    assert gb["net_import_mw"][0] == 1000.0
    assert fr["solar_share"][0] == pytest.approx(0.1) and fr["price_proxy"] == [False, False]
    assert fr["net_import_mw"][0] == -8000.0
    assert r["zones"]["NL"]["price"] == [None, None]
    assert r["coverage"]["price"]["GB"]["share"] == 1.0


def test_hourly_limit_and_bad_range(actuals):
    assert client.get("/timeline?from=2025-06-01T00:00:00Z&to=2025-06-01T05:00:00Z&step=hour").status_code == 200
    assert client.get("/timeline?from=2024-01-01T00:00:00Z&to=2025-01-01T00:00:00Z&step=hour").status_code == 422
    assert client.get("/timeline?from=2025-06-02T00:00:00Z&to=2025-06-01T00:00:00Z").status_code == 422


def test_events_overlapping_the_range_only(actuals):
    far = timeline.build("2025-06-01", "2025-06-02", "day")["events"]
    assert all(e["end"] >= pd.Timestamp("2025-06-01", tz="UTC") for e in far)


def test_state_for_old_hours_is_cached(actuals, monkeypatch):
    state_route._past.cache_clear()
    calls = []
    real = state_route._compute
    monkeypatch.setattr(state_route, "_compute", lambda t: calls.append(t) or real(t))
    for _ in range(3):
        assert client.get("/state?at=2025-06-01T12:00:00Z").status_code == 200
    assert len(calls) == 1
