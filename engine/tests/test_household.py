import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine import household as hh
from engine.app import app
from engine.schemas import HouseholdResponse
from pipeline import cache

client = TestClient(app)
NOW = pd.Timestamp("2026-11-07T18:10Z")  # GMT: UK time is the same
DAY = pd.Timestamp("2026-11-07T00:00Z")


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.setenv("LG_OFFLINE", "1")
    monkeypatch.setattr(hh, "clock", lambda: NOW)


def write_forecast(hours, p50, spread=10.0, made_at=None):
    made_at = NOW - pd.Timedelta(hours=1) if made_at is None else made_at
    ts = [DAY + pd.Timedelta(hours=h) for h in hours]
    cache.write("forecasts/log", pd.DataFrame({
        "made_at": made_at, "zone": "GB", "target": "price_da", "ts": ts, "horizon_h": 1,
        "p10": [p50(h) - spread for h in hours], "p50": [p50(h) for h in hours], "p90": [p50(h) + spread for h in hours],
        "model_version": "t"}))


def write_agile(region, upto_hour, value=lambda ts: 20.0):
    ts = pd.date_range(DAY, DAY + pd.Timedelta(hours=upto_hour), freq="30min", inclusive="left")
    cache.write("octopus/agile", pd.DataFrame({"ts": ts, "region": region, "p_kwh": [value(t) for t in ts], "fetched_at": NOW}))


def cheap_at_3am(h):
    return 40.0 if h % 24 != 3 else 10.0


def test_formula_values_come_from_the_verified_reference_and_cover_all_regions():
    assert hh.formula("N") == (2.1, 13.0) and hh.formula("P") == (2.4, 12.0) and hh.formula("L") == (2.3, 11.0)
    assert all(len(hh.formula(r)) == 2 for r in hh.regions()) and len(hh.regions()) == 14
    assert hh.dishwasher_kwh() == 0.9


def test_agile_from_wholesale_applies_peak_adder_cap_and_vat():
    ts = pd.DatetimeIndex(["2026-11-07T12:00Z", "2026-11-07T16:30Z", "2026-11-07T19:00Z", "2026-11-07T17:00Z"])
    got = hh.agile_from_wholesale(np.array([100.0, 100.0, 100.0, 5000.0]), ts, 2.1, 13.0)
    assert got == pytest.approx([2.1 * 10 * 1.05, (2.1 * 10 + 13) * 1.05, 2.1 * 10 * 1.05, 95 * 1.05])
    assert hh.agile_from_wholesale(np.array([-50.0]), ts[:1], 2.1, 13.0)[0] < 0


def test_peak_window_follows_uk_clock_time_in_summer():
    ts = pd.DatetimeIndex(["2026-07-01T15:30Z", "2026-07-01T14:30Z"])  # 16:30 and 15:30 BST
    got = hh.agile_from_wholesale(np.array([100.0, 100.0]), ts, 2.0, 12.0)
    assert got == pytest.approx([(20 + 12) * 1.05, 20 * 1.05])


def test_tonight_spans_17_00_to_07_00_uk():
    assert hh.tonight(pd.Timestamp("2026-11-07T12:00Z")) == (pd.Timestamp("2026-11-07T17:00Z"), pd.Timestamp("2026-11-08T07:00Z"))
    assert hh.tonight(pd.Timestamp("2026-11-07T18:10Z")) == (pd.Timestamp("2026-11-07T18:30Z"), pd.Timestamp("2026-11-08T07:00Z"))
    assert hh.tonight(pd.Timestamp("2026-11-08T02:10Z"))[0] == pd.Timestamp("2026-11-08T02:30Z")


def test_published_prices_win_and_forecast_fills_beyond():
    write_agile("N", 24, lambda t: 30.0 if t.hour != 21 else 12.0)  # published to midnight
    write_forecast(range(24, 34), lambda h: 100.0)  # forecast covers 00:00 to 10:00 next day
    body = HouseholdResponse.model_validate(client.get("/household?region=N").json())
    kinds = {p.ts: p.kind for p in body.prices}
    assert kinds[pd.Timestamp("2026-11-07T21:00Z")] == "actual" and kinds[pd.Timestamp("2026-11-08T02:00Z")] == "forecast"
    pub = next(p for p in body.prices if p.ts == pd.Timestamp("2026-11-07T21:00Z"))
    assert pub.p_kwh == 12.0 and pub.p10 is None and pub.p90 is None
    fc = next(p for p in body.prices if p.ts == pd.Timestamp("2026-11-08T02:00Z"))
    assert fc.p_kwh == pytest.approx(2.1 * 10 * 1.05) and fc.p10 < fc.p_kwh < fc.p90


