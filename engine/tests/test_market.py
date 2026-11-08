import math
import re
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from engine.market import book, bots, lmsr, questions
from engine.market import __main__ as runner

B = lmsr.B
MODULE = Path(__file__).resolve().parents[2] / "spacetime" / "module" / "src" / "market_core.ts"


# ---------------- LMSR ----------------


def test_price_starts_at_half_and_moves_towards_the_side_bought():
    assert lmsr.price_yes(0, 0) == pytest.approx(0.5)
    assert lmsr.price_yes(100, 0) == pytest.approx(1 / (1 + math.exp(-1)))
    assert lmsr.price_yes(0, 100) < 0.5


def test_trade_cost_is_the_cost_difference_and_is_path_independent():
    one = lmsr.trade_cost(0, 0, "yes", 60)
    two = lmsr.trade_cost(0, 0, "yes", 25) + lmsr.trade_cost(25, 0, "yes", 35)
    assert one == pytest.approx(two)
    assert one == pytest.approx(lmsr.cost(60, 0) - lmsr.cost(0, 0))
    assert 30 < one < 60  # cheaper than certainty, dearer than the opening price


def test_selling_back_returns_what_buying_cost():
    paid = lmsr.trade_cost(10, 5, "no", 40)
    back = -lmsr.trade_cost(10, 45, "no", -40)
    assert paid == pytest.approx(back)


def test_market_maker_loses_at_most_b_ln2():
    # Someone buys a huge yes position and yes happens: maker's loss = payout - collected <= b ln 2.
    shares = 5000
    collected = lmsr.trade_cost(0, 0, "yes", shares)
    assert shares - collected <= B * math.log(2) + 1e-9


def test_cost_is_stable_for_large_positions():
    assert math.isfinite(lmsr.cost(1e5, 0)) and lmsr.price_yes(1e5, 0) == pytest.approx(1.0)


@pytest.mark.parametrize("p", [0.1, 0.3, 0.5, 0.8, 0.97])
def test_shares_to_reach_lands_on_the_target(p):
    side, s = lmsr.shares_to_reach(20, 50, p)
    y, n = (20 + s, 50) if side == "yes" else (20, 50 + s)
    assert lmsr.price_yes(y, n) == pytest.approx(p)


# ---------------- Book: trades, settlement, Brier ----------------


def market(model_p=0.7, hour=15):
    m = book.Book(clock=12)
    m.add(book.Question("q", target_hour=hour, model_p=model_p))
    return m


def test_buy_spends_points_and_sell_refunds_them():
    m = market()
    paid = m.buy("ada", "q", "yes", 50)
    assert m.points["ada"] == pytest.approx(book.START_POINTS - paid)
    got = m.sell("ada", "q", "yes", 50)
    assert got == pytest.approx(paid) and m.points["ada"] == pytest.approx(book.START_POINTS)
    assert m.price("q") == pytest.approx(0.5)


def test_rules_reject_bad_trades():
    m = market()
    with pytest.raises(ValueError, match="out of range"):
        m.buy("ada", "q", "yes", book.MAX_SHARES + 1)
    with pytest.raises(ValueError, match="cannot sell"):
        m.sell("ada", "q", "yes", 1)
    m.points["poor"] = 1.0
    with pytest.raises(ValueError, match="not enough points"):
        m.buy("poor", "q", "yes", 100)
    m.clock = 15
    with pytest.raises(ValueError, match="closed"):
        m.buy("ada", "q", "no", 1)


def test_model_trades_towards_its_probability_with_a_cap():
    m = market(model_p=0.7)
    m.model_trade("q")
    assert m.price("q") == pytest.approx(0.7)
    far = market(model_p=0.999)
    far.model_trade("q")
    assert far.positions[(book.MODEL, "q")]["yes"] == pytest.approx(book.MODEL_MAX_SHARES)
    assert far.price("q") < 0.999


def test_settlement_pays_one_point_per_winning_share_only_after_the_hour():
    m = market(hour=15)
    a = m.buy("ada", "q", "yes", 100)
    b = m.buy("bob", "q", "no", 40)
    assert m.tick(15, {"q": True}) == []  # the 15:00 hour has not passed yet
    room_p = m.price("q")
    assert m.tick(16, {"q": True}) == ["q"]
    assert m.points["ada"] == pytest.approx(book.START_POINTS - a + 100)
    assert m.points["bob"] == pytest.approx(book.START_POINTS - b)
    assert m.questions["q"].room_p == pytest.approx(room_p)
    assert m.tick(17, {"q": False}) == []  # settles once
    assert m.points["ada"] == pytest.approx(book.START_POINTS - a + 100)


def test_points_are_conserved_up_to_the_makers_bounded_loss():
    m = market(hour=13)
    m.model_trade("q")
    m.buy("ada", "q", "no", 120)
    m.buy("bob", "q", "yes", 30)
    m.sell("ada", "q", "no", 20)
    m.tick(14, {"q": False})
    players_net = sum(m.points.values()) - book.START_POINTS * len(m.points)
    assert players_net <= B * math.log(2) + 1e-9  # what players win in total is what the maker loses


def test_brier_for_room_and_model():
    m = book.Book(clock=12)
    m.add(book.Question("a", 13, model_p=0.8))
    m.add(book.Question("b", 14, model_p=0.4))
    m.buy("ada", "a", "no", 100)  # room thinks a is unlikely
    room_a = m.price("a")
    m.tick(15, {"a": True, "b": False})
    s = m.brier()
    assert s["n"] == 2
    assert s["model"] == pytest.approx(((0.8 - 1) ** 2 + 0.4**2) / 2)
    assert s["room"] == pytest.approx(((room_a - 1) ** 2 + 0.5**2) / 2)
    assert book.Book().brier() == {"room": None, "model": None, "n": 0}


