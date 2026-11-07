import json
from pathlib import Path

import httpx
import pandas as pd
import pytest

from engine.ghost_wind import boalf as gw
from pipeline.ingest import boalf as ingest

FX = Path(__file__).resolve().parents[2] / "pipeline" / "tests" / "fixtures" / "boalf"
START = pd.Timestamp("2026-10-26 13:00", tz="UTC")
END = pd.Timestamp("2026-10-26 16:00", tz="UTC")


def _load(name):
    return json.loads((FX / name).read_text())


@pytest.fixture(scope="module")
def bids():
    def handler(req: httpx.Request):
        p = req.url.path
        if p.endswith("bmunits/all"):
            return httpx.Response(200, json=_load("bmunits.json"))
        period = int(p.rsplit("/", 1)[1])
        if period in (29, 30) and p.endswith(f"2026-10-26/{period}"):
            return httpx.Response(200, json=_load(f"boav_{period}.json"))
        return httpx.Response(200, json={"data": []})

    with httpx.Client(transport=httpx.MockTransport(handler)) as c:
        units = ingest.wind_units(c)
        return ingest.fetch_bids(START, END, c, units)


def test_regions_hourly_and_zero_filled(bids):
    out = gw.by_region(bids, START, END)
    assert list(out.columns) == gw.COLUMNS
    regions = gw.mapped_regions()
    assert set(out["region"]) == set(regions)
    assert len(out) == 4 * len(regions)
    assert not out.duplicated(["ts", "region"]).any()
    assert (out["mwh"] >= 0).all()
    assert out.loc[out["ts"] != pd.Timestamp("2026-10-26 14:00", tz="UTC"), "mwh"].eq(0).all()
    assert set(out["method"]) == {"boalf"} and set(out["kind"]) == {"estimated"}


def test_only_mapped_units_count(bids):
    out = gw.by_region(bids, START, END)
    mapped = bids[bids["region"].isin(gw.mapped_regions())]
    assert out["mwh"].sum() == pytest.approx(mapped["mwh"].sum())
    assert bids["region"].isna().any(), "fixture should include unmapped wind units"
    north = out[(out["region"] == "P") & (out["ts"] == pd.Timestamp("2026-10-26 14:00", tz="UTC"))].iloc[0]
    assert north["region_name"] == "North Scotland"
    assert north["mwh"] == pytest.approx(bids.loc[bids["region"] == "P", "mwh"].sum())
    assert north["units"] == bids.loc[bids["region"] == "P", "bm_unit"].nunique()


def test_coverage_is_honest(bids):
    c = gw.coverage(bids)
    assert c["total_mwh"] == pytest.approx(bids["mwh"].sum())
    assert c["mapped_mwh"] + c["unmapped_mwh"] == pytest.approx(c["total_mwh"])
    assert 0 < c["mapped_share"] < 1
    assert c["scotland_mwh"] <= c["mapped_mwh"]


def test_estimate_without_cache_is_empty(monkeypatch):
    monkeypatch.setattr(gw, "load_bids", lambda: None)
    out = gw.estimate(START, END)
    assert out.empty and list(out.columns) == gw.COLUMNS


def test_estimate_accepts_bids_frame(bids):
    pd.testing.assert_frame_equal(gw.estimate(START, END, bids=bids), gw.by_region(bids, START, END))
