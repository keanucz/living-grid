import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine import data
from engine.app import app
from engine.routes import generation as route

client = TestClient(app)
DAY = pd.Timestamp("2026-10-26", tz="UTC")


def rows(zone, source, series_values, hours=(0, 1), day=DAY):
    return [{"ts": day + pd.Timedelta(hours=h), "zone": zone, "series": s, "value": v, "unit": "MW", "source": source}
            for h in hours for s, v in series_values.items()]


@pytest.fixture
def actuals(monkeypatch):
    frame = pd.DataFrame(
        rows("GB", "elexon", {"gen_gas": 6000.0, "gen_wind": 2000.0, "gen_nuclear": 2000.0, "gen_pumped_storage": -300.0})
        + rows("GB", "elexon", {"load": 30000.0}, hours=(0,))
        + rows("FR", "energycharts", {"gen_nuclear": 40000.0, "gen_wind_onshore": 1000.0, "gen_wind_offshore": 500.0,
                                      "gen_hydro_pumped_storage": 100.0, "gen_hydro_pumped_storage_consumption": -600.0,
                                      "gen_battery": 5.0, "gen_fossil_hard_coal": -3.0})
        + rows("NO2", "energycharts", {"gen_hydro_run_of_river": 99999.0})  # whole-country feed, never used for NO2
        + rows("GB", "elexon", {"gen_gas": 1.0}, day=DAY + pd.Timedelta(days=2)))
    monkeypatch.setattr(data, "actuals", lambda: frame)
    return frame


def test_one_zone_hours_share_and_sentence(actuals):
    b = client.get("/generation", params={"zone": "GB", "date": "2026-10-26"}).json()
    assert b["source"] == "Elexon (FUELHH)" and b["unit"] == "MW" and len(b["hours"]) == 2
    assert b["hours"][0] == {"t": "2026-10-26T00:00:00Z", "mw": {**dict.fromkeys(route.FUELS, 0.0), "gas": 6000.0, "wind": 2000.0, "nuclear": 2000.0},
                             "pumped_mw": -300.0, "load_mw": 30000.0}
    assert b["hours"][1]["load_mw"] is None and b["fuels"] == ["nuclear", "wind", "gas"]
    assert b["share"] == {"nuclear": 0.2, "wind": 0.2, "gas": 0.6}
    assert b["sentence"] == "Gas made 60% of Britain's power on 26 Oct; wind 20%." and b["as_of"] == "2026-10-26T01:00:00Z"


def test_fuels_group_pumped_and_battery_are_kept_out(actuals):
    b = client.get("/generation", params={"zone": "FR", "date": "2026-10-26"}).json()
    assert b["hours"][0]["mw"]["wind"] == 1500.0 and b["hours"][0]["mw"]["coal"] == 0.0  # negatives clipped
    assert b["hours"][0]["pumped_mw"] == -500.0 and "battery" not in str(b["hours"][0]["mw"])
    assert b["share"]["nuclear"] > 0.9 and b["sentence"].startswith("Nuclear made")


def test_no2_ignores_the_whole_country_feed_and_says_when_empty(actuals):
    b = client.get("/generation", params={"zone": "NO2", "date": "2026-10-26"}).json()
    assert b["hours"] == [] and b["share"] == {} and b["sentence"].startswith("No metered generation for southern Norway") and "Elhub lands a day or two late" in b["sentence"]
    assert b["source"] == "Elhub" and b["note"]


def test_all_zones_share_one_scale_and_other_days_are_separate(actuals):
    b = client.get("/generation", params={"date": "2026-10-26"}).json()
    assert [z["zone"] for z in b["zones"]] == list(route.ZONES) and b["scale_max_mw"] == pytest.approx(41500.0)
    assert client.get("/generation", params={"zone": "GB", "date": "2026-10-28"}).json()["hours"][0]["mw"]["gas"] == 1.0


def test_validation(actuals):
    assert client.get("/generation", params={"zone": "XX"}).status_code == 422
    assert client.get("/generation", params={"date": "26/10/2026"}).status_code == 422
    assert "/generation" not in client.get("/openapi.json").json()["paths"]


def test_today_wording():
    today = pd.Timestamp.now(tz="UTC").normalize()
    assert route.sentence("NL", today, {"gas": 0.5, "wind": 0.1}) == "Gas made 50% of the Netherlands' power today so far; wind 10%."
    assert route.sentence("BE", today - pd.Timedelta(days=1), {"wind": 0.4, "gas": 0.3}) == "Wind made 40% of Belgium's power yesterday; gas 30%."


def test_empty_today_has_no_so_far():
    today = pd.Timestamp.now(tz="UTC").normalize()
    assert route.sentence("NO2", today, {}) == "No metered generation for southern Norway today yet (Elhub lands a day or two late)."
