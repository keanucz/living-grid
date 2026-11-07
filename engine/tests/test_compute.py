import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine import compute as c
from engine import schemas as s
from engine.app import app

client = TestClient(app)
NOW = pd.Timestamp("2026-11-07 23:00", tz="UTC")


def log(zone="GB", made=NOW - pd.Timedelta(hours=1), cheap=(5, 6, 7), level=100.0, cheap_level=40.0, n=24, spread=10.0):
    ts = pd.date_range(NOW.floor("h"), periods=n + 2, freq="h")
    p50 = [cheap_level if t.hour in cheap else level for t in ts]
    return pd.DataFrame({"made_at": made, "zone": zone, "target": "price_da", "ts": ts, "horizon_h": 1,
                         "p10": [p - spread for p in p50], "p50": p50, "p90": [p + 2 * spread for p in p50],
                         "model_version": "t"})


@pytest.fixture
def frames(monkeypatch):
    state = {"log": log(), "actuals": pd.DataFrame(columns=["ts", "zone", "series", "value", "unit", "source"])}
    monkeypatch.setattr(c.data, "forecast_log", lambda: state["log"])
    monkeypatch.setattr(c.data, "actuals", lambda: state["actuals"])
    return state


def test_finds_cheapest_window_and_saving(frames):
    b = c.build(kw=2000, hours=3, zones="GB", now=NOW)
    s.ComputeResponse.model_validate(b)
    gb = b["zones"][0]
    assert pd.Timestamp(gb["start"]) == pd.Timestamp("2026-11-08 05:00", tz="UTC")
    assert gb["cost"]["p50"] == 3 * 40 * 2, "3 h x 40 GBP/MWh x 2 MW"
    assert gb["cost_now"]["p50"] == 3 * 100 * 2
    assert gb["saving"]["p50"] == 360 and gb["saving_eur"]["p50"] == pytest.approx(360 * c.EUR_PER_GBP)
    assert gb["cost"]["p10"] < gb["cost"]["p50"] < gb["cost"]["p90"] and gb["kind"] == "forecast"
    assert gb["saving"]["p10"] <= gb["saving"]["p50"] <= gb["saving"]["p90"]
    assert pd.Timestamp(gb["prices"][0]["ts"]) == NOW + pd.Timedelta(hours=1), "starts at the next hour"


def test_cheapest_zone_compares_in_eur(frames):
    # GB at 40 GBP (46 EUR) loses to FR at 45 EUR.
    frames["log"] = pd.concat([log("GB"), log("FR", cheap_level=45.0)])
    b = c.build(hours=3, zones="GB,FR", now=NOW)
    assert b["cheapest_zone"] == "FR" and [z["zone"] for z in b["zones"]] == ["FR", "GB"]


def test_cleared_prices_replace_forecast_and_have_no_spread(frames):
    hrs = pd.date_range(NOW + pd.Timedelta(hours=1), periods=24, freq="15min")
    frames["actuals"] = pd.DataFrame({"ts": hrs, "zone": "GB", "series": "price_da", "value": 10.0,
                                      "unit": "GBP/MWh", "source": "nordpool"})
    gb = c.build(hours=3, zones="GB", now=NOW)["zones"][0]
    assert pd.Timestamp(gb["start"]) == NOW + pd.Timedelta(hours=1), "the cleared 10 GBP hours beat the forecast"
    first = gb["prices"][0]
    assert first["kind"] == "actual" and first["p10"] == first["p50"] == first["p90"] == 10.0
    assert gb["kind"] == "actual" and gb["cost"]["p10"] == gb["cost"]["p90"]


def test_forecasts_made_after_now_are_not_used(frames):
    frames["log"] = log(made=NOW + pd.Timedelta(hours=2))
    b = c.build(zones="GB", now=NOW)
    assert b["zones"] == [] and b["cheapest_zone"] is None and "left out" in b["note"]


def test_deadline_limits_the_search(frames):
    b = c.build(hours=3, zones="GB", now=NOW, deadline=NOW + pd.Timedelta(hours=5))
    assert pd.Timestamp(b["zones"][0]["end"]) <= NOW + pd.Timedelta(hours=5)
    assert b["zones"][0]["saving"]["p50"] == 0


@pytest.mark.parametrize("q", ["kw=0", "hours=0", "hours=25", "zones=XX", "deadline=2026-11-08T01:00:00Z&hours=6"])
def test_bad_requests_are_422(q):
    r = client.get(f"/compute?at=2026-11-07T23:00:00Z&{q}")
    assert r.status_code == 422


def test_route_offline_fixtures_cover_all_zones():
    r = client.get("/compute", params={"at": "2026-11-07T23:00:00Z", "kw": 500, "hours": 4})
    assert r.status_code == 200, r.text
    body = s.ComputeResponse.model_validate(r.json())
    assert {z.zone for z in body.zones} == set(s.Zone.__args__)
    assert body.cheapest_zone == body.zones[0].zone and body.hours == 4
