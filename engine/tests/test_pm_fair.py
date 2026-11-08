"""#286: solo markets a naive strategy cannot farm. Directions are mixed, nothing is settled at the open, and the opening
price is what the note says."""

import copy
import re

import numpy as np
import pandas as pd

from engine.pm import build
from engine.tests.test_beat import league_for
from engine.tests.test_choices import boalf_history, replay_day

DAY = pd.Timestamp("2026-10-26", tz="UTC")


def day5(event="2026-10-26"):
    r = replay_day(5)
    r["event"] = event
    return r, boalf_history(), league_for(r)


def price_markets(ms):
    return [m for m in ms if m["kind"] == "price"]


def test_price_markets_ask_both_above_and_below_across_days():
    dirs = []
    for d in pd.date_range("2026-10-01", periods=10, freq="D"):
        r, boalf, league = day5(d.strftime("%Y-%m-%d"))
        dirs += [m["direction"] for m in price_markets(build.markets(r, boalf, league))]
    assert set(dirs) == {"above", "below"}
    share = dirs.count("below") / len(dirs)
    assert 0.3 <= share <= 0.7, share


def test_direction_is_stable_for_a_day():
    r, boalf, league = day5()
    a = [(m["id"], m["direction"]) for m in build.markets(r, boalf, league)]
    b = [(m["id"], m["direction"]) for m in build.markets(copy.deepcopy(r), boalf, league)]
    assert a == b


def test_a_below_market_is_the_mirror_of_its_above_market():
    r, boalf, league = day5()
    x = next(x for x in build.q.build(r, boalf, league=league) if build.ID.match(x.id))
    up = build.price_market(x, r, 12, "above")
    down = build.price_market(x, r, 12, "below")
    assert " above " in up["text"] and " below " in down["text"]
    assert {up["outcome"], down["outcome"]} == {"yes", "no"}
    for h, p in up["prices"].items():
        assert down["prices"][h] == 100 - p
    for n, p in up["bots"].items():
        assert abs(down["bots"][n] - (1 - p)) < 1e-9


def test_no_market_is_decided_at_the_open():
    for d in pd.date_range("2026-10-01", periods=10, freq="D"):
        r, boalf, league = day5(d.strftime("%Y-%m-%d"))
        for m in build.markets(r, boalf, league):
            assert build.OPEN_MIN < m["prices"]["12"] < build.OPEN_MAX, (m["id"], m["prices"]["12"])


def test_a_market_opening_at_an_extreme_is_dropped():
    r, boalf, league = day5()
    for s in r["series"]:  # Britain's band far below the line at 18:00: P(above) is the floor
        if s["zone"] == "GB":
            for p in s["points"]:
                if p["ts"].startswith("2026-10-26T18"):
                    p.update(p10=1.0, p50=2.0, p90=3.0, actual=2.0)
    ids = [m["id"] for m in build.markets(r, boalf, league)]
    assert "GB-price_da-18" not in ids


def so_far(boalf, hour):
    s = boalf.set_index(pd.to_datetime(boalf["ts"], utc=True))["value"].sort_index()
    return s[DAY : DAY + pd.Timedelta(hours=hour) - pd.Timedelta(seconds=1)].sum() / 1000


def wind(ms):
    return next(m for m in ms if m["kind"] == "ghost_wind")


def line(m):
    return float(re.search(r"more than ([\d.]+) GWh", m["text"]).group(1))


def test_the_wind_line_is_not_already_crossed_at_the_open():
    r, boalf, league = day5()
    m = wind(build.markets(r, boalf, league))
    assert line(m) > so_far(boalf, 12), "36 GWh were switched off by 12:00 on this day; the line must sit above that"


def test_the_wind_note_states_the_basis_of_the_opening_price():
    r, boalf, league = day5()
    m = wind(build.markets(r, boalf, league))
    note = m["model_note"]
    k, n = map(int, re.search(r"(\d+) of the previous (\d+) days", note).groups())
    assert f"{so_far(boalf, 12):.1f} GWh" in note, note
    assert m["prices"]["12"] == build.cents(k / n), (m["prices"]["12"], k, n, note)


def test_the_wind_price_goes_to_99_once_the_line_is_crossed():
    r, boalf, league = day5()
    m = wind(build.markets(r, boalf, league))
    x = line(m)
    for h in range(12, m["close_hour"]):
        if so_far(boalf, h) > x:
            assert m["prices"][str(h)] == 99, (h, m["prices"])


def test_a_wind_day_already_decided_is_skipped_or_kept_open():
    """A calm day where nothing more is likely to be switched off still opens strictly between the extremes, or is not
    offered at all."""
    r, _, league = day5()
    calm = boalf_history()
    calm.loc[pd.to_datetime(calm["ts"], utc=True) >= DAY, "value"] = 0.0
    ms = build.markets(r, calm, league)
    w = [m for m in ms if m["kind"] == "ghost_wind"]
    assert not w or build.OPEN_MIN < w[0]["prices"]["12"] < build.OPEN_MAX


def test_always_yes_has_no_edge_when_the_model_is_biased_low():
    """The #236 free lunch: the actual lands above our median most afternoons. With mixed directions, buying YES on
    every price market no longer pays on average."""
    pnl = []
    for d in pd.date_range("2026-10-01", periods=20, freq="D"):
        r, boalf, league = day5(d.strftime("%Y-%m-%d"))
        for s in r["series"]:
            for p in s["points"]:
                p["actual"] = p["p50"] * 1.15  # biased: every actual above the median
        for m in price_markets(build.markets(r, boalf, league)):
            pnl.append((1 if m["outcome"] == "yes" else 0) - (m["prices"]["12"] + 1) / 100)
    assert abs(np.mean(pnl)) < 0.15, np.mean(pnl)
