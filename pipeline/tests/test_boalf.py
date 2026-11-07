import json
from pathlib import Path

import httpx
import pandas as pd
import pytest

from pipeline import cache, ingest, schemas
from pipeline.ingest import boalf

FX = Path(__file__).parent / "fixtures" / "boalf"
START = pd.Timestamp("2026-10-26 14:00", tz="UTC")
END = pd.Timestamp("2026-10-26 16:00", tz="UTC")


def load(name):
    return json.loads((FX / name).read_text())


@pytest.fixture
def no_offline(monkeypatch):
    monkeypatch.delenv("LG_OFFLINE", raising=False)


def client(calls=None):
    def handler(req: httpx.Request):
        if calls is not None:
            calls.append(req)
        p = req.url.path
        if p.endswith("bmunits/all"):
            return httpx.Response(200, json=load("bmunits.json"))
        period = int(p.rsplit("/", 1)[1])
        if period in (29, 30) and p.endswith(f"2026-10-26/{period}"):
            return httpx.Response(200, json=load(f"boav_{period}.json"))
        return httpx.Response(404 if period > 48 else 200, json={"data": []})

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_wind_units_join_reference_and_hand_map(no_offline):
    u = boalf.wind_units(client())
    assert set(u.columns) == set(boalf.UNIT_COLUMNS)
    assert not u["bm_unit"].isin([x["nationalGridBmUnit"] for x in load("bmunits.json") if x["fuelType"] != "WIND"]).any()
    moray = u[u.bm_unit == "MOWWO-1"].iloc[0]
    assert moray["mapped"] and moray["region"] == "P" and moray["capacity_mw"] == 215
    assert not u[u.bm_unit == "AKGLW-3"].iloc[0]["mapped"]


def test_bids_are_hourly_positive_wind_only(no_offline):
    c = client()
    units = boalf.wind_units(c)
    bids = boalf.fetch_bids(START, END, c, units)
    assert list(bids.columns) == boalf.BID_COLUMNS
    assert (bids["mwh"] > 0).all()
    assert set(bids["ts"]) == {START}
    assert set(bids["bm_unit"]) <= set(units["bm_unit"])
    raw = [r for p in (29, 30) for r in load(f"boav_{p}.json")["data"] if r["nationalGridBmUnit"] == "MOWWO-1"]
    assert bids[bids.bm_unit == "MOWWO-1"]["mwh"].iloc[0] == pytest.approx(-sum(r["totalVolumeAccepted"] for r in raw))
    assert not bids.duplicated(["ts", "bm_unit"]).any()


def test_fetch_total_is_zero_filled(no_offline):
    df = boalf.fetch(START, END, client=client())
    schemas.validate(df, "actuals/elexon_boalf_mwh")
    assert list(df["ts"]) == list(pd.date_range(START, END, freq="h"))
    assert df.iloc[0]["value"] > 0 and (df.iloc[1:]["value"] == 0).all()
    assert set(df["series"]) == {"boalf_mwh"} and set(df["unit"]) == {"MWh"}


def test_requests_every_period_of_each_day(no_offline):
    calls = []
    boalf.fetch(START, START + pd.Timedelta(days=1), client=client(calls))
    periods = [c for c in calls if "volumes" in c.url.path]
    assert len(periods) == 2 * len(boalf.PERIODS)
    assert {c.url.path.split("/")[-2] for c in periods} == {"2026-10-26", "2026-10-27"}


def test_offline_refuses_network(monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    with pytest.raises(RuntimeError):
        boalf.fetch(START, END, client=client())
    with pytest.raises(RuntimeError):
        boalf.run(START, END, client=client())


def test_run_writes_three_files_and_merges(tmp_path, monkeypatch, no_offline):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    assert boalf.run(START, END, client=client()) == ["boalf/wind_units", "boalf/wind_bids", "actuals/elexon_boalf_mwh"]
    first = cache.read("boalf/wind_bids")
    boalf.run(START, END, client=client())
    assert len(cache.read("boalf/wind_bids")) == len(first)
    tot = cache.read("actuals/elexon_boalf_mwh")
    assert len(tot) == 3
    assert tot["value"].iloc[0] == pytest.approx(first["mwh"].sum())
    assert cache.read("boalf/wind_units")["mapped"].any()


def test_autodiscovered():
    assert "boalf" in ingest.sources()
