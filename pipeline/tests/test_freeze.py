import hashlib
import json
from pathlib import Path

import httpx
import pandas as pd
import pytest

from pipeline import cache, forecast_log, freeze, reveal_poll, schemas

FX = Path(__file__).parent / "fixtures" / "nordpool"
DELIVERY = "2026-11-09"
START = pd.Timestamp("2026-11-08 23:00", tz="UTC")  # Monday 00:00 CET
HOURS = pd.date_range(START, periods=24, freq="h")


def t(s):
    return pd.Timestamp(s, tz="UTC")


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.delenv("LG_OFFLINE", raising=False)
    for k in ("LG_FREEZE_AT", "LG_FREEZE_DELIVERY", "LG_RESULT_PUBLIC_AT", "LG_REVEAL_POLL_FROM", "LG_REVEAL_POLL_UNTIL", "LG_REVEAL_POLL_INTERVAL"):
        monkeypatch.delenv(k, raising=False)


def log_rows(made_at, level, zones=schemas.ZONES, target="price_da", hours=HOURS):
    rows = [
        {"made_at": t(made_at), "zone": z, "target": target, "ts": h, "horizon_h": 1, "p10": level - 5, "p50": level, "p90": level + 5, "model_version": "m"}
        for z in zones
        for h in hours
    ]
    return pd.DataFrame(rows)


def digest():
    return hashlib.sha256(cache.path("forecasts/log").read_bytes()).hexdigest()


def seed_log():
    for made, level in (("2026-11-07 20:00", 100), ("2026-11-07 23:00", 110), ("2026-11-08 08:00", 120), ("2026-11-08 10:30", 999)):
        forecast_log.append(log_rows(made, level))


def test_freeze_takes_the_latest_forecast_made_before_the_freeze_time():
    seed_log()
    r = freeze.freeze(now="2026-11-07 23:59")
    out = cache.read("forecasts/frozen_monday")
    assert r.complete and r.rows == 6 * 24 and (out["p50"] == 110).all()
    assert (out["frozen_at"] == t("2026-11-07 23:59")).all()
    assert set(out["made_at"]) == {t("2026-11-07 23:00")}
    schemas.validate(out, "forecasts/frozen_monday")


def test_refreeze_keeps_earlier_versions_and_never_alters_the_log():
    seed_log()
    before = digest()
    freeze.freeze(now="2026-11-07 23:59")
    freeze.freeze(now="2026-11-08 09:15")
    out = cache.read("forecasts/frozen_monday")
    assert sorted(out["frozen_at"].unique()) == [t("2026-11-07 23:59"), t("2026-11-08 09:15")]
    assert out[out.frozen_at == t("2026-11-07 23:59")]["p50"].eq(110).all()
    assert out[out.frozen_at == t("2026-11-08 09:15")]["p50"].eq(120).all()
    assert len(out) == 2 * 6 * 24
    assert digest() == before
    assert (freeze.latest_freeze()["frozen_at"] == t("2026-11-08 09:15")).all()


def test_forecasts_made_after_the_freeze_are_never_included():
    seed_log()
    freeze.freeze(now="2026-11-08 09:15")
    assert 999 not in set(cache.read("forecasts/frozen_monday")["p50"])


def test_freezing_after_the_gb_result_is_refused_and_writes_nothing():
    seed_log()
    with pytest.raises(freeze.FreezeTooLate):
        freeze.freeze(now="2026-11-08 10:00")
    with pytest.raises(freeze.FreezeTooLate):
        freeze.freeze(now="2026-11-08 12:00")
    assert not cache.exists("forecasts/frozen_monday")
    assert freeze.freeze(now="2026-11-08 09:59").complete


def test_same_freeze_time_twice_is_refused():
    seed_log()
    freeze.freeze(now="2026-11-08 09:15")
    with pytest.raises(ValueError, match="already exists"):
        freeze.freeze(now="2026-11-08 09:15")


def test_partial_freeze_is_written_and_reported():
    forecast_log.append(log_rows("2026-11-07 23:00", 110, zones=("GB", "NL")))
    forecast_log.append(log_rows("2026-11-07 23:00", 110, zones=("FR",), hours=HOURS[:10]))
    r = freeze.freeze(now="2026-11-07 23:59")
    assert not r.complete
    assert r.missing_zones == ["DE-LU", "BE", "NO2"] and r.short_zones == {"FR": 10}
    assert r.rows == 2 * 24 + 10 and len(cache.read("forecasts/frozen_monday")) == r.rows


