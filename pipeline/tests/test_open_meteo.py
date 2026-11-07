import json
from pathlib import Path

import httpx
import pandas as pd
import pytest

from pipeline import cache, ingest, schemas
from pipeline.ingest import open_meteo as om

FX = Path(__file__).parent / "fixtures" / "open_meteo"


@pytest.fixture
def no_offline(monkeypatch):
    monkeypatch.delenv("LG_OFFLINE", raising=False)


def client(calls=None):
    def handler(req: httpx.Request):
        if calls is not None:
            calls.append(req)
        name = "historical" if "historical" in req.url.host else "live"
        locs = json.loads((FX / f"{name}.json").read_text())
        n = len(req.url.params["latitude"].split(","))
        return httpx.Response(200, json=[locs[i % len(locs)] for i in range(n)])

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_historical_recorded(no_offline):
    df = om.fetch_historical("2026-11-05", "2026-11-05", client=client())
    schemas.validate(df, "weather/historical_forecast")
    assert set(df["variable"]) == set(om.VARIABLES)
    assert set(df["zone"]) == set(schemas.ZONES)
    assert len(df) == len(om.POINTS) * len(om.VARIABLES) * 6
    assert (df["issued_at"] == df["ts"].dt.floor("D")).all()
    assert df["ts"].min() == pd.Timestamp("2026-11-05", tz="UTC")


def test_live_records_issue_time(no_offline):
    now = pd.Timestamp("2026-11-07 09:41", tz="UTC")
    df = om.fetch_live(client=client(), now=now)
    assert (df["issued_at"] == pd.Timestamp("2026-11-07 09:00", tz="UTC")).all()
    assert df["ts"].min() == pd.Timestamp("2026-11-07", tz="UTC")


def test_one_call_covers_all_points_and_long_ranges_chunk(no_offline):
    calls = []
    om.fetch_historical("2026-09-01", "2026-11-05", client=client(calls))
    assert len(calls) == 3
    for c in calls:
        assert len(c.url.params["latitude"].split(",")) == len(om.POINTS)
        assert "historical-forecast-api" in c.url.host
        assert (pd.Timestamp(c.url.params["end_date"]) - pd.Timestamp(c.url.params["start_date"])).days <= 30


def test_location_count_mismatch_is_an_error(no_offline):
    bad = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=json.loads((FX / "live.json").read_text())[:1])))
    with pytest.raises(ValueError, match="locations"):
        om.fetch_live(client=bad)


def test_offline_refuses_network(monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    with pytest.raises(RuntimeError):
        om.fetch_historical("2026-11-05", "2026-11-05", client=client())


def test_write_historical_dedupes_live_keeps_every_run(tmp_path, monkeypatch, no_offline):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    h = om.fetch_historical("2026-11-05", "2026-11-05", client=client())
    om.write(h, "historical_forecast")
    om.write(h.assign(value=h["value"] + 1), "historical_forecast")
    assert len(cache.read("weather/historical_forecast")) == len(h)
    a = om.fetch_live(client=client(), now="2026-11-07 09:00")
    b = om.fetch_live(client=client(), now="2026-11-07 10:00")
    om.write(a, "live_forecast")
    om.write(b, "live_forecast")
    assert len(cache.read("weather/live_forecast")) == len(a) + len(b)


def test_autodiscovered():
    assert "open_meteo" in ingest.sources()
