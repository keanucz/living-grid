import json
from pathlib import Path

import httpx
import pandas as pd
import pytest

from pipeline import cache, ingest, static
from pipeline.ingest import octopus

FX = Path(__file__).parent / "fixtures" / "octopus"
START, END = "2026-10-26 00:00", "2026-10-26 02:30"
NOW = pd.Timestamp("2026-11-07 13:00", tz="UTC")


def load(name):
    return json.loads((FX / name).read_text())


@pytest.fixture
def no_offline(monkeypatch):
    monkeypatch.delenv("LG_OFFLINE", raising=False)


def client(calls=None, products=None):
    rates = load("rates.json")

    def handler(req: httpx.Request):
        if calls is not None:
            calls.append(req)
        if req.url.path.rstrip("/").endswith("/products"):
            return httpx.Response(200, json=products or load("products.json"))
        tariff = req.url.path.split("electricity-tariffs/")[1].split("/")[0]
        return httpx.Response(200, json=rates[tariff])

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_current_product_is_newest_agile_import(no_offline):
    assert octopus.current_product(client()) == "AGILE-24-10-01"
    mixed = {
        "results": [
            {"code": "AGILE-OUTGOING-19-05-13", "available_from": "2030-01-01T00:00:00Z"},
            {"code": "AGILE-24-10-01", "available_from": "2024-10-01T00:00:00+01:00"},
            {"code": "AGILE-26-01-01", "available_from": "2026-01-01T00:00:00Z"},
            {"code": "GO-VAR-22-10-14", "available_from": "2027-01-01T00:00:00Z"},
        ],
        "next": None,
    }
    assert octopus.current_product(client(products=mixed)) == "AGILE-26-01-01"


def test_rates_for_all_14_regions_half_hourly(no_offline):
    df = octopus.fetch_rates(START, END, client(), now=NOW)
    assert list(df.columns) == octopus.COLUMNS
    assert set(df["region"]) == set(static.gb_region_keys()["region"])
    assert (df.groupby("region").size() == 6).all()
    assert df["ts"].min() == pd.Timestamp(START, tz="UTC") and df["ts"].max() == pd.Timestamp("2026-10-26 02:30", tz="UTC")
    assert (df["fetched_at"] == NOW).all()
    raw = {r["valid_from"]: r["value_inc_vat"] for r in load("rates.json")["E-1R-AGILE-24-10-01-C"]["results"]}
    got = df[(df.region == "C") & (df.ts == pd.Timestamp("2026-10-26 01:00", tz="UTC"))]["p_kwh"].iloc[0]
    assert got == raw["2026-10-26T01:00:00Z"]


def test_one_tariff_request_per_region_with_product_code(no_offline):
    calls = []
    octopus.fetch_rates(START, END, client(calls), now=NOW)
    tariff = [c for c in calls if "standard-unit-rates" in c.url.path]
    assert len(tariff) == 14
    assert all("E-1R-AGILE-24-10-01-" in c.url.path for c in tariff)


def test_unpublished_future_day_returns_fewer_rows(no_offline):
    empty = httpx.Client(
        transport=httpx.MockTransport(
            lambda r: httpx.Response(200, json={"results": [], "next": None})
            if "standard-unit-rates" in r.url.path
            else httpx.Response(200, json=load("products.json"))
        )
    )
    df = octopus.fetch_rates("2026-11-09", "2026-11-09 23:30", empty, now=NOW)
    assert df.empty and list(df.columns) == octopus.COLUMNS


def test_offline_refuses_network(monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    with pytest.raises(RuntimeError):
        octopus.fetch(START, END, client=client())


def test_write_merges_and_dedupes(tmp_path, monkeypatch, no_offline):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    df = octopus.fetch_rates(START, END, client(), now=NOW)
    assert octopus.write(df) == ["octopus/agile"]
    octopus.write(df.assign(p_kwh=df["p_kwh"] + 1))
    out = cache.read("octopus/agile")
    assert len(out) == len(df)
    assert out["p_kwh"].sum() == pytest.approx(df["p_kwh"].sum() + len(df))
    assert octopus.write(df.iloc[0:0]) == []


def test_autodiscovered():
    assert "octopus" in ingest.sources()
