import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine import infrastructure as inf
from engine.app import app
from pipeline.ingest import neso, neso_boundaries

client = TestClient(app)
T0 = pd.Timestamp("2026-10-20 00:00", tz="UTC")


def flows():
    ts = pd.date_range(T0, periods=48, freq="h")
    rows = []
    for t in ts:
        flow = 4500.0 if t.hour in (10, 11, 12) else 2000.0
        rows.append({"ts": t, "boundary": "SCOTEX", "flow_mw": flow, "limit_mw": 3500.0, "utilisation": flow / 3500, "fetched_at": T0})
        rows.append({"ts": t, "boundary": "SSEN-S", "flow_mw": 1000.0, "limit_mw": 2000.0, "utilisation": 0.5, "fetched_at": T0})
    return pd.DataFrame(rows)


def costs():
    ts = [T0, T0 + pd.Timedelta(days=1)]
    return pd.DataFrame({"ts": ts, "thermal_cost_gbp": [4.0e6, 0.0], "thermal_volume_mwh": [-10000.0, -1000.0],
                         "total_cost_gbp": [4.0e6, 0.0]})


def ghost():
    ts = pd.date_range(T0, periods=48, freq="h")
    return pd.DataFrame({"ts": ts, "region": "P", "mwh": [600.0 if t.hour in (10, 11, 12) else 0.0 for t in ts]})


def test_boundary_table_counts_overload_only_above_limit():
    t = {r["boundary"]: r for r in inf.boundary_table(flows())}
    assert t["SCOTEX"]["hours_over_limit_share"] == pytest.approx(6 / 48)  # 3 hours a day, 2 days
    assert t["SCOTEX"]["overload_mwh"] == 6 * 1000 and t["SCOTEX"]["peak_overload_mw"] == 1000
    assert t["SSEN-S"]["overload_mwh"] == 0


def test_counterfactual_extra_capacity_removes_overload_prices_it_and_caps_wind():
    r = inf.counterfactual(flows(), costs(), ghost(), 500)
    assert r["overload_mwh"] == 6000 and r["avoided_overload_mwh"] == 6 * 500 and r["hours_still_over_limit"] == 6
    # day 1: 3 h x 500 MWh at 4e6 / 10000 = 400 GBP/MWh; day 2 has zero thermal cost
    assert r["avoided_cost_gbp"] == 3 * 500 * 400
    assert r["avoided_wind_mwh"] == 6 * 500  # below the 600 MWh/h switched off
    full = inf.counterfactual(flows(), costs(), ghost(), 2000)
    assert full["avoided_overload_mwh"] == 6000 and full["hours_still_over_limit"] == 0


def test_wind_avoided_is_capped_by_wind_switched_off():
    g = ghost().assign(mwh=lambda d: d["mwh"].where(d["mwh"] == 0, 100.0))
    assert inf.counterfactual(flows(), costs(), g, 1000)["avoided_wind_mwh"] == 6 * 100


def test_interconnector_use_sign_and_full_share():
    ts = pd.date_range(T0, periods=10, freq="h")
    a = pd.concat([pd.DataFrame({"ts": ts, "zone": "GB", "series": "flow_GB_NO2", "value": [-1400.0] * 5 + [0.0] * 5, "unit": "MW"})])
    links = pd.DataFrame({"to_zone": ["NO2"], "capacity_mw": [1400]})
    r = inf.interconnectors(a, links)[0]
    assert r["mean_import_mw"] == 700 and r["hours_full_import_share"] == 0.5 and r["capacity_mw"] == 1400


def test_build_has_sourced_context_and_flags_estimates():
    links = pd.DataFrame({"to_zone": ["NO2"], "capacity_mw": [1400]})
    a = pd.DataFrame({"ts": [T0], "zone": "GB", "series": "flow_GB_NO2", "value": [-1400.0], "unit": "MW"})
    b = inf.build(flows=flows(), costs=costs(), ghost=ghost(), actuals=a, links=links)
    assert b["kind"] == "estimated" and "upper bounds" in b["note"]
    assert all(p["source"].startswith("http") for p in b["planned_links"])
    assert {p["id"] for p in b["planned_links"]} == {"egl1", "egl2", "egl3", "egl4"}
    assert b["connections_queue"]["source"].startswith("NESO")
    assert b["etys_capability"]["B6"]["mw"] == 6700
    assert [s["extra_mw"] for s in b["counterfactual"]["scenarios"]] == [2000, 4000]


