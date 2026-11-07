import json

import numpy as np
import pandas as pd
import pytest

from pipeline import cache, events

HOURS = pd.date_range("2025-01-01", "2025-03-01", freq="h", tz="UTC")


def actuals(rows: dict[tuple[str, str, str], np.ndarray]) -> pd.DataFrame:
    parts = [pd.DataFrame({"ts": HOURS, "zone": z, "series": s, "value": v, "source": src}) for (z, s, src), v in rows.items()]
    return pd.concat(parts, ignore_index=True)


def data(rows, markets=None, costs=None) -> events.Data:
    return events.Data(actuals(rows), markets if markets is not None else pd.DataFrame(columns=["ts", "series", "value"]),
                       costs if costs is not None else pd.DataFrame(columns=["date", "total_cost_gbp"]))


def flat(v):
    return np.full(len(HOURS), float(v))


def test_record_wind_finds_the_windiest_day_and_numbers_match_the_series():
    wind = flat(5000)
    wind[(HOURS >= "2025-02-10") & (HOURS < "2025-02-11")] = 15000
    d = data({("GB", "gen_wind", "elexon"): wind, ("GB", "system_price", "elexon"): flat(50), ("GB", "load", "elexon"): flat(30000),
              ("GB", "boalf_mwh", "elexon"): flat(100)})
    ev = events.record_wind(d)
    assert ev.confirmed_by.endswith("(10 February 2025)")
    assert ev.key_numbers[0]["value"] == 15000 and ev.key_numbers[2]["value"] == 50.0
    assert ev.key_numbers[3]["value"] == pytest.approx(2.4)  # 24 h x 100 MWh


def test_cable_out_picks_the_longest_run_and_needs_three_days():
    flow = flat(-1200)
    flow[(HOURS >= "2025-01-10") & (HOURS < "2025-01-12")] = 0  # two days: too short
    flow[(HOURS >= "2025-02-01") & (HOURS < "2025-02-06")] = 0  # five days
    rows = {("GB", "flow_GB_NO2", "elexon"): flow, ("GB", "system_price", "elexon"): flat(80), ("NO2", "price_da", "energycharts"): flat(60),
            ("GB", "flow_GB_FR", "elexon"): flat(500)}
    ev = events.cable_out(data(rows))
    assert ev.key_numbers[0]["value"] == 5 and "1 February 2025 to 5 February 2025" in ev.confirmed_by
    short = flow.copy()
    short[(HOURS >= "2025-02-01") & (HOURS < "2025-02-06")] = -1200
    with pytest.raises(events.NotConfirmed):
        events.cable_out(data({**rows, ("GB", "flow_GB_NO2", "elexon"): short}))


def test_price_spike_uses_the_dearest_day_and_states_the_week_before():
    price = flat(80)
    price[(HOURS >= "2025-02-20T15:00") & (HOURS < "2025-02-20T18:00")] = 2900
    rows = {("GB", "system_price", "elexon"): price, ("GB", "gen_wind", "elexon"): flat(6000), ("GB", "gen_gas", "elexon"): flat(20000),
            ("GB", "load", "elexon"): flat(35000)}
    ev = events.price_spike(data(rows))
    assert ev.key_numbers[0]["value"] == 2900 and ev.key_numbers[2]["value"] == 3 and ev.key_numbers[3]["value"] == 80
    assert any(m["label"] == "Price peak" and m["ts"].startswith("2025-02-20T15:00") for m in ev.moments)
    assert "20 February 2025" in ev.script[0]


def test_storm_uses_the_dearest_constraint_day_and_refuses_without_costs():
    costs = pd.DataFrame({"date": ["2025-02-03", "2025-02-04", "2025-02-05"], "total_cost_gbp": [1e6, 36.5e6, 2e6]})
    rows = {("GB", "gen_wind", "elexon"): flat(9000), ("GB", "system_price", "elexon"): flat(90), ("GB", "boalf_mwh", "elexon"): flat(40),
            ("GB", "flow_GB_NO2", "elexon"): flat(-900)}
    ev = events.storm(data(rows, costs=costs))
    assert ev.focus.isoformat() == "2025-02-04" and ev.key_numbers[0]["value"] == 36.5e6 and "£36.5 million" in ev.title
    with pytest.raises(events.NotConfirmed):
        events.storm(data(rows))


