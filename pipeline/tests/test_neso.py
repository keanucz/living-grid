import json
from pathlib import Path

import httpx
import pandas as pd
import pytest

from pipeline import cache, ingest, schemas
from pipeline.ingest import neso

FX = Path(__file__).parent / "fixtures" / "neso"
NOW = pd.Timestamp("2026-11-07 13:00", tz="UTC")


def load(name):
    return json.loads((FX / name).read_text())


@pytest.fixture
def no_offline(monkeypatch):
    monkeypatch.delenv("LG_OFFLINE", raising=False)


def client(calls=None):
    def handler(req: httpx.Request):
        if calls is not None:
            calls.append(req)
        if req.url.path.endswith("package_show"):
            return httpx.Response(200, json=load("package_show.json"))
        name = "boundary_flows.json" if "Constraint Group" in req.url.params["sql"] else "constraint_costs.json"
        return httpx.Response(200, json=load(name))

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_constraint_costs_recorded(no_offline):
    df = neso.fetch_costs("2026-10-24", "2026-10-29", client(), now=NOW)
    storm = df[df.date == "2026-10-26"].iloc[0]
    assert storm["thermal_cost_gbp"] == 36125099
    assert storm["total_cost_gbp"] == pytest.approx(36125099 + 405770)
    assert storm["ts"] == pd.Timestamp("2026-10-26", tz="UTC")
    assert df[df.date == "2026-10-24"].iloc[0]["ts"] == pd.Timestamp("2026-10-23 23:00", tz="UTC")
    assert list(df["date"]) == sorted(df["date"])


def test_lag_is_recorded(no_offline):
    df = neso.fetch_costs("2026-10-24", "2026-10-29", client(), now=NOW)
    assert (df["fetched_at"] == NOW).all()
    assert neso.latest_lag_days(df) == pytest.approx(9.54, abs=0.01)


def test_only_overlapping_financial_years_are_queried(no_offline):
    calls = []
    neso.fetch_costs("2026-10-24", "2026-10-29", client(calls), now=NOW)
    assert len([c for c in calls if "sql" in c.url.params]) == 1
    calls.clear()
    neso.fetch_costs("2026-02-01", "2026-10-29", client(calls), now=NOW)
    assert len([c for c in calls if "sql" in c.url.params]) == 2


def test_fetch_is_a_valid_actuals_frame(no_offline):
    df = neso.fetch("2026-10-24", "2026-10-29", client())
    schemas.validate(df, "actuals/neso_constraint_cost_gbp")
    assert set(df["series"]) == {"constraint_cost_gbp"} and set(df["zone"]) == {"GB"}


def test_boundaries_across_clock_change(no_offline):
    df = neso.fetch_boundaries("2026-10-25", "2026-10-26 03:00", client(), now=NOW)
    assert set(df["boundary"]) == {"SCOTEX", "SSEN-S", "SSE-SP", "SSHARN"}
    sc = df[df.boundary == "SCOTEX"].set_index("ts")
    hours = pd.date_range("2026-10-25 00:00", "2026-10-25 03:00", freq="h", tz="UTC").append(
        pd.date_range("2026-10-26 00:00", "2026-10-26 03:00", freq="h", tz="UTC")
    )
    assert list(sc.index) == list(hours)
    assert sc.loc["2026-10-25 00:00", "flow_mw"] == pytest.approx((4807 + 4847) / 2)
    assert sc.loc["2026-10-25 01:00", "flow_mw"] == pytest.approx((6473 + 9515) / 2)
    assert sc.loc["2026-10-25 01:00", "limit_mw"] == 4950
    assert sc.loc["2026-10-25 00:00", "utilisation"] == pytest.approx(sc.loc["2026-10-25 00:00", "flow_mw"] / 4950)


def test_offline_refuses_network(monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    with pytest.raises(RuntimeError):
        neso.fetch("2026-10-24", "2026-10-29", client())
    with pytest.raises(RuntimeError):
        neso.run("2026-10-24", "2026-10-29", client())


def test_run_writes_and_merges(tmp_path, monkeypatch, no_offline):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    got = neso.run("2026-10-24", "2026-10-29", client())
    assert got == ["neso/constraint_costs", "actuals/neso_constraint_cost_gbp", "neso/boundary_flows"]
    neso.run("2026-10-24", "2026-10-29", client())
    assert len(cache.read("neso/constraint_costs")) == 4
    assert len(cache.read("actuals/neso_constraint_cost_gbp")) == 4
    assert not cache.read("neso/boundary_flows").duplicated(["ts", "boundary"]).any()


def test_autodiscovered():
    assert "neso" in ingest.sources()