def test_dishwasher_window_is_the_cheapest_hour_with_published_prices_only():
    write_agile("N", 24, lambda t: 10.0 if t.hour == 21 else 30.0)
    w = {x.task: x for x in HouseholdResponse.model_validate(client.get("/household?region=N").json()).windows}
    assert "ev" not in w or w["ev"].kind in ("actual", "forecast")
    d = w["dishwasher"]
    assert (d.start, d.end) == (pd.Timestamp("2026-11-07T21:00Z"), pd.Timestamp("2026-11-07T22:00Z")) and d.kind == "actual"
    assert d.avg_p_kwh == 10.0 and d.saving_gbp.p10 == d.saving_gbp.p50 == d.saving_gbp.p90 == pytest.approx(20 * 0.9 / 100)


def test_ev_window_uses_the_forecast_and_saving_has_ordered_uncertainty():
    write_agile("N", 24, lambda t: 25.0)
    write_forecast(range(24, 34), lambda h: 40.0 if h % 24 != 3 else 5.0, spread=15.0)
    ev = next(w for w in HouseholdResponse.model_validate(client.get("/household?region=N").json()).windows if w.task == "ev")
    assert ev.kind == "forecast" and ev.start <= pd.Timestamp("2026-11-08T03:00Z") < ev.end
    assert (ev.end - ev.start) == pd.Timedelta(hours=3)
    assert ev.saving_gbp.p10 < ev.saving_gbp.p50 < ev.saving_gbp.p90 and ev.saving_gbp.p50 > 0
    kwh = hh.EV_KW * hh.EV_HOURS
    base = 25.0
    assert ev.saving_gbp.p50 == pytest.approx((base - ev.avg_p_kwh) * kwh / 100)


def test_forecasts_made_after_now_are_never_used():
    write_forecast(range(24, 34), lambda h: 5.0, made_at=NOW + pd.Timedelta(minutes=1))
    body = client.get("/household?region=N").json()
    assert body["prices"] == [] and body["windows"] == [] and "No prices cover tonight" in body["note"]


def test_latest_forecast_run_wins_per_hour():
    old = NOW - pd.Timedelta(hours=5)
    write_forecast(range(24, 34), lambda h: 500.0, made_at=old)
    first = pd.read_parquet(cache.path("forecasts/log"))
    write_forecast(range(24, 34), lambda h: 100.0, made_at=NOW - pd.Timedelta(hours=1))
    cache.write("forecasts/log", pd.concat([first, pd.read_parquet(cache.path("forecasts/log"))], ignore_index=True))
    t = hh.price_table("N", NOW, pd.Timestamp("2026-11-08T02:00Z"), pd.Timestamp("2026-11-08T03:00Z"))
    assert t["p50"].iloc[0] == pytest.approx(2.1 * 10 * 1.05)


def test_regions_get_their_own_published_rates_and_formula():
    write_agile("N", 24, lambda t: 10.0)
    ts = pd.date_range(DAY, DAY + pd.Timedelta(hours=24), freq="30min", inclusive="left")
    first = pd.read_parquet(cache.path("octopus/agile"))
    cache.write("octopus/agile", pd.concat([first, pd.DataFrame({"ts": ts, "region": "C", "p_kwh": 99.0, "fetched_at": NOW})]))
    n = client.get("/household?region=N").json()
    c = client.get("/household?region=C").json()
    assert {p["p_kwh"] for p in n["prices"]} == {10.0} and {p["p_kwh"] for p in c["prices"]} == {99.0}
    assert (n["region"], n["name"]) == ("N", "South and Central Scotland") and c["name"] == "London"


def test_region_is_case_insensitive_and_unknown_region_is_404():
    assert client.get("/household?region=n").json()["region"] == "N"
    r = client.get("/household?region=Z")
    assert r.status_code == 404 and "A, B, C" in r.json()["detail"]


def test_note_states_the_assumptions_honestly():
    note = client.get("/household?region=N").json()["note"]
    assert "approximates Agile" in note and "assumption" in note and "0.9 kWh" in note and "D 2.1" in note