def test_other_targets_and_other_days_are_ignored():
    forecast_log.append(log_rows("2026-11-07 23:00", 110))
    forecast_log.append(log_rows("2026-11-07 23:00", 55, target="load"))
    forecast_log.append(log_rows("2026-11-07 23:00", 77, hours=pd.date_range("2026-11-08 12:00", periods=5, freq="h", tz="UTC")))
    out = freeze.freeze(now="2026-11-07 23:59") and cache.read("forecasts/frozen_monday")
    assert set(out["target"]) == {"price_da"} and out["ts"].min() == START and out["ts"].max() == HOURS[-1]


def test_no_log_is_an_error_and_fixtures_are_never_frozen(monkeypatch):
    with pytest.raises(FileNotFoundError):
        freeze.freeze(now="2026-11-07 23:59")
    assert not cache.exists("forecasts/frozen_monday")


def test_nothing_to_freeze_writes_nothing():
    forecast_log.append(log_rows("2026-11-07 23:00", 110, hours=HOURS[:0].append(pd.DatetimeIndex([t("2026-11-20")]))))
    r = freeze.freeze(now="2026-11-07 23:59")
    assert r.rows == 0 and len(r.missing_zones) == 6 and not cache.exists("forecasts/frozen_monday")


def test_delivery_window_is_the_cet_day_and_handles_clock_changes():
    assert freeze.delivery_window("2026-11-09") == (START, t("2026-11-09 23:00"))
    a, b = freeze.delivery_window("2026-03-29")  # CET to CEST: a 23-hour day
    assert (b - a) == pd.Timedelta(hours=23)


def test_schedule_defaults_and_env_override(monkeypatch):
    assert freeze.schedule() == [t("2026-11-07 23:59"), t("2026-11-08 09:15")]
    assert freeze.result_public_at() == t("2026-11-08 10:00")
    monkeypatch.setenv("LG_FREEZE_AT", "2026-11-08T09:30Z, 2026-11-07T22:00Z")
    assert freeze.schedule() == [t("2026-11-07 22:00"), t("2026-11-08 09:30")]
    monkeypatch.setenv("LG_RESULT_PUBLIC_AT", "2026-11-08T09:20Z")
    assert freeze.result_public_at() == t("2026-11-08 09:20")
    monkeypatch.setenv("LG_FREEZE_DELIVERY", "2026-11-16")
    assert freeze.delivery_window()[0] == t("2026-11-15 23:00")


def test_watch_freezes_at_each_future_time_and_skips_past_ones():
    seed_log()
    clock = {"now": t("2026-11-07 23:00")}

    def sleep(sec):
        clock["now"] += pd.Timedelta(seconds=sec)

    out = freeze.watch(now_fn=lambda: clock["now"], sleep_fn=sleep)
    assert [r.frozen_at for r in out] == [t("2026-11-07 23:59"), t("2026-11-08 09:15")]
    clock["now"] = t("2026-11-08 09:00")
    assert [r.frozen_at for r in freeze.watch(now_fn=lambda: clock["now"], sleep_fn=lambda s: None) if r.frozen_at > t("2026-11-08 09:15")] == []


def test_cli_exit_codes(monkeypatch):
    ok = freeze.FreezeResult(t("2026-11-07 23:59"), 144, {z: 24 for z in schemas.ZONES})
    partial = freeze.FreezeResult(t("2026-11-07 23:59"), 120, {"GB": 24}, missing_zones=["FR"])
    monkeypatch.setattr(freeze, "freeze", lambda delivery=None: ok)
    assert freeze.main([]) == 0
    monkeypatch.setattr(freeze, "freeze", lambda delivery=None: partial)
    assert freeze.main([]) == 2

    def late(delivery=None):
        raise freeze.FreezeTooLate("late")

    monkeypatch.setattr(freeze, "freeze", late)
    assert freeze.main([]) == 3


# ---- reveal poller ----------------------------------------------------------------------------------------------


def np_client(published, calls=None):
    """published: set of markets that have results ('N2EX_DayAhead', 'DayAhead'); the rest return 204."""

    def handler(req: httpx.Request):
        if calls is not None:
            calls.append(req)
        m = req.url.params["market"]
        if m not in published["markets"]:
            return httpx.Response(204)
        name = "n2ex" if m == "N2EX_DayAhead" else "dayahead"
        body = json.loads((FX / f"{name}.json").read_text())
        for e in body["multiAreaEntries"]:
            for k in e["entryPerArea"]:
                e["entryPerArea"][k] += published.get("bump", 0)
        return httpx.Response(200, json=body)

    return httpx.Client(transport=httpx.MockTransport(handler))


FIXTURE_DAY = "2026-11-06"  # the recorded Nord Pool fixtures are for this delivery date


