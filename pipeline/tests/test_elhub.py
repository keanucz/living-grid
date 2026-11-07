import json
from pathlib import Path

import httpx
import pandas as pd
import pytest

from pipeline import cache, schemas
from pipeline.ingest import elhub

FX = Path(__file__).parent / "fixtures" / "elhub"
START = pd.Timestamp("2026-11-03T23:00Z")
END = pd.Timestamp("2026-11-04T05:00Z")


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.delenv("LG_OFFLINE", raising=False)


def client(handler=None, seen=None):
    def h(request: httpx.Request):
        if seen is not None:
            seen.append(dict(request.url.params))
        if handler:
            r = handler(request)
            if r is not None:
                return r
        name = "consumption" if request.url.params["dataset"].startswith("CONSUMPTION") else "production"
        return httpx.Response(200, json=json.loads((FX / f"{name}.json").read_text()))

    return httpx.Client(transport=httpx.MockTransport(h))


def test_load_is_the_sum_of_the_groups_in_mw_and_schema_valid():
    load, gen = elhub.fetch(START, END, client(), pause=0)
    assert len(load) == 6 and set(load["zone"]) == {"NO2"} and set(load["series"]) == {"load"} and set(load["unit"]) == {"MW"}
    raw = json.loads((FX / "consumption.json").read_text())["data"][0]["attributes"]["consumptionPerGroupMbaHour"]
    first = sum(r["quantityKwh"] for r in raw if r["startTime"] == "2026-11-04T00:00:00+01:00") / 1000
    assert load.iloc[0]["ts"] == START and load.iloc[0]["value"] == pytest.approx(first)
    for df, name in ((load, "actuals/elhub_load"), (gen, "actuals/elhub_generation")):
        schemas.validate(df, name)
    assert set(gen["series"]) == {"gen_hydro", "gen_other", "gen_solar", "gen_thermal", "gen_wind"} and len(gen) == 30
    raw_h = json.loads((FX / "production.json").read_text())["data"][0]["attributes"]["productionPerGroupMbaHour"]
    want = next(r["quantityKwh"] for r in raw_h if r["productionGroup"] == "hydro" and r["startTime"] == "2026-11-04T00:00:00+01:00") / 1000
    assert gen[(gen.series == "gen_hydro") & (gen.ts == START)]["value"].iloc[0] == pytest.approx(want)


def test_an_hour_with_a_missing_group_is_dropped_not_understated():
    rows = json.loads((FX / "consumption.json").read_text())["data"][0]["attributes"]["consumptionPerGroupMbaHour"]
    rows = [r for r in rows if not (r["consumptionGroup"] == "primary" and r["startTime"] == "2026-11-04T02:00:00+01:00")]
    load = elhub.to_load(rows)
    assert len(load) == 5 and pd.Timestamp("2026-11-04T01:00Z") not in set(load["ts"])


def test_timestamps_are_utc_across_the_clock_change():
    summer = elhub.to_generation([{"startTime": "2026-10-25T01:00:00+02:00", "productionGroup": "wind", "quantityKwh": 1000.0}])
    winter = elhub.to_generation([{"startTime": "2026-10-25T02:00:00+01:00", "productionGroup": "wind", "quantityKwh": 1000.0}])
    assert summer.iloc[0]["ts"] == pd.Timestamp("2026-10-24T23:00Z") and winter.iloc[0]["ts"] == pd.Timestamp("2026-10-25T01:00Z")


def test_requests_use_oslo_time_and_never_span_more_than_a_month():
    seen = []
    elhub.fetch("2026-09-01", "2026-11-05", client(seen=seen), pause=0)
    assert all(p["startDate"].endswith(("+01:00", "+02:00")) for p in seen)
    assert {p["dataset"] for p in seen} == {"CONSUMPTION_PER_GROUP_MBA_HOUR", "PRODUCTION_PER_GROUP_MBA_HOUR"}
    starts = [pd.Timestamp(p["startDate"]) for p in seen if p["dataset"].startswith("CONS")]
    ends = [pd.Timestamp(p["endDate"]) for p in seen if p["dataset"].startswith("CONS")]
    assert len(starts) == 3 and all(e - s <= pd.Timedelta(days=28, hours=1) for s, e in zip(starts, ends))


def test_a_rate_limit_is_waited_out(monkeypatch):
    monkeypatch.setattr(elhub.time, "sleep", lambda s: None)
    hits = []

    def h(request):
        hits.append(1)
        return httpx.Response(429, headers={"Retry-After": "1"}) if len(hits) == 1 else None

    load, _ = elhub.fetch(START, END, client(h), pause=0)
    assert len(load) == 6 and len(hits) == 3


def test_write_merges_and_is_idempotent():
    load, gen = elhub.fetch(START, END, client(), pause=0)
    assert elhub.write(load, gen) == [elhub.LOAD_NAME, elhub.GEN_NAME]
    elhub.write(load, gen)
    got = cache.read(elhub.LOAD_NAME)
    assert len(got) == 6 and not got.duplicated(["ts", "zone", "series"]).any()
    assert elhub.write(pd.DataFrame(columns=elhub.COLUMNS), pd.DataFrame(columns=elhub.COLUMNS)) == []


def test_hours_not_yet_published_are_just_absent():
    empty = {"data": [{"id": "NO2", "attributes": {"consumptionPerGroupMbaHour": [], "productionPerGroupMbaHour": []}}]}
    load, gen = elhub.fetch(START, END, client(lambda r: httpx.Response(200, json=empty)), pause=0)
    assert load.empty and gen.empty


def test_the_api_total_row_is_not_a_series():
    rows = [{"startTime": "2026-11-04T00:00:00+01:00", "productionGroup": g, "quantityKwh": 1000.0} for g in ("wind", "*")]
    assert list(elhub.to_generation(rows)["series"]) == ["gen_wind"]
    cons = [{"startTime": "2026-11-04T00:00:00+01:00", "consumptionGroup": g, "quantityKwh": 1000.0} for g in ("cabin", "household", "primary", "secondary", "tertiary", "*")]
    assert elhub.to_load(cons).iloc[0]["value"] == pytest.approx(5.0)
