"""#303: wind markets close when their window ends, and Beat the model's wind call uses the conditioned basis of #286."""

import re

import numpy as np
import pandas as pd

from engine.beat import build as beat
from engine.market import questions as q
from engine.pm import build as pm
from engine.tests.test_beat import league_for
from engine.tests.test_choices import boalf_history, flows, replay_day

DAY = pd.Timestamp("2026-10-26", tz="UTC")


def so_far(boalf, hour):
    s = boalf.set_index(pd.to_datetime(boalf["ts"], utc=True))["value"].sort_index()
    return s[DAY : DAY + pd.Timedelta(hours=hour) - pd.Timedelta(seconds=1)].sum() / 1000


def line(text):
    return float(re.search(r"more than ([\d.]+) GWh", text).group(1))


def basis(note):
    return tuple(map(int, re.search(r"(\d+) of the previous (\d+) days", note).groups()))


def quiet_morning():
    """A day with a quiet morning (nothing switched off before 12:00) and a big afternoon, so the unconditional count
    and the conditioned one disagree."""
    b = boalf_history()
    ts = pd.to_datetime(b["ts"], utc=True)
    b.loc[(ts >= DAY) & (ts < DAY + pd.Timedelta(hours=12)), "value"] = 0.0
    return b


def day5():
    r = replay_day(5)
    r["event"] = "2026-10-26"
    return r


def test_pm_wind_market_closes_at_the_end_of_its_window():
    r = day5()
    m = next(m for m in pm.markets(r, boalf_history(), league_for(r)) if m["kind"] == "ghost_wind")
    assert "between midnight and 18:00" in m["text"]
    assert m["close_hour"] == 18, "the question runs to 18:00, so the market must not close (and reveal) at 17:00"
    assert sorted(map(int, m["prices"])) == list(range(12, 18)), "a price for every game hour until it closes"
    pm.validate([m], 12, 18)


def test_wind_question_conditions_on_what_is_already_switched_off_at_the_start():
    b = quiet_morning()
    x = q.wind_question(DAY, b, 18, start_hour=12)
    now = so_far(b, 12)
    assert x.target_hour == 18
    assert line(x.text) > now
    assert f"{now:.1f} GWh" in x.text, "the question says what has already been switched off by the start"
    k, n = basis(x.model_note)
    assert f"{now:.1f} GWh already switched off by 12:00" in x.model_note
    assert x.model_p == round(float(np.clip(k / n, q.P_FLOOR, q.P_CEIL)), 3), (x.model_p, k, n)
    assert x.outcome == (so_far(b, 18) > line(x.text))


def test_the_line_sits_above_a_big_morning():
    b = boalf_history()  # 3000 MWh an hour on the day: 36 GWh by 12:00
    x = q.wind_question(DAY, b, 18, start_hour=12)
    assert line(x.text) > so_far(b, 12) > 30


def test_beat_wind_call_uses_the_conditioned_basis_and_the_full_window():
    r = day5()
    b = quiet_morning()
    c = next(c for c in beat.calls(r, b, flows(), league_for(r)) if c["kind"] == "wind_over")
    assert c["hour"] == 18
    assert "already switched off by 12:00" in c["model"]["reason"]
    k, n = basis(c["model"]["reason"])
    p_yes = k / n
    assert c["model"]["choice"] == ("yes" if p_yes > 0.5 else "no" if p_yes < 0.5 else c["model"]["choice"])
    beat.validate(beat.calls(r, b, flows(), league_for(r)))
