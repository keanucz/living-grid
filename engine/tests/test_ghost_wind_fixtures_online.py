"""Online (LG_OFFLINE unset), committed fixtures must never be served or published as live data."""

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine.app import app
from engine.battery import compare
from engine.ghost_wind import boalf, costs
from engine.routes import carbon as carbon_route
from pipeline import cache


@pytest.fixture
def online_empty(monkeypatch, tmp_path):
    monkeypatch.delenv("LG_OFFLINE", raising=False)
    monkeypatch.setattr(cache, "DATA", tmp_path)
    return tmp_path


@pytest.fixture
def offline(monkeypatch, tmp_path):
    monkeypatch.setenv("LG_OFFLINE", "1")
    monkeypatch.setattr(cache, "DATA", tmp_path)


def test_online_with_no_data_reads_nothing(online_empty):
    assert boalf.load_bids() is None
    assert costs.load_weather() is None
    assert not costs.has_data()
    assert carbon_route.build() is None, "pipeline/fixtures has carbon, but it must not be read online"
    assert compare.load_inputs() == (None, None), "pipeline/fixtures has forecasts and prices"
    assert costs.publish_rows("2026-11-06", "2026-11-07").empty


def test_online_routes_label_sample(online_empty):
    client = TestClient(app)
    assert client.get("/unseen/carbon").json()["note"].startswith("Sample data")
    assert client.get("/unseen/ghost-wind").json()["note"].startswith("Sample data")


def test_online_reads_live_files(online_empty):
    ts = pd.Timestamp("2026-11-07 12:00", tz="UTC")
    cache.write("carbon/consumption_intensity", pd.DataFrame([
        {"ts": ts, "zone": "GB", "production_gco2_kwh": 100.0, "consumption_gco2_kwh": 130.0, "imports_share": 0.2}]))
    cache.write("boalf/wind_bids", pd.DataFrame([
        {"ts": ts, "bm_unit": "VKNGW-1", "region": "P", "capacity_mw": 443.0, "mwh": 50.0}]))
    assert carbon_route.build()["zones"][0]["consumption_gco2_kwh"] == 130.0
    assert boalf.load_bids()["mwh"].sum() == 50.0
    assert costs.has_data()


def test_offline_still_uses_fixtures(offline):
    assert carbon_route.build() is not None
    log, actual = compare.load_inputs()
    assert log is not None and actual is not None
