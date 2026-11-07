import json
from pathlib import Path

import httpx
import pandas as pd
import pytest

from pipeline import cache, ingest, schemas, static
from pipeline.ingest import carbon_intensity as ci

FX = Path(__file__).parent / "fixtures" / "carbon_intensity"
START, END = "2026-10-26 00:00", "2026-10-26 02:30"


def load(name):
    return json.loads((FX / name).read_text())


@pytest.fixture
def no_offline(monkeypatch):
    monkeypatch.delenv("LG_OFFLINE", raising=False)


def client(calls=None):
    def handler(req: httpx.Request):
        if calls is not None:
            calls.append(req)
        return httpx.Response(200, json=load("regional.json" if "/regional/" in req.url.path else "national.json"))

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_regional_covers_all_14_regions_hourly(no_offline):
    df = ci.fetch_regional(START, END, client())
    assert list(df.columns) == ci.COLUMNS
    assert set(df["region"]) == set(static.gb_region_keys()["region"])
    assert df["ts"].min() == pd.Timestamp(START, tz="UTC") and df["ts"].max() == pd.Timestamp("2026-10-26 02:00", tz="UTC")
    assert not df.duplicated(["ts", "region"]).any()
    assert (df["intensity_gco2_kwh"] >= 0).all()


def test_regional_hour_is_mean_of_half_hours_and_ids_map_to_letters(no_offline):
    df = ci.fetch_regional(START, END, client())
    slots = [s for s in load("regional.json")["data"] if s["from"] in ("2026-10-26T00:00Z", "2026-10-26T00:30Z")]
    vals = [r["intensity"]["forecast"] for s in slots for r in s["regions"] if r["regionid"] == 1]
    got = df[(df.region == "P") & (df.ts == pd.Timestamp(START, tz="UTC"))].iloc[0]
    assert got["intensity_gco2_kwh"] == pytest.approx(sum(vals) / len(vals))
    assert got["region_id"] == 1


def test_national_is_a_valid_actuals_frame(no_offline):
    df = ci.fetch(START, END, client=client())
    schemas.validate(df, "actuals/carbonintensity_ci_gco2_kwh")
    assert set(df["series"]) == {"ci_gco2_kwh"} and set(df["zone"]) == {"GB"}
    first = [s["intensity"] for s in load("national.json")["data"] if s["from"] in ("2026-10-26T00:00Z", "2026-10-26T00:30Z")]
    want = sum(i["actual"] if i["actual"] is not None else i["forecast"] for i in first) / len(first)
    assert df.iloc[0]["value"] == pytest.approx(want)


def test_ranges_are_chunked_to_14_days(no_offline):
    calls = []
    ci.fetch_regional("2026-09-01", "2026-10-01", client(calls))
    assert len(calls) == 3
    for c in calls:
        _, _, a, b = c.url.path.strip("/").split("/")
        assert (pd.Timestamp(b) - pd.Timestamp(a)) < pd.Timedelta(days=14)


def test_offline_refuses_network(monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    with pytest.raises(RuntimeError):
        ci.fetch(START, END, client=client())
    with pytest.raises(RuntimeError):
        ci.run(START, END, client=client())


def test_run_writes_and_merges(tmp_path, monkeypatch, no_offline):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    assert ci.run(START, END, client=client()) == ["carbon_intensity/regional", "actuals/carbonintensity_ci_gco2_kwh"]
    n = len(cache.read("carbon_intensity/regional"))
    ci.run(START, END, client=client())
    assert len(cache.read("carbon_intensity/regional")) == n
    assert len(cache.read("actuals/carbonintensity_ci_gco2_kwh")) == 3


def test_autodiscovered():
    assert "carbon_intensity" in ingest.sources()
