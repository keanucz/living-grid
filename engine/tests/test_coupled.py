import os
import time
from datetime import date

import httpx
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine import coupled
from engine.app import app
from engine.routes._fixtures import fixture
from engine.schemas import CoupledResponse
from pipeline import cache

DAY = date(2026, 11, 8)


def payload(price=100.0):
    """Two hours of quarter-hour prices for SE1 and DK1, plus a zone we do not serve and a missing price."""
    entries = []
    for h, base in ((23, 0.0), (0, 40.0)):
        day = "2026-11-07" if h == 23 else "2026-11-08"
        for q in range(4):
            entries.append({"deliveryStart": f"{day}T{h:02d}:{q * 15:02d}:00Z",
                            "entryPerArea": {"SE1": price + base + q, "DK1": None if q == 0 else 200.0, "XX": 1.0}})
    return {"multiAreaEntries": entries}


def client_for(body, calls):
    def handle(request):
        calls.append(request)
        return httpx.Response(200, json=body)
    return httpx.Client(transport=httpx.MockTransport(handle))


@pytest.fixture
def online(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.delenv("LG_OFFLINE", raising=False)
    return tmp_path


def test_parse_averages_quarter_hours_and_drops_unknown_zones():
    df = coupled.parse(payload())
    assert set(df["zone"]) == {"SE1", "DK1"}
    se1 = df[df["zone"] == "SE1"].set_index("ts")["value"]
    assert se1[pd.Timestamp("2026-11-07T23:00Z")] == pytest.approx(101.5)
    assert se1[pd.Timestamp("2026-11-08T00:00Z")] == pytest.approx(141.5)
    dk1 = df[df["zone"] == "DK1"].set_index("ts")["value"]
    assert dk1[pd.Timestamp("2026-11-07T23:00Z")] == 200.0  # the missing quarter is ignored, not counted as 0


def test_response_this_hour_and_day_stats():
    df = coupled.parse(payload())
    r = coupled.response(df, DAY, pd.Timestamp("2026-11-08T00:30Z"), pd.Timestamp("2026-11-08T00:31Z").to_pydatetime())
    CoupledResponse.model_validate(r)
    se1 = next(z for z in r["zones"] if z["zone"] == "SE1")
    assert (se1["name"], se1["country"], se1["price"]) == ("Sweden north", "Sweden", 141.5)
    assert (se1["day_min"], se1["day_max"], se1["day_avg"]) == (101.5, 141.5, 121.5)
    later = coupled.response(df, DAY, pd.Timestamp("2026-11-08T05:00Z"), r["as_of"])
    assert next(z for z in later["zones"] if z["zone"] == "SE1")["price"] is None
    assert [z["zone"] for z in r["zones"]] == ["DK1", "SE1"]  # ZONES order, zones without data left out


def test_delivery_day_is_the_cet_calendar_day():
    assert coupled.delivery_day(pd.Timestamp("2026-11-07T23:30Z")) == DAY
    assert coupled.delivery_day(pd.Timestamp("2026-11-08T22:59Z")) == DAY


def test_fetches_once_then_serves_the_cache_for_15_minutes(online):
    calls = []
    c = client_for(payload(), calls)
    coupled.hourly(DAY, c)
    coupled.hourly(DAY, c)
    assert len(calls) == 1
    assert calls[0].url.params["deliveryArea"].split(",") == list(coupled.ZONES)
    assert calls[0].url.params["date"] == "2026-11-08"
    old = time.time() - coupled.REFRESH_S - 5
    os.utime(cache.path(coupled.name(DAY)), (old, old))
    df, _ = coupled.hourly(DAY, client_for(payload(price=0.0), calls))
    assert len(calls) == 2
    assert df[df["zone"] == "SE1"]["value"].min() == pytest.approx(1.5)


def test_failed_refresh_serves_the_stale_cache(online):
    coupled.hourly(DAY, client_for(payload(), []))
    old = time.time() - coupled.REFRESH_S - 5
    os.utime(cache.path(coupled.name(DAY)), (old, old))
    broken = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    df, _ = coupled.hourly(DAY, broken)
    assert len(df)


def test_no_data_online_is_503_not_the_fixture(online, monkeypatch):
    def fail(day, client=None):
        raise coupled.Unavailable("not published")
    monkeypatch.setattr(coupled, "fetch", fail)
    r = TestClient(app).get("/coupled?at=2026-11-08T08:00:00Z")
    assert r.status_code == 503


def test_offline_without_cache_serves_the_fixture(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.setenv("LG_OFFLINE", "1")
    r = TestClient(app).get("/coupled")
    assert r.status_code == 200
    assert r.json() == fixture("coupled")


def test_offline_with_cache_serves_the_cache(online, monkeypatch):
    coupled.hourly(DAY, client_for(payload(), []))
    monkeypatch.setenv("LG_OFFLINE", "1")
    r = TestClient(app).get("/coupled?at=2026-11-08T00:00:00Z")
    assert r.status_code == 200
    body = CoupledResponse.model_validate(r.json())
    assert {z.zone for z in body.zones} == {"SE1", "DK1"}


def test_fixture_is_a_real_full_day():
    f = CoupledResponse.model_validate(fixture("coupled"))
    assert [z.zone for z in f.zones] == list(coupled.ZONES)
    assert all(z.day_min <= z.day_avg <= z.day_max for z in f.zones)
