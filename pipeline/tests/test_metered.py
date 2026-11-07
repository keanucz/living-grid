import json
from pathlib import Path

import httpx
import pandas as pd
import pytest

from pipeline import cache
from pipeline.ingest import metered

FX = Path(__file__).parent / "fixtures" / "metered"
START = pd.Timestamp("2026-10-26T14:00Z")
END = pd.Timestamp("2026-10-26T16:00Z")


def load(name):
    return json.loads((FX / name).read_text())


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.delenv("LG_OFFLINE", raising=False)


def half(unit, end, q, run="II"):
    return {"bmUnit": f"T_{unit}", "nationalGridBmUnitId": unit, "halfHourEndTime": end, "settlementRunType": run, "quantity": q}


def client(b1610=None, pn=None, calls=None):
    def handler(req: httpx.Request):
        if calls is not None:
            calls.append(req)
        p = req.url.path
        if p.endswith("bmunits/all"):
            return httpx.Response(200, json=load("bmunits.json"))
        units = req.url.params.get_list("bmUnit")
        rows = (b1610 if "B1610" in p else pn) or []
        return httpx.Response(200, json=[r for r in rows if r.get("bmUnit") in units])

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_mapped_units_keep_only_hand_mapped_wind():
    u = metered.mapped_units(client())
    assert dict(zip(u.bm_unit, u.elexon_bm_unit, strict=True)) == {"MOWWO-1": "T_MOWWO-1", "VKNGW-1": "T_VKNGW-1"}


def test_b1610_half_hours_become_hourly_utc_mwh():
    df = metered.hourly_b1610(load("b1610.json"), START, END + pd.Timedelta(hours=1))
    assert list(df.columns) == metered.COLUMNS and set(df.source) == {"B1610"} and set(df.bm_unit) == {"MOWWO-1", "VKNGW-1"}
    raw = pd.DataFrame(load("b1610.json"))
    for unit in ("MOWWO-1", "VKNGW-1"):
        r = raw[raw.nationalGridBmUnitId == unit].set_index("halfHourEndTime")["quantity"]
        got = df[df.bm_unit == unit].set_index("ts")["mwh"]
        assert got[START] == pytest.approx(r["2026-10-26T14:30:00"] + r["2026-10-26T15:00:00"])
        assert got[START + pd.Timedelta(hours=1)] == pytest.approx(r["2026-10-26T15:30:00"] + r["2026-10-26T16:00:00"])
    assert str(df.ts.dt.tz) == "UTC"


def test_half_hour_end_time_is_utc_on_a_bst_day():
    rows = [half("VKNGW-1", "2026-10-19T23:30:00", 1.0), half("VKNGW-1", "2026-10-20T00:00:00", 2.0)]
    df = metered.hourly_b1610(rows, pd.Timestamp("2026-10-19T00:00Z"), pd.Timestamp("2026-10-21T00:00Z"))
    assert df.ts.tolist() == [pd.Timestamp("2026-10-19T23:00Z")] and df.mwh.tolist() == [3.0]


def test_incomplete_hours_are_dropped_and_negative_station_load_is_kept():
    rows = [half("VKNGW-1", "2026-10-26T00:30:00", -0.5), half("VKNGW-1", "2026-10-26T01:00:00", -0.25),
            half("VKNGW-1", "2026-10-26T01:30:00", 9.0)]
    df = metered.hourly_b1610(rows, pd.Timestamp("2026-10-26T00:00Z"), pd.Timestamp("2026-10-26T06:00Z"))
    assert df.mwh.tolist() == [-0.75] and df.ts.tolist() == [pd.Timestamp("2026-10-26T00:00Z")]


def test_most_final_settlement_run_wins():
    rows = [half("VKNGW-1", "2026-10-26T00:30:00", 1.0, "II"), half("VKNGW-1", "2026-10-26T00:30:00", 3.0, "SF"),
            half("VKNGW-1", "2026-10-26T01:00:00", 1.0, "II"), half("VKNGW-1", "2026-10-26T01:00:00", 5.0, "R1")]
    df = metered.hourly_b1610(rows, pd.Timestamp("2026-10-26T00:00Z"), pd.Timestamp("2026-10-26T06:00Z"))
    assert df.mwh.tolist() == [8.0]


def pn(unit, a, b, la, lb):
    return {"nationalGridBmUnit": unit, "bmUnit": f"T_{unit}", "timeFrom": a, "timeTo": b, "levelFrom": la, "levelTo": lb}