def test_route_is_404_without_ingested_flows_offline(monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    assert client.get("/infrastructure").status_code == 404
    assert client.get("/infrastructure", params={"extra_mw": 0}).status_code == 422


def test_neso_boundaries_asks_for_every_group(monkeypatch):
    seen = {}

    def fake_sql(client, sql):
        if "DISTINCT" in sql:
            return [{"g": "B6X"}, {"g": "ESTEX"}]
        seen["sql"] = sql
        return [{"Constraint Group": "ESTEX", "Date_ Time GMT_BST": "2026-10-20T00:00:00", "Flow_MW": 100, "Limit_MW": 200, "_id": 1}]

    monkeypatch.delenv("LG_OFFLINE", raising=False)
    monkeypatch.setattr(neso, "_sql", fake_sql)
    out = neso_boundaries.fetch("2026-10-19", "2026-10-21", client=object())
    assert "'B6X'" in seen["sql"] and "'ESTEX'" in seen["sql"]
    assert list(out["boundary"]) == ["ESTEX"] and out["utilisation"].iloc[0] == 0.5
    assert neso.BOUNDARIES["SCOTEX"] == "SCOTEX"  # patch undone
    assert "ESTEX" not in neso.BOUNDARIES


def _all_boundaries(days, extra=0):
    ts = pd.date_range(T0, periods=24 * days, freq="h")
    rows = []
    for t in ts:
        rows.append({"ts": t, "boundary": "SCOTEX", "flow_mw": 2000.0, "limit_mw": 3500.0, "utilisation": 2000 / 3500, "fetched_at": T0})
        for k in range(extra):
            rows.append({"ts": t, "boundary": f"G{k}", "flow_mw": 5000.0, "limit_mw": 4000.0, "utilisation": 1.25, "fetched_at": T0})
    return pd.DataFrame(rows)


def _links_actuals():
    return (pd.DataFrame({"ts": [T0], "zone": "GB", "series": "flow_GB_NO2", "value": [-1400.0], "unit": "MW"}),
            pd.DataFrame({"to_zone": ["NO2"], "capacity_mw": [1400]}))


def test_a_one_day_all_boundaries_file_does_not_replace_the_longer_window(monkeypatch):
    a, links = _links_actuals()
    frames = {inf.FLOWS: flows(), inf.FLOWS_ALL: _all_boundaries(1), inf.COSTS: costs()}
    monkeypatch.setattr(inf, "_read", lambda name: frames.get(name))
    monkeypatch.setattr(inf.boalf, "load_bids", lambda: None)
    b = inf.build(actuals=a, links=links)
    b6 = next(r for r in b["boundaries"] if r["boundary"] == "SCOTEX")
    assert b6["hours"] == 48 and b6["overload_mwh"] == 6000  # the 48 h Scottish file, not the 24 h all-boundaries one
    assert (b["window"]["to"] - b["window"]["from"]) == pd.Timedelta(hours=47)


def test_the_all_boundaries_file_is_used_once_it_spans_as_long_and_is_capped(monkeypatch):
    a, links = _links_actuals()
    frames = {inf.FLOWS: flows(), inf.FLOWS_ALL: _all_boundaries(3, extra=12), inf.COSTS: costs()}
    monkeypatch.setattr(inf, "_read", lambda name: frames.get(name))
    monkeypatch.setattr(inf.boalf, "load_bids", lambda: None)
    b = inf.build(actuals=a, links=links)
    names = [r["boundary"] for r in b["boundaries"]]
    assert len(names) == inf.MAX_BOUNDARIES and "SCOTEX" in names
    assert next(r for r in b["boundaries"] if r["boundary"] == "SCOTEX")["hours"] == 72


def test_every_named_boundary_gets_a_plain_name_and_etys_number():
    from engine.infrastructure import BOUNDARY_NAMES
    assert set(BOUNDARY_NAMES) == {"SCOTEX", "SSE-SP", "SSEN-S", "SSHARN"}
    for code, (name, etys) in BOUNDARY_NAMES.items():
        assert name and code not in name and not name.startswith("NESO"), code
        assert etys.startswith("B"), code


def test_interconnector_basis_has_no_file_path():
    import inspect
    from engine import infrastructure
    assert "data/static" not in inspect.getsource(infrastructure)
