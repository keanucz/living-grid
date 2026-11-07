import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine import household as hh
from engine import household_savings as hs
from engine.app import app
from engine.schemas import HouseholdSavingsResponse
from pipeline import cache

client = TestClient(app)
NOW = pd.Timestamp("2026-11-07T18:10Z")


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.setenv("LG_OFFLINE", "1")
    monkeypatch.setattr(hh, "clock", lambda: NOW)


def price(ts):
    """Cheap 02:00 to 04:00 UK (10p), 6 pm to 7 pm dear (40p), 20p otherwise."""
    local = ts.tz_convert(hs.UK)
    return 10.0 if 2 <= local.hour < 4 else 40.0 if local.hour == 18 else 20.0


def write_agile(region, start, end, fn=price):
    ts = pd.date_range(start, end, freq="30min", inclusive="left", tz="UTC")
    cache.write("octopus/agile", pd.DataFrame({"ts": ts, "region": region, "p_kwh": [fn(t) for t in ts], "fetched_at": NOW}))


def test_cap_rates_come_from_the_ofgem_fact_for_all_14_regions():
    assert hs.cap_rate("B") == 25.36 and hs.cap_rate("D") == 27.86 and hs.cap_rate("N") == 26.11 and hs.cap_rate("C") == 26.6
    assert all(24 < hs.cap_rate(r) < 29 for r in hh.regions())
    assert "ofgem.gov.uk" in hs.cap_info("N")["source"]


def test_daily_saving_is_best_window_against_6pm():
    write_agile("N", "2026-10-01", "2026-10-11")
    spec = hs._devices()["dishwasher"]
    d = hs.daily(hs.history("N"), spec)
    assert len(d) >= 8
    assert d["best_gbp"].iloc[0] == pytest.approx(10 * 0.9 / 100) and d["six_gbp"].iloc[0] == pytest.approx(40 * 0.9 / 100)


def test_monthly_scales_to_the_whole_month_and_flags_partial_months():
    write_agile("N", "2026-09-20", "2026-11-05")
    b = hs.build("N", ["dishwasher"], now=NOW)
    months = {m["month"]: m for m in b["months"]}
    assert months["2026-10"]["partial"] is False and months["2026-09"]["partial"] is True
    uses = 31 * 5 / 7
    assert months["2026-10"]["saving_vs_6pm_gbp"] == pytest.approx(0.9 * (40 - 10) / 100 * uses)
    assert months["2026-10"]["saving_vs_cap_gbp"] == pytest.approx((26.11 - 10) * 0.9 / 100 * uses)
    assert months["2026-09"]["saving_vs_cap_gbp"] is None
    assert b["annual"]["months_used"] == 1
    a = b["annual"]["saving_vs_6pm_gbp"]
    assert a["low"] == a["mean"] == a["high"] == pytest.approx(months["2026-10"]["saving_vs_6pm_gbp"] * 12)


def test_battery_buys_cheap_and_sells_dear_and_never_loses():
    write_agile("N", "2026-10-01", "2026-10-11", lambda t: 10.0 if t.tz_convert(hs.UK).hour < 6 else 30.0)
    spec = hs._devices()["home_battery"]
    d = hs.daily(hs.history("N"), spec)
    assert d["best_gbp"].iloc[0] == pytest.approx((30 - 10 / hs.BATTERY_RTE) * 10 / 100)
    write_agile("N", "2026-10-01", "2026-10-11", lambda t: 20.0)
    assert (hs.daily(hs.history("N"), spec)["best_gbp"] == 0).all()


def test_heat_pump_only_counts_heating_months():
    write_agile("N", "2026-06-01", "2026-08-01")
    assert hs.build("N", ["heat_pump"], now=NOW)["months"] == []


def test_endpoint_tonight_compares_with_cap_6pm_and_optional_fixed():
    write_agile("N", "2026-11-07", "2026-11-08T07:00")
    r = client.get("/household/savings?region=n&devices=dishwasher&fixed_p_kwh=25")
    assert r.status_code == 200
    body = HouseholdSavingsResponse.model_validate(r.json())
    t = body.tonight[0]
    assert t.kind == "actual" and t.cost_gbp.p50 == pytest.approx(0.9 * 10 / 100)
    assert t.saving_vs_cap_gbp.p50 == pytest.approx((26.11 - 10) * 0.9 / 100)
    assert t.saving_vs_fixed_gbp.p50 == pytest.approx(15 * 0.9 / 100)
    assert t.saving_vs_6pm_gbp.p50 == pytest.approx((30 - 10) * 0.9 / 100)  # baseline starts 18:30: one 40p slot, one 20p slot
    assert body.cap.p_kwh == 26.11 and body.fixed_p_kwh == 25 and "standing charges" in body.note


def test_endpoint_without_data_still_answers_and_rejects_bad_input():
    body = HouseholdSavingsResponse.model_validate(client.get("/household/savings?region=A").json())
    assert body.months == [] and body.annual is None and body.tonight == [] and body.cap.p_kwh == 26.61
    assert client.get("/household/savings?region=ZZ").status_code == 404
    assert client.get("/household/savings?region=A&devices=toaster").status_code == 422