def test_gas_crisis_needs_gas_and_quotes_the_peak_from_the_data():
    days = pd.date_range("2021-01-01", "2023-01-01", freq="D", tz="UTC")
    gas = pd.Series(20.0, index=days)
    gas["2022-08-26"] = 340.0
    m = pd.concat([pd.DataFrame({"ts": days, "series": "gas_ttf", "value": gas.to_numpy()}),
                   pd.DataFrame({"ts": days, "series": "eua", "value": 80.0})])
    ev = events.gas_crisis(events.Data(pd.DataFrame(columns=["ts", "zone", "series", "value", "source"]), m, pd.DataFrame()))
    assert ev.key_numbers[0]["value"] == 340 and ev.resolution == "daily" and "26 August 2022" in ev.confirmed_by
    with pytest.raises(events.NotConfirmed):
        events.gas_crisis(events.Data(pd.DataFrame(), pd.DataFrame(columns=["ts", "series", "value"]), pd.DataFrame()))


def test_problems_flags_moments_and_series_outside_the_window_and_unsourced_numbers():
    ok = {"slug": "x", "title": "t", "headline": "h", "start": "2025-01-01T00:00:00+00:00", "end": "2025-01-03T00:00:00+00:00",
          "key_numbers": [{"label": "n", "value": 1, "unit": "u", "source": "s"}], "script": ["a"], "sources": ["s"], "confirmed_by": "c",
          "replay": {"available": False}, "moments": [{"ts": "2025-01-02T00:00:00+00:00", "label": "a", "text": "t"}] * 2,
          "series": [{"key": "k", "points": [["2025-01-01T00:00:00+00:00", 1.0]]}]}
    assert events.problems(ok) == []
    bad = {**ok, "moments": [{"ts": "2025-02-02T00:00:00+00:00", "label": "late", "text": "t"}] * 2,
           "series": [{"key": "k", "points": [["2025-03-01T00:00:00+00:00", 1.0]]}], "key_numbers": [{"label": "n"}]}
    errs = events.problems(bad)
    assert any("outside the window" in e and "late" in e for e in errs) and any("series k" in e for e in errs) and any("no source" in e for e in errs)


def test_write_then_check_round_trips(tmp_path, monkeypatch):
    monkeypatch.setattr(events, "OUT_DIR", tmp_path)
    wind = flat(5000)
    wind[(HOURS >= "2025-02-10") & (HOURS < "2025-02-11")] = 15000
    d = data({("GB", "gen_wind", "elexon"): wind, ("GB", "system_price", "elexon"): flat(50), ("GB", "load", "elexon"): flat(30000),
              ("GB", "boalf_mwh", "elexon"): flat(100)})
    b = events.bundle(events.record_wind(d))
    events.write([b])
    assert events.check() == [] and json.loads((tmp_path / "index.json").read_text())["events"][0]["slug"] == "record-wind"
    (tmp_path / "record-wind.json").unlink()
    assert any("missing" in e for e in events.check())


def test_committed_event_library_is_complete_and_valid():
    idx = json.loads((cache.ROOT / "data" / "events" / "index.json").read_text())["events"]
    slugs = {e["slug"] for e in idx}
    assert len(idx) >= 6 and {"storm", "dunkelflaute", "gas-crisis"} <= slugs
    assert events.check() == []
    for e in idx:
        b = json.loads((cache.ROOT / "data" / "events" / f"{e['slug']}.json").read_text())
        assert all("caused by" not in line for line in b["script"]) and 3 <= len(b["script"]) <= 6
        assert b["label"] == "computed from cached public data"
