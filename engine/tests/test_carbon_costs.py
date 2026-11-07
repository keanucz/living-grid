import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine import carbon_costs as cc
from engine.app import app
from pipeline.ingest import uk_ets

client = TestClient(app)

HEAD = ("<tr><th>Month</th><th>2-year reference period</th><th>Trigger price</th><th>6-month monitoring period</th>"
        + "".join(f"<th>Month {k} average price</th>" for k in range(1, 7)) + "<th>CCM triggered? Yes or No</th></tr>")
ROWS = [
    ("Jun-26", ["£62.13", "£68.26", "£50.83", "£39.46", "£46.82", "£52.41"]),
    ("Jul-26", ["£68.26", "£50.83", "£39.46", "£46.82", "£52.41", "£57.02"]),
    ("Nov-26", ["£52.41", "£57.02", "£58.68", "£59.34", "£60.17", "TBD"]),
]
HTML = "<table>" + HEAD + "".join(
    f"<tr><td>{m}</td><td>x</td><td>£130.98</td><td>x</td>" + "".join(f"<td>{p}</td>" for p in ps) + "<td>No</td></tr>"
    for m, ps in ROWS) + "</table>"


def test_parse_assigns_months_before_the_row_month_and_skips_tbd():
    df = uk_ets.parse(HTML)
    s = df.set_index("ts")["value"]
    assert s[pd.Timestamp("2025-12-01", tz="UTC")] == 62.13
    assert s[pd.Timestamp("2026-05-01", tz="UTC")] == 52.41
    assert s[pd.Timestamp("2026-06-01", tz="UTC")] == 57.02
    assert s[pd.Timestamp("2026-09-01", tz="UTC")] == 60.17
    assert pd.Timestamp("2026-10-01", tz="UTC") not in s.index


def test_static_months_match_the_published_table():
    parsed = uk_ets.parse(HTML).set_index("ts")["value"]
    static = uk_ets.load().set_index("ts")["value"]
    for ts, v in parsed.items():
        assert static[ts] == pytest.approx(v)


def frames():
    ts = pd.Timestamp("2026-11-07 12:00", tz="UTC")
    ci = pd.DataFrame({"ts": [ts, ts], "zone": ["GB", "FR"], "production_gco2_kwh": [200.0, 50.0],
                       "consumption_gco2_kwh": [250.0, 60.0], "imports_share": [0.1, 0.1]})
    uka = pd.DataFrame({"ts": [pd.Timestamp("2026-09-01", tz="UTC")], "value": [60.0], "source": ["t"]})
    eua = pd.Series([80.0], index=[pd.Timestamp("2026-11-06", tz="UTC")])
    return ci, uka, eua


def test_cost_gap_and_rollups():
    ci, uka, eua = frames()
    b = cc.build(ci=ci, uka=uka, eua_series=eua, data_centre_mw=10)
    gb = next(z for z in b["zones"] if z["zone"] == "GB")
    assert gb["carbon_cost_per_mwh"] == pytest.approx(0.25 * 60.0)
    assert gb["appraisal_cost_per_mwh"] == pytest.approx(0.25 * 316.9, abs=0.01)
    assert gb["unpriced_gap_per_mwh"] == pytest.approx(0.25 * (316.9 - 60.0), abs=0.01)
    assert gb["household_per_year"] == pytest.approx(15.0 * 2.5)
    assert gb["data_centre_per_year"] == pytest.approx(15.0 * 10 * 8760)
    fr = next(z for z in b["zones"] if z["zone"] == "FR")
    assert fr["currency"] == "EUR" and fr["carbon_cost_per_mwh"] == pytest.approx(0.06 * 80.0)
    assert fr["appraisal_value_per_t"] == pytest.approx(316.9 * cc.EUR_PER_GBP, abs=0.1)
    assert b["kind"] == "estimated" and "DESNZ" in b["appraisal"]["source"] and "Ofgem" in b["household"]["source"]


def test_missing_price_gives_no_numbers_not_invented_ones():
    ci, uka, _ = frames()
    b = cc.build(ci=ci, uka=uka, eua_series=pd.Series(dtype=float))
    fr = next(z for z in b["zones"] if z["zone"] == "FR")
    assert fr["carbon_price"] is None and fr["carbon_cost_per_mwh"] is None and fr["appraisal_cost_per_mwh"] > 0


def test_route_offline_fixture_and_validation(monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    r = client.get("/carbon/costs")
    assert r.status_code == 200, r.text
    gb = next(z for z in r.json()["zones"] if z["zone"] == "GB")
    assert gb["carbon_price"]["scheme"] == "UK ETS" and gb["carbon_cost_per_mwh"] > 0
    assert client.get("/carbon/costs", params={"data_centre_mw": 0}).status_code == 422


def test_parse_ignores_the_three_month_table():
    three = ("<table><tr><th>Month</th><th>Month 1 average price</th><th>Month 2 average price</th>"
             "<th>Month 3 average price</th></tr><tr><td>Oct-21</td><td>£44.15</td><td>£48.55</td><td>£58.36</td></tr></table>")
    df = uk_ets.parse(three + HTML)
    assert pd.Timestamp("2021-07-01", tz="UTC") not in set(df["ts"])
