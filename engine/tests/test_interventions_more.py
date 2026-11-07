import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from engine.app import app
from engine.interventions import registry
from engine.interventions import residual as rz
from engine.schemas import InterventionResult
from pipeline import cache

client = TestClient(app)
FACTS = Path(__file__).resolve().parents[1] / "reference" / "facts"


@pytest.fixture(autouse=True)
def fixtures_only(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)


def post(**body):
    r = client.post("/intervene", json=body)
    assert r.status_code == 200, r.text
    return InterventionResult.model_validate(r.json())


def deltas(res):
    return {z.zone: z.avg_delta for z in res.zones}


@pytest.mark.parametrize("typ", ["nuclear_outage", "wind", "cold_snap", "scottish_storm"])
def test_registered_valid_and_fast(typ):
    assert typ in registry()
    post(type=typ)
    t = time.perf_counter()
    res = post(type=typ)
    assert time.perf_counter() - t < 1.0
    assert not res.id.startswith("fixture-")
    assert res.cost_total_gbp.p10 <= res.cost_total_gbp.p50 <= res.cost_total_gbp.p90


def test_french_nuclear_outage_raises_france_most_and_ripples():
    d = deltas(post(type="nuclear_outage"))
    assert d["FR"] > d["BE"] > 0 and d["GB"] > 0
    assert d["FR"] == max(d.values())
    assert d["NO2"] == 0, "no direct link from France"


def test_nuclear_clamped_to_fleet():
    res = post(type="nuclear_outage", target="FR", magnitude=1e6)
    assert res.clamped and res.applied_magnitude == rz.FR_NUCLEAR_MW
    assert res.explanation.sentence.startswith("France price up €")


def test_nuclear_unknown_zone_is_422():
    assert client.post("/intervene", json={"type": "nuclear_outage", "target": "NO2"}).status_code == 422


def test_cold_snap_raises_prices_france_most():
    d = deltas(post(type="cold_snap"))
    assert all(v > 0 for v in d.values())
    assert d["FR"] == max(d.values()), "France heats with electricity"


def test_windless_week_raises_and_storm_lowers_prices():
    calm, storm = deltas(post(type="wind", magnitude=-50)), deltas(post(type="wind", magnitude=60))
    assert calm["GB"] > 0 > storm["GB"]
    assert calm["FR"] == 0, "France is outside the North Sea default"


def test_scottish_storm_lowers_gb_price_and_raises_ghost_wind():
    res = post(type="scottish_storm")
    d = deltas(res)
    assert d["GB"] < 0 and all(v == 0 for z, v in d.items() if z != "GB")
    assert res.ghost_wind and res.ghost_wind.delta_mwh > 0 and res.ghost_wind.delta_constraint_cost_gbp > 0
    assert "paid to switch off" in res.explanation.sentence


def test_bigger_storm_more_ghost_wind():
    small = post(type="scottish_storm", magnitude=20).ghost_wind.delta_mwh
    big = post(type="scottish_storm", magnitude=80).ghost_wind.delta_mwh
    assert big >= small


def _fact(file, fid):
    return next(f for f in json.loads((FACTS / file).read_text()) if f["id"] == fid)


@pytest.mark.parametrize(
    ("file", "fid", "needles"),
    [
        ("events.json", "ev_fr_nuclear_capacity", ["63"]),
        ("events.json", "ev_fr_reactor_size", ["900", "1,300", "1,450", "1,630"]),
        ("events.json", "ev_fr_temp_sensitivity", ["2 400"]),
        ("events.json", "ev_gb_wind_capacity", ["14.3", "16.0"]),
    ],
)
def test_constants_match_verified_facts(file, fid, needles):
    fact = _fact(file, fid)
    assert fact["verified"] is True
    assert all(n in str(fact["value"]) for n in needles), fact["value"]
