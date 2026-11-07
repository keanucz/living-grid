import time

import pytest
from fastapi.testclient import TestClient

from engine.app import app
from engine.interventions import registry
from engine.schemas import InterventionResult
from pipeline import cache

client = TestClient(app)


@pytest.fixture(autouse=True)
def fixtures_only(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)


def post(**body):
    r = client.post("/intervene", json=body)
    assert r.status_code == 200, r.text
    return InterventionResult.model_validate(r.json())


def test_interconnector_trip_is_registered():
    assert "interconnector_trip" in registry()


def test_norway_trip_valid_and_fast():
    post(type="interconnector_trip")  # warm imports
    t = time.perf_counter()
    res = post(type="interconnector_trip")
    assert time.perf_counter() - t < 1.0
    assert res.target == "nsl" and res.kind == "scenario"
    gb = next(z for z in res.zones if z.zone == "GB")
    no2 = next(z for z in res.zones if z.zone == "NO2")
    assert gb.avg_delta > 0 > no2.avg_delta, "GB loses Norwegian imports; Norway keeps its hydro"
    assert gb.cost_gbp > 0 and len(gb.hourly) == 24
    assert all(h.delta_p10 <= h.delta_p50 <= h.delta_p90 for h in gb.hourly)
    assert res.cost_total_gbp.p10 <= res.cost_total_gbp.p50 <= res.cost_total_gbp.p90
    assert res.explanation.sentence.startswith("GB price up £")
    assert "Norway" in res.explanation.sentence
    assert any("Great Britain" in p.who for p in res.losers)
    assert {b.zone for b in res.battery} >= {"GB", "NO2"}


def test_magnitude_clamped_to_link_capacity():
    res = post(type="interconnector_trip", target="ifa", magnitude=99999, hours=6)
    assert res.clamped and res.applied_magnitude == 2000
    assert len(res.zones[0].hourly) == 6


def test_bigger_trip_costs_more():
    small = post(type="interconnector_trip", magnitude=200).cost_total_gbp.p50
    big = post(type="interconnector_trip", magnitude=1400).cost_total_gbp.p50
    assert big > small > 0


def test_longer_event_scales_cost():
    day = post(type="interconnector_trip", magnitude=1000, hours=24).cost_total_gbp.p50
    week = post(type="interconnector_trip", magnitude=1000, hours=168).cost_total_gbp.p50
    assert week == pytest.approx(7 * day, rel=0.01)


def test_unknown_link_is_422():
    assert client.post("/intervene", json={"type": "interconnector_trip", "target": "nope"}).status_code == 422


def test_unimplemented_types_still_answer():
    assert post(type="cold_snap").request.type == "cold_snap"