def test_module_constants_match_the_reference_book():
    ts = MODULE.read_text()
    for name in ("START_POINTS", "MAX_SHARES", "MODEL_MAX_SHARES"):
        assert float(re.search(rf"^const {name} = ([\d.]+);", ts, re.M).group(1)) == getattr(book, name)


# ---------------- Questions ----------------


def test_prob_above_goes_through_the_quantiles_and_is_monotone():
    assert questions.prob_above(100, 50, 100, 200) == pytest.approx(0.5)
    assert questions.prob_above(50, 50, 100, 200) == pytest.approx(0.9)
    assert questions.prob_above(200, 50, 100, 200) == pytest.approx(0.1)
    xs = np.linspace(0, 400, 50)
    ps = [questions.prob_above(x, 50, 100, 200) for x in xs]
    assert all(a >= b for a, b in zip(ps, ps[1:])) and min(ps) >= questions.P_FLOOR and max(ps) <= questions.P_CEIL


def replay_day():
    hours = pd.date_range("2026-10-26", periods=24, freq="h", tz="UTC")
    def series(zone, target, unit, actual, p50):
        return {"zone": zone, "target": target, "unit": unit, "points": [
            {"ts": t.isoformat(), "actual": actual, "p10": p50 * 0.5, "p50": p50, "p90": p50 * 1.5,
             "made_at": "2026-10-26T06:00:00+00:00"} for t in hours]}
    return {"event": "2026-10-26", "series": [
        series("GB", "price_da", "GBP/MWh", 190.0, 101.0), series("GB", "gb_system_price", "GBP/MWh", 90.0, 181.0),
        series("DE-LU", "price_da", "EUR/MWh", 243.0, 163.0), series("FR", "price_da", "EUR/MWh", 151.0, 78.0),
    ]}


def boalf_history(today_mwh=4000.0):
    ts = pd.date_range("2026-09-20", "2026-10-26 23:00", freq="h", tz="UTC")
    v = np.where(ts.normalize() == pd.Timestamp("2026-10-26", tz="UTC"), today_mwh,
                 np.where(ts.day % 2 == 0, 3000.0, 1000.0))
    return pd.DataFrame({"ts": ts, "value": v})


def test_price_questions_use_a_round_threshold_near_the_median_and_hide_nothing_they_should_not():
    qs = questions.price_questions(replay_day())
    gb = next(q for q in qs if q.id == "GB-price_da-18")
    assert gb.threshold == 100 and gb.target_hour == 18 and gb.outcome is True and gb.actual == 190
    assert gb.text == "Will Britain's day-ahead price be above £100/MWh at 18:00?"
    assert 0.45 < gb.model_p < 0.55 and "12 h ahead" in gb.model_note
    sp = next(q for q in qs if q.id == "GB-gb_system_price-15")
    assert sp.outcome is False and "system price" in sp.text
    pub = questions.public(gb)
    assert "outcome" not in pub and "actual" not in pub and pub["model_p"] == gb.model_p


def test_wind_question_is_history_based_and_says_so():
    q = questions.wind_question(pd.Timestamp("2026-10-26", tz="UTC"), boalf_history(4000.0), end_hour=18)
    # past days to 18:00: 18 x 3 GWh = 54 or 18 x 1 GWh = 18 GWh, half each; today 72 GWh
    assert q.unit == "GWh" and q.target_hour == 18 and q.actual == pytest.approx(72.0)  # settles when its window ends (#303)
    assert q.outcome is True and "History only, not a forecast" in q.model_note
    assert 0 < q.model_p < 1


def test_build_orders_questions_by_settling_hour_and_feed_reports_the_hour():
    r = replay_day()
    qs = questions.build(r, boalf_history(), end_hour=18)
    assert [q.target_hour for q in qs] == sorted(q.target_hour for q in qs) and len(qs) == 5
    feed = questions.feed(r, boalf_history(), 14)
    labels = {f["label"]: f["value"] for f in feed}
    assert labels["GB day-ahead price"] == 190.0 and labels["GB wind switched off so far"] == pytest.approx(60.0)  # hours 00 to 14 inclusive


# ---------------- Runner ----------------


class FakeClient:
    def __init__(self):
        self.calls = []

    def call(self, name, *args):
        self.calls.append((name, args))


def test_runner_starts_a_round_and_ticks_to_the_end(monkeypatch):
    monkeypatch.setattr(runner.replay, "load", lambda day: replay_day())
    monkeypatch.setattr(runner, "boalf_gb", lambda: boalf_history())
    c = FakeClient()
    ids = runner.run(c, date(2026, 10, 26), start=12, end=18, seconds=30, sleep=lambda s: None)
    name, args = c.calls[0]
    assert name == "market_start" and len(args) == 8
    title, b, start, end, secs, qs, answers, day = args
    assert (b, start, end, secs, day) == (lmsr.B, 12, 18, 30, "2026-10-26") and "date stays hidden" in title
    assert [q["id"] for q in qs] == ids and all("outcome" not in q for q in qs)
    assert {a["question_id"] for a in answers} == set(ids)
    ticks = [a[0] for n, a in c.calls[1:]]
    assert ticks == list(range(13, 20)) and all(n == "market_tick" for n, _ in c.calls[1:])


def test_module_bot_specs_match_the_reference():
    ts = MODULE.read_text()
    rows = re.findall(r"\{ name: '(\w+)', title: '([^']+)', method: '([^']+)', kelly: ([\d.]+) \}", ts)
    assert [{"name": n, "title": t, "method": m, "kelly": float(k)} for n, t, m, k in rows] == bots.specs()