def test_poller_handles_not_yet_published_then_stores_results_as_they_land():
    pub = {"markets": set()}
    c = np_client(pub)
    r0 = reveal_poll.poll_once(FIXTURE_DAY, c, now="2026-11-08 09:50")
    assert r0 == {"new": 0, "zones": {}, "complete": False} and not cache.exists("reveal/results")
    pub["markets"] = {"N2EX_DayAhead"}
    r1 = reveal_poll.poll_once(FIXTURE_DAY, c, now="2026-11-08 10:01")
    assert set(r1["zones"]) == {"GB"} and r1["new"] == 8 and not r1["complete"]
    pub["markets"] = {"N2EX_DayAhead", "DayAhead"}
    r2 = reveal_poll.poll_once(FIXTURE_DAY, c, now="2026-11-08 12:02")
    assert set(r2["zones"]) == {"GB", "FR", "DE-LU", "NL", "BE", "NO2"} and r2["new"] == 5 * 8
    obs = cache.read("reveal/results")
    first = obs.groupby("zone")["seen_at"].min()
    assert first["GB"] == t("2026-11-08 10:01") and first["FR"] == t("2026-11-08 12:02")
    assert list(obs.columns) == reveal_poll.COLUMNS


def test_repeat_polls_add_nothing_and_revisions_are_kept_as_history():
    pub = {"markets": {"N2EX_DayAhead"}}
    c = np_client(pub)
    reveal_poll.poll_once(FIXTURE_DAY, c, now="2026-11-08 10:01")
    assert reveal_poll.poll_once(FIXTURE_DAY, c, now="2026-11-08 10:02")["new"] == 0
    pub["bump"] = 1.5
    assert reveal_poll.poll_once(FIXTURE_DAY, c, now="2026-11-08 10:03")["new"] == 8
    obs = cache.read("reveal/results")
    assert len(obs) == 16 and obs.groupby(["zone", "ts"]).size().eq(2).all()
    latest = obs.sort_values("seen_at").drop_duplicates(["zone", "ts"], keep="last")
    assert (latest["seen_at"] == t("2026-11-08 10:03")).all()


def test_results_also_reach_the_actuals_the_scorer_reads():
    reveal_poll.poll_once(FIXTURE_DAY, np_client({"markets": {"N2EX_DayAhead", "DayAhead"}}), now="2026-11-08 12:02")
    actuals = cache.read("actuals/nordpool_price_da")
    schemas.validate(actuals, "actuals")
    assert set(actuals["zone"]) == set(schemas.ZONES) and set(actuals["series"]) == {"price_da"}


def test_poller_queries_only_the_delivery_date_once_per_market():
    calls = []
    reveal_poll.poll_once(FIXTURE_DAY, np_client({"markets": {"N2EX_DayAhead", "DayAhead"}}, calls), now="2026-11-08 12:02")
    assert len(calls) == 2 and {c.url.params["date"] for c in calls} == {FIXTURE_DAY}


def test_watch_waits_for_the_start_polls_until_complete_or_deadline(monkeypatch):
    monkeypatch.setenv("LG_FREEZE_DELIVERY", FIXTURE_DAY)
    monkeypatch.setenv("LG_REVEAL_POLL_INTERVAL", "1800")
    day = freeze.delivery_window(FIXTURE_DAY)[0].normalize()
    clock = {"now": day + pd.Timedelta(hours=9)}
    naps = []

    def sleep(sec):
        naps.append(sec)
        clock["now"] += pd.Timedelta(seconds=sec)

    last = reveal_poll.watch(FIXTURE_DAY, np_client({"markets": {"N2EX_DayAhead"}}), now_fn=lambda: clock["now"], sleep_fn=sleep)
    assert naps[0] == 45 * 60 and set(naps[1:]) == {1800.0}  # waits for 09:45, then polls at the interval
    assert not last["complete"] and set(last["zones"]) == {"GB"}
    assert clock["now"] >= day + pd.Timedelta(hours=13, minutes=30)  # gave up at the deadline


def test_poll_window_defaults_and_env(monkeypatch):
    a, b = reveal_poll.poll_window(DELIVERY)
    assert a == t("2026-11-08 09:45") and b == t("2026-11-08 13:30")
    monkeypatch.setenv("LG_REVEAL_POLL_FROM", "2026-11-08T11:50Z")
    assert reveal_poll.poll_window(DELIVERY)[0] == t("2026-11-08 11:50")


def test_poller_refuses_to_run_offline(monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    with pytest.raises(RuntimeError):
        reveal_poll.poll_once(FIXTURE_DAY, np_client({"markets": set()}))
