import json

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine.app import app
from engine.routes import weather_grid as route
from pipeline import cache
from pipeline.ingest import weather_grid as wg

client = TestClient(app)


def test_grid_covers_zones_and_is_regular():
    g = wg.grid()
    assert 1000 < len(g) < 2500
    assert not g.duplicated().any()
    near = lambda lat, lon: ((g.lat - lat).abs() < 0.3) & ((g.lon - lon).abs() < 0.3)
    for lat, lon in [(58.0, -3.0), (48.5, 2.5), (52.5, 5.0), (52.0, 10.0), (59.0, 6.0), (56.0, 2.0)]:
        assert near(lat, lon).any()


def test_fixture_hour_is_compact_and_consistent():
    r = client.get("/weather/grid", params={"t": "2026-11-06T12:00:00Z"})
    assert r.status_code == 200, r.text
    b = r.json()
    n = len(b["lats"])
    assert n == len(b["lons"]) == len(b["wind_speed_dms"]) == len(b["wind_dir_deg"]) == len(b["shortwave_wm2"])
    assert len(r.content) < 300_000
    assert b["kind"] in ("modelled", "synthetic") and "Open-Meteo" in b["source"]
    assert b["kind"] == "modelled" or "SYNTHETIC" in b["note"]
    assert all(0 <= d < 360 for d in b["wind_dir_deg"])
    assert max(b["wind_speed_dms"]) > min(b["wind_speed_dms"])


def test_out_of_range_hour_is_404():
    assert client.get("/weather/grid", params={"t": "2030-01-01T00:00:00Z"}).status_code == 404


def test_finish_dedupes_and_types():
    df = wg.synthetic(hours=2)
    out = wg._finish(pd.concat([df, df]))
    assert out["wind_speed_100m"].dtype == "float32"


class _Resp:
    status_code = 200
    headers = {}

    def __init__(self, n):
        self.n = n

    def raise_for_status(self):
        pass

    def json(self):
        t = ["2026-11-06T00:00", "2026-11-06T01:00"]
        return [{"hourly": {"time": t, "wind_speed_100m": [5, 6], "wind_direction_100m": [270, 280],
                            "shortwave_radiation": [0, 10]}}] * self.n


class _Client:
    def get(self, url, params):
        return _Resp(len(params["latitude"].split(",")))


def test_fetch_parses_chunks(monkeypatch):
    monkeypatch.delenv("LG_OFFLINE", raising=False)
    monkeypatch.setattr(wg, "time", type("T", (), {"sleep": staticmethod(lambda s: None)}))
    out = wg.fetch(client=_Client())
    assert len(out) == len(wg.grid()) * 2
    assert set(out.columns) == {"ts", "lat", "lon", *wg.COLUMNS}


def test_fetch_refuses_offline(monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    with pytest.raises(RuntimeError):
        wg.fetch()