def test_pn_levels_are_integrated_linearly_and_partial_hours_dropped():
    rows = [pn("VKNGW-1", "2026-11-07T10:00:00Z", "2026-11-07T10:30:00Z", 0, 10),
            pn("VKNGW-1", "2026-11-07T10:30:00Z", "2026-11-07T11:00:00Z", 10, 10),
            pn("VKNGW-1", "2026-11-07T11:00:00Z", "2026-11-07T11:30:00Z", 4, 4)]
    df = metered.hourly_pn(rows, pd.Timestamp("2026-11-07T10:00Z"), pd.Timestamp("2026-11-07T13:00Z"))
    assert df.ts.tolist() == [pd.Timestamp("2026-11-07T10:00Z")]
    assert df.mwh.tolist() == [pytest.approx(7.5)] and set(df.source) == {"PN"}


def test_recorded_pn_gives_finite_planned_hours():
    df = metered.hourly_pn(load("pn.json"), pd.Timestamp("2026-11-07T10:00Z"), pd.Timestamp("2026-11-07T12:00Z"))
    assert len(df) >= 1 and df.mwh.between(-5, 130).all()


def test_fetch_prefers_metered_and_fills_the_newest_hours_from_pn():
    b = [half("VKNGW-1", "2026-11-01T00:30:00", 2.0), half("VKNGW-1", "2026-11-01T01:00:00", 2.0)]
    p = [pn("VKNGW-1", "2026-11-01T00:00:00Z", "2026-11-01T02:00:00Z", 99, 99),
         pn("VKNGW-1", "2026-11-01T02:00:00Z", "2026-11-01T03:00:00Z", 6, 6)]
    for r in b:
        r["settlementRunType"] = "II"
    df = metered.fetch(pd.Timestamp("2026-11-01T00:00Z"), pd.Timestamp("2026-11-01T03:00Z"), client(b, p))
    rows = df[df.bm_unit == "VKNGW-1"].set_index("ts")
    assert rows.loc[pd.Timestamp("2026-11-01T00:00Z"), ["mwh", "source"]].tolist() == [4.0, "B1610"]
    assert rows.loc[pd.Timestamp("2026-11-01T01:00Z"), ["mwh", "source"]].tolist() == [99.0, "PN"]
    assert len(rows) == 3
    assert rows.loc[pd.Timestamp("2026-11-01T02:00Z"), ["mwh", "source"]].tolist() == [6.0, "PN"]


def test_units_are_requested_in_batches(monkeypatch):
    monkeypatch.setattr(metered, "BATCH", 1)
    calls = []
    metered.fetch(START, END, client([], [], calls))
    b1610 = [c for c in calls if "B1610" in c.url.path]
    assert sorted(c.url.params.get_list("bmUnit")[0] for c in b1610) == ["T_MOWWO-1", "T_VKNGW-1"]


def test_offline_refuses_network(monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    with pytest.raises(RuntimeError, match="LG_OFFLINE"):
        metered.fetch(START, END)


def test_run_merges_and_metered_replaces_planned_but_never_the_reverse(monkeypatch):
    def frame(source, mwh):
        return pd.DataFrame({"ts": [START], "bm_unit": ["VKNGW-1"], "mwh": [mwh], "source": [source]})

    monkeypatch.setattr(metered, "fetch", lambda s, e: frame("PN", 1.0))
    metered.run(START, END)
    monkeypatch.setattr(metered, "fetch", lambda s, e: frame("B1610", 5.0))
    metered.run(START, END)
    monkeypatch.setattr(metered, "fetch", lambda s, e: frame("PN", 9.0))
    metered.run(START, END)
    got = pd.read_parquet(cache.path(metered.NAME))
    assert got[["mwh", "source"]].values.tolist() == [[5.0, "B1610"]]


def test_recorded_snapshot_covers_26_october_and_a_recent_day():
    df = pd.read_parquet(FX / "wind_metered.parquet")
    assert list(df.columns) == metered.COLUMNS and str(df.ts.dt.tz) == "UTC"
    storm = df[df.ts.dt.date == pd.Timestamp("2026-10-26").date()]
    assert storm.bm_unit.nunique() >= 25 and len(storm) == storm.bm_unit.nunique() * 24 and set(storm.source) == {"B1610"}
    assert {"VKNGW-1", "SGRWO-1", "MOWWO-1"} <= set(df.bm_unit)
    assert "PN" in set(df.source) and not df.duplicated(["ts", "bm_unit"]).any()
    assert storm.groupby("ts").mwh.sum().max() > 1000
