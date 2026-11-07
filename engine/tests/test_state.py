import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine import data
from engine.app import app
from engine.schemas import StateResponse, ZonesResponse
from pipeline import cache

client = TestClient(app)
AT = "2026-11-07T23:00:00Z"


@pytest.fixture(autouse=True)
def fixtures_only(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    return tmp_path


def test_state_has_all_zones_from_pipeline_fixtures():
    r = client.get(f"/state?at={AT}")
    assert r.status_code == 200, r.text
    body = StateResponse.model_validate(r.json())
    assert [z.zone for z in body.zones] == data.ZONES
    for z in body.zones:
        assert z.price and z.price.kind == "actual"
        assert z.forecast and z.forecast.p10 <= z.forecast.p50 <= z.forecast.p90
        assert z.forecast.made_at <= body.at
        assert z.carbon and z.carbon.kind == "modelled"
        assert z.load_mw and z.mix_mw
    assert body.zones[0].price.unit == "GBP/MWh"
    assert body.zones[1].price.unit == "EUR/MWh"


def test_state_never_shows_a_forecast_made_after_at():
    body = client.get("/state?at=2026-11-07T12:00:00Z").json()
    assert all(z["forecast"] is None for z in body["zones"])


def test_state_defaults_to_latest_actual_hour():
    assert client.get("/state").json()["at"].startswith("2026-11-07T23:00")


def test_flows_match_fixture_and_split_by_capacity():
    flows = client.get(f"/state?at={AT}").json()["flows"]
    nsl = next(f for f in flows if f["interconnector_id"] == "nsl")
    raw = pd.read_parquet(cache.FIXTURES / "actuals" / "energycharts_flow_NO2_GB.parquet")
    expected = raw.loc[raw["ts"] == pd.Timestamp(AT), "value"].iloc[0]
    assert nsl["mw"] == pytest.approx(-expected, abs=0.1)
    assert nsl["kind"] == "actual"


def test_pair_split_across_parallel_links(tmp_path):
    ts = pd.Timestamp(AT)
    df = pd.DataFrame({"ts": [ts], "zone": ["GB"], "series": ["flow_GB_FR"], "value": [-4000.0], "unit": ["MW"]})
    (tmp_path / "actuals").mkdir()
    df.to_parquet(tmp_path / "actuals" / "elexon_flow_GB_FR.parquet")
    flows = {f["interconnector_id"]: f for f in data.link_flows(ts)}
    assert flows["ifa"]["mw"] == pytest.approx(-2000)
    assert flows["ifa2"]["mw"] == pytest.approx(-1000)
    assert flows["ifa"]["kind"] == "estimated"


def test_data_dir_wins_over_fixtures(tmp_path):
    ts = pd.Timestamp(AT)
    df = pd.DataFrame({"ts": [ts], "zone": ["GB"], "series": ["price_da"], "value": [999.0], "unit": ["GBP/MWh"]})
    (tmp_path / "actuals").mkdir()
    df.to_parquet(tmp_path / "actuals" / "nordpool_price_da.parquet")
    gb = client.get(f"/state?at={AT}").json()["zones"][0]
    assert gb["price"] == {"value": 999.0, "unit": "GBP/MWh", "kind": "actual", "source": "nordpool"}


def test_zones_from_static_data():
    body = ZonesResponse.model_validate(client.get("/zones").json())
    assert [z.zone for z in body.zones] == data.ZONES
    assert len(body.gb_regions) == 14
    ids = {i.id for i in body.interconnectors}
    assert {"nsl", "ifa", "britned", "fr-be"} <= ids
    assert len(body.zones_geojson["features"]) == 6
