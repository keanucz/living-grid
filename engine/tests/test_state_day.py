import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine import data
from engine import schemas as s
from engine.app import app
from engine.routes import state as route

client = TestClient(app)
DAY = "2026-11-07"


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    route._day.cache_clear()


def test_day_has_24_hourly_states_in_order():
    r = client.get("/state/day", params={"date": DAY})
    assert r.status_code == 200, r.text
    body = s.StateDayResponse.model_validate(r.json())
    assert str(body.date) == DAY
    hours = [pd.Timestamp(h.at) for h in body.hours]
    assert hours == list(pd.date_range(f"{DAY} 00:00", periods=24, freq="h", tz="UTC"))


def test_each_hour_matches_state_for_that_hour():
    day = route.build_day(DAY)
    for h in (0, 7, 12, 23):
        at = pd.Timestamp(f"{DAY} {h:02d}:00", tz="UTC")
        one = route._compute(at)
        got = day["hours"][h]
        assert got["at"] == one["at"]
        assert got["zones"] == one["zones"], f"zones differ at {at}"
        assert got["flows"] == one["flows"], f"flows differ at {at}"


def test_scope_is_lifted_after_the_day():
    full = len(data.actuals())
    route.build_day(DAY)
    assert len(data.actuals()) == full, "the day's slice must not leak into later calls"


def test_one_computation_per_day_until_an_input_changes(monkeypatch):
    calls = []
    real = route._compute_day
    monkeypatch.setattr(route, "_compute_day", lambda d: calls.append(d) or real(d))
    first = route.build_day(DAY)
    assert route.build_day(DAY) is first
    assert len(calls) == 1
    monkeypatch.setattr(route.timeline, "_signature", lambda: ("changed",))
    route.build_day(DAY)
    assert len(calls) == 2


def test_bad_or_future_date_is_rejected():
    assert client.get("/state/day", params={"date": "07-11-2026"}).status_code == 422
    future = (pd.Timestamp.now(tz="UTC") + pd.Timedelta(days=3)).strftime("%Y-%m-%d")
    assert client.get("/state/day", params={"date": future}).status_code == 422


def test_the_full_cache_is_read_once_per_day(monkeypatch):
    """The speed-up: 24 hours filter one day's slice, not the whole cache 24 times (about 6x on the runner's data)."""
    real = data.actuals
    unscoped = []
    monkeypatch.setattr(data, "actuals", lambda: (data._SCOPE.get() is None and unscoped.append(1)) or real())
    route.build_day("2026-11-06")
    assert len(unscoped) == 1
