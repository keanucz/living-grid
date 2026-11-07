import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine import schemas as s
from engine.app import app
from engine.routes import carbon as route

client = TestClient(app)
H = pd.Timestamp("2026-11-07 12:00", tz="UTC")


def cons(ts=H):
    return pd.DataFrame([
        {"ts": ts, "zone": "GB", "production_gco2_kwh": 120.0, "consumption_gco2_kwh": 150.0, "imports_share": 0.15},
        {"ts": ts, "zone": "FR", "production_gco2_kwh": 40.0, "consumption_gco2_kwh": 42.0, "imports_share": 0.03},
        {"ts": ts, "zone": "NO2", "production_gco2_kwh": 10.0, "consumption_gco2_kwh": 11.0, "imports_share": 0.01},
    ])


def contrib(ts=H):
    return pd.DataFrame([
        {"ts": ts, "zone": "GB", "from_zone": "GB", "mw": 25000, "source_gco2_kwh": 120, "contribution_gco2_kwh": 102, "basis": "local"},
        {"ts": ts, "zone": "GB", "from_zone": "NL", "mw": 1000, "source_gco2_kwh": 400, "contribution_gco2_kwh": 13.6, "basis": "traced"},
        {"ts": ts, "zone": "GB", "from_zone": "DK1", "mw": 900, "source_gco2_kwh": 300, "contribution_gco2_kwh": 9.2, "basis": "estimated"},
        {"ts": ts, "zone": "FR", "from_zone": "GB", "mw": 500, "source_gco2_kwh": 150, "contribution_gco2_kwh": 2.0, "basis": "traced"},
    ])


def test_build_is_valid_and_flags_hidden_imports():
    b = route.build(H, cons(), contrib())
    r = s.CarbonResponse.model_validate(b)
    assert pd.Timestamp(r.at) == H
    gb = next(z for z in r.zones if z.zone == "GB")
    assert [i.from_zone for i in gb.imports] == ["NL", "DK1"], "local generation is not an import; biggest first"
    assert gb.imports[0].exporter_gco2_kwh == 400 and gb.kind == "modelled"
    assert "GB looks cleaner than it is" in r.note and "mostly from NL" in r.note
    assert "FR looks" not in r.note and "NO2 looks" not in r.note
    assert "standard estimates" in r.note


def test_hour_at_or_before_at():
    two = pd.concat([cons(H), cons(H + pd.Timedelta(hours=1)).assign(consumption_gco2_kwh=99.0)])
    assert route.build(H + pd.Timedelta(minutes=40), two, None)["at"] == H
    assert route.build(None, two, None)["at"] == H + pd.Timedelta(hours=1)
    assert route.build(H - pd.Timedelta(days=3), two, None)["at"] == H


def test_without_contributions_still_serves_intensity():
    b = route.build(H, cons(), None)
    s.CarbonResponse.model_validate(b)
    assert all(z["imports"] == [] for z in b["zones"])
    assert "not available" in b["note"]


def test_route_reads_pipeline_fixture():
    r = client.get("/unseen/carbon", params={"at": "2026-11-07T12:00:00Z"})
    assert r.status_code == 200, r.text
    body = s.CarbonResponse.model_validate(r.json())
    assert {z.zone for z in body.zones} == set(s.Zone.__args__)
    assert not r.json()["note"].startswith("Sample data")


def test_route_without_data_serves_labelled_sample(monkeypatch):
    monkeypatch.setattr(route, "build", lambda at=None: None)
    r = client.get("/unseen/carbon")
    assert r.status_code == 200 and r.json()["note"].startswith("Sample data")


@pytest.mark.parametrize("prod,cons_,flag", [(100, 109, False), (100, 115, True), (300, 320, False), (5, 16, True)])
def test_hidden_threshold(prod, cons_, flag):
    z = {"zone": "GB", "production_gco2_kwh": prod, "consumption_gco2_kwh": cons_, "imports_share": 0.1, "imports": []}
    assert bool(route.hidden_imports([z])) is flag


def test_zones_ending_at_different_hours_are_all_served():
    # Live: GB (Elexon) runs to 16:00 while Energy-Charts zones stop at 13:00-15:00.
    ends = {"GB": 16, "DE-LU": 15, "FR": 14, "NL": 14, "NO2": 14, "BE": 13}
    rows = [
        {"ts": pd.Timestamp(f"2026-11-07 {h:02d}:00", tz="UTC"), "zone": z, "production_gco2_kwh": 100.0 + h,
         "consumption_gco2_kwh": 110.0 + h, "imports_share": 0.1}
        for z, end in ends.items() for h in range(end - 3, end + 1)
    ]
    c = contrib(pd.Timestamp("2026-11-07 13:00", tz="UTC"))
    body = route.build(consumption=pd.DataFrame(rows), contributions=c)
    s.CarbonResponse.model_validate(body)
    got = {z["zone"]: z for z in body["zones"]}
    assert sorted(got) == sorted(ends)
    assert body["at"] == pd.Timestamp("2026-11-07 16:00", tz="UTC")
    assert got["BE"]["production_gco2_kwh"] == 113.0, "each zone's own latest hour"
    assert got["GB"]["imports"] == [], "contributions only from the zone's matched hour (GB's is 16:00)"


def test_zone_older_than_tolerance_is_left_out():
    rows = cons(H)
    stale = rows[rows["zone"] == "NO2"].assign(ts=H - route.AS_OF_TOLERANCE)
    fresh = rows[rows["zone"] != "NO2"]
    body = route.build(consumption=pd.concat([fresh, stale]), contributions=None)
    assert sorted(z["zone"] for z in body["zones"]) == ["FR", "GB"]


RUNNER = "/srv/hack/runner/data/carbon/consumption_intensity.parquet"


@pytest.mark.skipif(not __import__("os").path.exists(RUNNER), reason="runner data not on this machine")
def test_live_parquet_returns_all_six_zones():
    body = route.build(consumption=pd.read_parquet(RUNNER), contributions=None)
    assert sorted(z["zone"] for z in body["zones"]) == sorted(s.Zone.__args__)
