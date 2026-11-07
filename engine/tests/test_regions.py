import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine import schemas as s
from engine.app import app
from engine.routes import regions as route
from pipeline import cache, static

client = TestClient(app)
LETTERS = set(static.gb_region_keys()["region"])


def test_offline_fixture_serves_all_14_regions_with_modelled_carbon_and_mix():
    r = client.get("/regions")
    assert r.status_code == 200, r.text
    body = s.RegionsResponse.model_validate(r.json())
    assert {x.region for x in body.regions} == LETTERS and len(body.regions) == 14
    assert pd.Timestamp(body.at) == pd.Timestamp("2026-11-07 13:00", tz="UTC")
    for x in body.regions:
        assert x.carbon_kind == "modelled" and x.carbon_gco2_kwh is not None and x.mix
        assert 95 <= sum(m.perc for m in x.mix) <= 105
        assert [m.perc for m in x.mix] == sorted((m.perc for m in x.mix), reverse=True)
    north = next(x for x in body.regions if x.region == "P")
    wales = next(x for x in body.regions if x.region == "K")
    assert north.mix[0].fuel == "wind" and north.carbon_gco2_kwh < wales.carbon_gco2_kwh
    assert "modelled" in body.note and "one wholesale price" in body.note


def test_centroids_fall_inside_gb():
    for lon, lat in route.centroids().values():
        assert -8.5 < lon < 2 and 49.8 < lat < 61


def test_agile_from_household_forecast():
    b = route.build(now="2026-11-08T01:00:00Z")
    london = next(x for x in b["regions"] if x["region"] == "C")
    assert london["agile_kind"] == "forecast"
    assert london["agile_tonight_min_p_kwh"] <= london["agile_tonight_avg_p_kwh"]
    assert london["agile_tonight_min_at"] >= pd.Timestamp("2026-11-08T01:00:00Z")


def test_at_picks_the_hour_at_or_before():
    b = route.build(at="2026-11-07T12:40:00Z")
    assert pd.Timestamp(b["at"]) == pd.Timestamp("2026-11-07 12:00", tz="UTC")


def test_stale_region_is_left_without_carbon(monkeypatch, tmp_path):
    ts = pd.Timestamp("2026-11-07 13:00", tz="UTC")
    rows = [{"ts": ts, "region": r, "region_id": 0, "intensity_gco2_kwh": 100.0, "index": "low"} for r in LETTERS - {"A"}]
    rows.append({"ts": ts - route.AS_OF_TOLERANCE - pd.Timedelta(hours=1), "region": "A", "region_id": 0,
                 "intensity_gco2_kwh": 50.0, "index": "low"})
    df = pd.DataFrame(rows)
    monkeypatch.setattr(route.boalf, "read_live", lambda name: df if name == route.REGIONAL else None)
    b = route.build(at=ts)
    a = next(x for x in b["regions"] if x["region"] == "A")
    assert a["carbon_gco2_kwh"] is None and a["mix"] == []
    assert sum(x["carbon_gco2_kwh"] is not None for x in b["regions"]) == 13


def test_ghost_wind_only_for_mapped_scottish_regions(monkeypatch):
    ts = pd.Timestamp("2026-11-07 13:00", tz="UTC")
    bids = pd.DataFrame([{"ts": ts - pd.Timedelta(hours=2), "bm_unit": "VKNGW-1", "region": "P", "capacity_mw": 443.0, "mwh": 80.0},
                         {"ts": ts - pd.Timedelta(hours=30), "bm_unit": "VKNGW-1", "region": "P", "capacity_mw": 443.0, "mwh": 999.0}])
    monkeypatch.setattr(route.boalf, "load_bids", lambda: bids)
    b = route.build()
    got = {x["region"]: x["ghost_wind_mwh_24h"] for x in b["regions"]}
    assert got["P"] == pytest.approx(80.0) and got["N"] == 0.0
    assert all(v is None for r, v in got.items() if r not in ("N", "P"))


def test_online_without_ingest_is_honest(monkeypatch, tmp_path):
    monkeypatch.delenv("LG_OFFLINE", raising=False)
    monkeypatch.setattr(cache, "DATA", tmp_path)
    body = s.RegionsResponse.model_validate(client.get("/regions").json())
    assert len(body.regions) == 14
    assert all(x.carbon_gco2_kwh is None and x.mix == [] for x in body.regions)
    assert "not been ingested" in body.note
