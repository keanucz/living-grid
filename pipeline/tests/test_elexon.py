import json
from pathlib import Path

import httpx
import pandas as pd
import pytest

from pipeline import cache, ingest, schemas
from pipeline.ingest import elexon

FX = Path(__file__).parent / "fixtures" / "elexon"
START, END = pd.Timestamp("2026-11-05", tz="UTC"), pd.Timestamp("2026-11-05 05:00", tz="UTC")


@pytest.fixture
def no_offline(monkeypatch):
    monkeypatch.delenv("LG_OFFLINE", raising=False)


def client(calls):
    def handler(req: httpx.Request):
        calls.append(req)
        p = req.url.path
        name = "system_prices" if "system-prices" in p else "demand" if "demand" in p else "fuelhh"
        return httpx.Response(200, json=json.loads((FX / f"{name}.json").read_text()))

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_fetch_recorded(no_offline):
    df = elexon.fetch(START, END, client=client([]))
    schemas.validate(df, "actuals")
    series = set(df["series"])
    assert {"system_price", "load", "gen_wind", "gen_gas", "flow_GB_FR", "flow_GB_NO2", "flow_GB_NL", "flow_GB_BE"} <= series
    assert (df["zone"] == "GB").all()
    assert df["ts"].min() == START and df["ts"].max() == END
    assert not df.duplicated(["ts", "series"]).any()


def test_hourly_mean_and_flow_sign(no_offline):
    df = elexon.fetch(START, END, client=client([]))
    raw = json.loads((FX / "fuelhh.json").read_text())
    nsl = [r["generation"] for r in raw if r["fuelType"] == "INTNSL" and r["startTime"].startswith("2026-11-05T00:")]
    got = df[(df.series == "flow_GB_NO2") & (df.ts == START)]["value"].iloc[0]
    assert got == pytest.approx(-sum(nsl) / len(nsl))
    sp = json.loads((FX / "system_prices.json").read_text())["data"]
    first = [r["systemSellPrice"] for r in sp if r["startTime"].startswith("2026-11-05T00:")]
    assert df[(df.series == "system_price") & (df.ts == START)]["value"].iloc[0] == pytest.approx(sum(first) / 2)


def test_gas_sums_ccgt_and_ocgt(no_offline):
    df = elexon.fetch(START, END, client=client([]))
    raw = json.loads((FX / "fuelhh.json").read_text())
    h = [r["generation"] for r in raw if r["fuelType"] in ("CCGT", "OCGT") and r["startTime"] == "2026-11-05T00:00:00Z"]
    h2 = [r["generation"] for r in raw if r["fuelType"] in ("CCGT", "OCGT") and r["startTime"] == "2026-11-05T00:30:00Z"]
    assert df[(df.series == "gen_gas") & (df.ts == START)]["value"].iloc[0] == pytest.approx((sum(h) + sum(h2)) / 2)


def test_long_ranges_are_chunked_to_seven_days(no_offline):
    calls = []
    elexon.fetch(START, START + pd.Timedelta(days=15), client=client(calls))
    fuelhh = [c for c in calls if "FUELHH" in c.url.path]
    assert len(fuelhh) == 3
    for c in fuelhh:
        a, b = (pd.Timestamp(c.url.params[k]) for k in ("settlementDateFrom", "settlementDateTo"))
        assert (b - a).days <= 6
    assert len([c for c in calls if "system-prices" in c.url.path]) == 16


def test_offline_refuses_network(monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    with pytest.raises(RuntimeError):
        elexon.fetch(START, END, client=client([]))


def test_write_merges_and_dedupes(tmp_path, monkeypatch, no_offline):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    df = elexon.fetch(START, END, client=client([]))
    names = elexon.write(df)
    assert "actuals/elexon_system_price" in names
    elexon.write(df.assign(value=df["value"] + 1))
    out = cache.read("actuals/elexon_system_price")
    assert len(out) == (df.series == "system_price").sum()
    assert out["value"].iloc[0] == pytest.approx(df[df.series == "system_price"]["value"].iloc[0] + 1)


def test_autodiscovered():
    assert "elexon" in ingest.sources()
