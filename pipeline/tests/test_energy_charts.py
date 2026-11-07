import json
from pathlib import Path

import httpx
import pandas as pd
import pytest

from pipeline import cache, schemas
from pipeline.ingest import energy_charts as ec

FIX = Path(__file__).parent / "fixtures" / "energy_charts"


def load(name):
    return json.loads((FIX / name).read_text())


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.setattr(cache, "FIXTURES", tmp_path / "none")
    monkeypatch.setattr(ec, "_sleep", lambda s: None)
    monkeypatch.setattr(ec, "MIN_INTERVAL_S", 0)
    monkeypatch.delenv("LG_OFFLINE", raising=False)


def test_price_is_hourly_mean_of_quarter_hours():
    raw = load("price_DE-LU.json")
    df = ec.parse_price(raw, "DE-LU")
    assert len(df) == 12 and set(df.series) == {"price_da"} and set(df.unit) == {"EUR/MWh"}
    assert df.value.iloc[0] == pytest.approx(sum(raw["price"][:4]) / 4)
    assert str(df.ts.dt.tz) == "UTC" and df.ts.iloc[0] == pd.Timestamp("2026-10-31T23:00Z")
    schemas.validate(df, "actuals")


def test_public_power_series_names_and_load():
    df = ec.parse_public_power(load("public_power_fr.json"), "FR")
    series = set(df.series)
    assert {"load", "gen_nuclear", "gen_wind_onshore", "gen_fossil_gas", "flow_net_FR"} <= series
    assert not any("share" in s or "residual" in s for s in series)
    nuclear = df[df.series == "gen_nuclear"].value
    assert nuclear.between(30000, 70000).all()
    schemas.validate(df, "actuals")


def test_cbpf_flows_are_from_to_in_mw():
    raw = load("cbpf_no.json")
    df = ec.parse_cbpf(raw, "NO2")
    assert {"flow_NO2_GB", "flow_NO2_DE-LU", "flow_NO2_NL"} <= set(df.series)
    assert not any(s.endswith("_sum") or "sum" in s for s in df.series)
    gb = next(s for s in raw["countries"] if s["name"] == "United Kingdom")
    first = df[df.series == "flow_NO2_GB"].value.iloc[0]
    assert first == pytest.approx(-sum(gb["data"][:4]) / 4 * 1000)
    schemas.validate(df, "actuals")


def handler_for(calls, fail_first=False):
    state = {"failed": not fail_first}

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if not state["failed"]:
            state["failed"] = True
            return httpx.Response(429, headers={"Retry-After": "7"})
        name = {"/price": "price_DE-LU.json", "/public_power": "public_power_fr.json", "/cbpf": "cbpf_no.json"}[request.url.path]
        return httpx.Response(200, json=load(name))

    return handler


def test_fetch_caches_and_validates():
    calls = []
    client = httpx.Client(transport=httpx.MockTransport(handler_for(calls)))
    start, end = pd.Timestamp("2026-10-31T23:00Z"), pd.Timestamp("2026-11-01T11:00Z")
    df = ec.fetch(start, end, zones=["FR"], client=client)
    assert calls == ["/price", "/public_power", "/cbpf"]
    assert set(df.zone) == {"FR"} and len(df)
    for group in ("price_da", "generation", "load", "flows"):
        assert cache.exists(f"actuals/energy_charts_{group}")
    again = ec.fetch(start, end, zones=["FR"], client=client)
    stored = pd.read_parquet(cache.path("actuals/energy_charts_load"))
    assert not stored.duplicated(["ts", "zone", "series"]).any()
    assert len(again) == len(df)


def test_429_waits_retry_after(monkeypatch):
    waits, calls = [], []
    monkeypatch.setattr(ec, "_sleep", waits.append)
    client = httpx.Client(transport=httpx.MockTransport(handler_for(calls, fail_first=True)))
    ec.fetch(pd.Timestamp("2026-10-31T23:00Z"), pd.Timestamp("2026-11-01T11:00Z"), zones=["FR"], client=client)
    assert 7.0 in waits and calls[:2] == ["/price", "/price"]


def test_offline_makes_no_network_calls(monkeypatch):
    start, end = pd.Timestamp("2026-10-31T23:00Z"), pd.Timestamp("2026-11-01T11:00Z")
    ec.fetch(start, end, zones=["FR"], client=httpx.Client(transport=httpx.MockTransport(handler_for([]))))
    monkeypatch.setenv("LG_OFFLINE", "1")

    def boom(request):
        raise AssertionError("network used while offline")

    df = ec.fetch(start, end, client=httpx.Client(transport=httpx.MockTransport(boom)))
    assert len(df) and set(df.zone) == {"FR"}


def test_offline_with_empty_cache_returns_empty(monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    df = ec.fetch(pd.Timestamp("2026-11-01T00:00Z"), pd.Timestamp("2026-11-02T00:00Z"))
    assert df.empty and list(df.columns) == ["ts", "zone", "series", "value", "unit"]


def test_interval_defaults_to_30_seconds_and_env_overrides(monkeypatch):
    monkeypatch.delenv("LG_EC_MIN_INTERVAL", raising=False)
    assert ec._interval_from_env() == 30.0
    monkeypatch.setenv("LG_EC_MIN_INTERVAL", "5")
    assert ec._interval_from_env() == 5.0


def test_throttle_is_per_endpoint(monkeypatch):
    waits = []
    monkeypatch.setattr(ec, "_sleep", waits.append)
    monkeypatch.setattr(ec, "MIN_INTERVAL_S", 30.0)
    monkeypatch.setattr(ec, "_last_call", {})
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={})))
    ec._get(client, "price", {})
    ec._get(client, "cbpf", {})
    assert waits == []
    ec._get(client, "price", {})
    assert len(waits) == 1 and 29 < waits[0] <= 30
