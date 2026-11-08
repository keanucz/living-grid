import pandas as pd
import pytest

from engine import data
from engine.routes import state

NOW = pd.Timestamp("2026-11-08 02:00", tz="UTC")
LAST = pd.Timestamp("2026-11-06 22:00", tz="UTC")  # where Elhub ends: about 28 h behind


def rows(items):
    return pd.DataFrame([{"ts": ts, "zone": z, "series": s, "value": v, "unit": "MW", "source": src} for src, z, s, v, ts in items])


def elhub(ts=LAST, extra=()):
    return [("elhub", "NO2", "load", 14000.0, ts), ("elhub", "NO2", "gen_hydro", 12000.0, ts), ("elhub", "NO2", "gen_wind", 900.0, ts), *extra]


def test_delayed_series_serves_elhub_latest_hour_with_its_own_as_of(monkeypatch):
    monkeypatch.setattr(data, "actuals", lambda: rows(elhub() + [("energycharts", "NO2", "load", 15300.0, NOW - pd.Timedelta(hours=3))]))
    load, mix, as_of = data.delayed_series(NOW)
    assert load == {"NO2": 14000.0} and mix == {"NO2": {"hydro": 12000.0, "wind": 900.0}}
    assert as_of["NO2"] == LAST  # the country-level Energy-Charts row is not used


def test_load_and_mix_describe_the_same_hour(monkeypatch):
    newer_load = ("elhub", "NO2", "load", 14500.0, LAST + pd.Timedelta(hours=1))  # load lands an hour before generation
    monkeypatch.setattr(data, "actuals", lambda: rows(elhub(extra=[newer_load])))
    load, mix, as_of = data.delayed_series(NOW)
    assert as_of["NO2"] == LAST and load["NO2"] == 14000.0 and "hydro" in mix["NO2"]


def test_data_older_than_three_days_is_not_served(monkeypatch):
    monkeypatch.setattr(data, "actuals", lambda: rows(elhub(ts=NOW - pd.Timedelta(days=4))))
    assert data.delayed_series(NOW) == ({}, {}, {})


def test_a_zone_with_regular_load_is_left_alone(monkeypatch):
    monkeypatch.setattr(data, "actuals", lambda: rows(elhub()))
    assert data.delayed_series(NOW, have={"NO2"}) == ({}, {}, {})


def test_state_marks_the_delayed_zone_and_only_that_zone(monkeypatch):
    monkeypatch.setattr(data, "actuals", lambda: rows(elhub() + [("energycharts", "FR", "load", 52000.0, NOW - pd.Timedelta(hours=3)),
                                                                   ("energycharts", "FR", "gen_nuclear", 41000.0, NOW - pd.Timedelta(hours=3))]))
    monkeypatch.setattr(data, "prices", lambda t: {})
    monkeypatch.setattr(data, "forecasts", lambda t: {})
    monkeypatch.setattr(data, "carbon_at", lambda t: {})
    monkeypatch.setattr(data, "link_flows", lambda t: [])
    out = state._compute(NOW)
    z = {x["zone"]: x for x in out["zones"]}
    assert z["NO2"]["load_mw"] == 14000.0 and z["NO2"]["mix_mw"]["hydro"] == 12000.0
    assert pd.Timestamp(z["NO2"]["metered_as_of"]) == LAST
    assert z["FR"]["load_mw"] == 52000.0 and z["FR"]["metered_as_of"] is None
    assert z["GB"]["load_mw"] is None and z["GB"]["metered_as_of"] is None
