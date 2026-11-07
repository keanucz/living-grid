import json
from pathlib import Path

import httpx
import pandas as pd
import pytest

from pipeline import cache, ingest, schemas
from pipeline.ingest import nordpool

FX = Path(__file__).parent / "fixtures" / "nordpool"
START = pd.Timestamp("2026-11-05 23:00", tz="UTC")
END = pd.Timestamp("2026-11-06 06:00", tz="UTC")


@pytest.fixture
def no_offline(monkeypatch):
    monkeypatch.delenv("LG_OFFLINE", raising=False)


def client(calls=None, published=("2026-11-06",)):
    def handler(req: httpx.Request):
        if calls is not None:
            calls.append(req)
        if req.url.params["date"] not in published:
            return httpx.Response(204)
        name = "n2ex" if req.url.params["market"] == "N2EX_DayAhead" else "dayahead"
        return httpx.Response(200, json=json.loads((FX / f"{name}.json").read_text()))

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_fetch_recorded(no_offline):
    df = nordpool.fetch(START, END, client=client())
    schemas.validate(df, "actuals")
    assert set(df["zone"]) == {"GB", "FR", "DE-LU", "NL", "BE", "NO2"}
    assert (df["series"] == "price_da").all()
    assert set(df[df.zone == "GB"]["unit"]) == {"GBP/MWh"}
    assert set(df[df.zone == "FR"]["unit"]) == {"EUR/MWh"}
    assert df["ts"].min() == START
    assert not df.duplicated(["ts", "zone"]).any()


def test_quarter_hours_are_averaged_and_ger_is_de_lu(no_offline):
    df = nordpool.fetch(START, END, client=client())
    raw = json.loads((FX / "dayahead.json").read_text())["multiAreaEntries"][:4]
    want = sum(e["entryPerArea"]["GER"] for e in raw) / 4
    got = df[(df.zone == "DE-LU") & (df.ts == START)]["value"].iloc[0]
    assert got == pytest.approx(want)
    gb = json.loads((FX / "n2ex.json").read_text())["multiAreaEntries"][0]["entryPerArea"]["UK"]
    assert df[(df.zone == "GB") & (df.ts == START)]["value"].iloc[0] == pytest.approx(gb)


def test_unpublished_days_are_skipped(no_offline):
    df = nordpool.fetch(START, END, client=client(published=()))
    assert df.empty and list(df.columns) == schemas.ACTUALS.names


def test_requests_cover_cet_delivery_dates(no_offline):
    calls = []
    nordpool.fetch(pd.Timestamp("2026-11-05", tz="UTC"), pd.Timestamp("2026-11-06 12:00", tz="UTC"), client=client(calls))
    assert {c.url.params["date"] for c in calls} == {"2026-11-05", "2026-11-06", "2026-11-07"}
    assert {c.url.params["market"] for c in calls} == {"DayAhead", "N2EX_DayAhead"}


def test_offline_refuses_network(monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    with pytest.raises(RuntimeError):
        nordpool.fetch(START, END, client=client())


def test_write_merges_and_dedupes(tmp_path, monkeypatch, no_offline):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    df = nordpool.fetch(START, END, client=client())
    assert nordpool.write(df) == ["actuals/nordpool_price_da"]
    nordpool.write(df.assign(value=df["value"] + 1))
    out = cache.read("actuals/nordpool_price_da")
    assert len(out) == len(df)
    assert out["value"].sum() == pytest.approx(df["value"].sum() + len(df))
    assert nordpool.write(df.iloc[0:0]) == []


def test_autodiscovered():
    assert "nordpool" in ingest.sources()
