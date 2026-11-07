import json
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine import schemas as s
from engine.app import app
from engine.ghost_wind import costs
from pipeline.ingest import boalf as boalf_ingest
from pipeline.ingest import neso

FX = Path(__file__).resolve().parents[2] / "pipeline" / "tests" / "fixtures"
FROM = pd.Timestamp("2026-10-26 00:00", tz="UTC")
TO = pd.Timestamp("2026-10-26 23:00", tz="UTC")
NOW = pd.Timestamp("2026-11-07 13:00", tz="UTC")


def _mock(routes):
    return httpx.Client(transport=httpx.MockTransport(routes))


@pytest.fixture(scope="module")
def frames():
    def b(req):
        p = req.url.path
        if p.endswith("bmunits/all"):
            return httpx.Response(200, json=json.loads((FX / "boalf/bmunits.json").read_text()))
        period = int(p.rsplit("/", 1)[1])
        if period in (29, 30) and p.endswith(f"2026-10-26/{period}"):
            return httpx.Response(200, json=json.loads((FX / f"boalf/boav_{period}.json").read_text()))
        return httpx.Response(200, json={"data": []})

    def n(req):
        if req.url.path.endswith("package_show"):
            return httpx.Response(200, json=json.loads((FX / "neso/package_show.json").read_text()))
        name = "boundary_flows.json" if "Constraint Group" in req.url.params["sql"] else "constraint_costs.json"
        return httpx.Response(200, json=json.loads((FX / f"neso/{name}").read_text()))

    with _mock(b) as c:
        bids = boalf_ingest.fetch_bids(FROM, TO, c, boalf_ingest.wind_units(c))
    with _mock(n) as c:
        cost = neso.fetch_costs("2026-10-12", "2026-10-29", c, now=NOW)
        flows = neso.fetch_boundaries("2026-10-26", "2026-10-26 23:00", c, now=NOW)
    return {"bids": bids, "costs": cost, "flows": flows}


def body(frames, **kw):
    return costs.build(FROM, TO, bids=frames["bids"], weather=None, metered=pd.DataFrame(),
                       costs=frames["costs"], flows=frames["flows"], **kw)


def test_storm_day_response_is_valid(frames):
    b = body(frames)
    r = s.GhostWindResponse.model_validate(b)
    assert {g.region for g in r.regions} == {"N", "P"}
    assert r.total_boalf_mwh == pytest.approx(sum(g.boalf_mwh for g in r.regions))
    assert r.total_boalf_mwh > 0 and r.total_weather_gap_mwh == 0
    north = next(g for g in r.regions if g.region == "P")
    assert north.name == "North Scotland" and -8 < north.centroid[0] < 0 and 56 < north.centroid[1] < 61
    assert sum(p.boalf_mw for p in north.series) == pytest.approx(north.boalf_mwh)
    assert "not yet available" in r.note


def test_constraint_costs_include_storm_and_lag(frames):
    r = s.GhostWindResponse.model_validate(body(frames))
    by_day = {c.date.isoformat(): c.gbp for c in r.constraint_costs}
    assert by_day["2026-10-26"] == pytest.approx(36125099 + 405770)
    assert max(by_day) <= "2026-10-26"
    assert r.constraint_cost_total_gbp == pytest.approx(sum(by_day.values()))
    assert all(c.kind == "actual" for c in r.constraint_costs)
    assert "days old" in r.note


def test_boundary_flows_in_window_against_limits(frames):
    r = s.GhostWindResponse.model_validate(body(frames))
    assert r.boundary_flows and all(FROM <= pd.Timestamp(f.ts) <= TO for f in r.boundary_flows)
    assert all(f.limit_mw > 0 and f.kind == "forecast" for f in r.boundary_flows)
    assert {f.boundary for f in r.boundary_flows} <= {"SCOTEX", "SSEN-S", "SSE-SP", "SSHARN"}


def test_weather_gap_included_when_metered_exists(frames):
    ts = pd.date_range(FROM, TO, freq="h")
    weather = pd.DataFrame({"ts": ts, "issued_at": FROM, "zone": "GB", "point": "moray_firth",
                            "variable": "wind_speed_100m", "value": 15.0})
    metered = pd.DataFrame([{"ts": t, "bm_unit": "SGRWO-1", "mwh": 100.0} for t in ts])
    b = costs.build(FROM, TO, bids=frames["bids"], weather=weather, metered=metered,
                    costs=frames["costs"], flows=frames["flows"])
    r = s.GhostWindResponse.model_validate(b)
    assert r.total_weather_gap_mwh > 0
    assert "modelled" in r.note


def test_publish_rows_price_curtailment(frames):
    rows = costs.publish_rows(FROM, TO, bids=frames["bids"], metered=pd.DataFrame(), costs=frames["costs"])
    assert list(rows.columns) == ["ts", "region", "method", "mwh", "cost_gbp"]
    rate = costs.cost_per_mwh(frames["costs"])["2026-10-26"]
    assert 50 < rate < 2000
    busy = rows[rows["mwh"] > 0]
    assert len(busy) and np.allclose(busy["cost_gbp"], busy["mwh"] * rate)
    from engine.publisher import rows as R

    assert {"ts_us", "region", "method", "mwh", "cost_gbp"} == set(R.ghost_wind(rows)[0])


def test_route_without_data_serves_labelled_sample(monkeypatch):
    monkeypatch.setattr(costs, "has_data", lambda *a, **k: False)
    r = TestClient(app).get("/unseen/ghost-wind")
    assert r.status_code == 200
    assert r.json()["note"].startswith("Sample data")


def test_route_uses_cached_data(monkeypatch, frames):
    monkeypatch.setattr(costs, "has_data", lambda *a, **k: True)
    real = costs.build
    monkeypatch.setattr(costs, "build", lambda f, t: real(f, t, bids=frames["bids"], metered=pd.DataFrame(),
                                                          costs=frames["costs"], flows=frames["flows"]))
    r = TestClient(app).get("/unseen/ghost-wind", params={"from": "2026-10-26T00:00:00Z", "to": "2026-10-26T23:00:00Z"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["from"].startswith("2026-10-26T00:00") and j["total_boalf_mwh"] > 0
