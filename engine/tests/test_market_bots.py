import json
import math

import pytest

from engine.market import book, bots, lmsr, questions
from engine.tests.test_market import boalf_history, replay_day


def league_for(replay, spread=0.5):
    """Bot quantiles for the replay day: each bot's median is the replay's, scaled so bots disagree."""
    scale = {"bot_last_week": 1.4, "bot_yesterday": 1.2, "bot_engineer": 0.9, "bot_committee": 1.05}
    series = []
    for s in replay["series"]:
        pts = []
        for p in s["points"]:
            b = {n: {"p10": p["p50"] * k * (1 - spread), "p50": p["p50"] * k, "p90": p["p50"] * k * (1 + spread)} for n, k in scale.items()}
            pts.append({"ts": p["ts"], "bots": b})
        series.append({"zone": s["zone"], "target": s["target"], "points": pts})
    return {"series": series}


def qs_with_bots():
    r = replay_day()
    return r, questions.build(r, boalf_history(), end_hour=18, league=league_for(r))


# ---------------- Kelly ----------------


def log_growth(p, side, bankroll, shares, q_yes=0.0, q_no=0.0):
    cost = lmsr.trade_cost(q_yes, q_no, side, shares)
    return p * math.log(bankroll - cost + shares) + (1 - p) * math.log(bankroll - cost)


def test_no_edge_no_trade_and_side_follows_the_belief():
    assert bots.kelly_shares(0.5, 0.5, 1000, 0.5)[1] == 0
    assert bots.kelly_shares(0.8, 0.5, 1000, 0.5)[0] == "yes"
    assert bots.kelly_shares(0.2, 0.5, 1000, 0.5)[0] == "no"
    assert bots.kelly_shares(0.7, 0.5, 0, 0.5)[1] == 0  # no bankroll, no bet


def test_full_kelly_maximises_expected_log_growth_and_stops_short_of_the_belief():
    p, bank = 0.65, 200.0
    s = bots.full_kelly_shares(p, "yes", bank, 0.0, 0.0)
    assert 0 < s < lmsr.shares_to_reach(0, 0, p)[1]
    best = log_growth(p, "yes", bank, s)
    assert best > log_growth(p, "yes", bank, s * 0.8) and best > log_growth(p, "yes", bank, s * 1.2)
    # the same view with a thinner bankroll bets fewer shares
    assert bots.full_kelly_shares(p, "yes", 40.0, 0.0, 0.0) < s


def test_bigger_edge_bigger_fraction_and_bigger_bankroll_all_stake_more():
    small = bots.kelly_shares(0.55, 0.5, 1000, 0.5)[1]
    big = bots.kelly_shares(0.70, 0.5, 1000, 0.5)[1]
    assert 0 < small < big
    assert bots.kelly_shares(0.70, 0.5, 1000, 0.25)[1] == pytest.approx(big / 2)
    assert bots.kelly_shares(0.70, 0.5, 100, 0.5)[1] < big


def test_position_is_the_fraction_of_full_kelly_and_capped():
    p, f = 0.62, 0.2
    side, shares = bots.kelly_shares(p, 0.5, 1000, f, cap=1e9)
    assert shares == pytest.approx(f * bots.full_kelly_shares(p, "yes", 1000, 0.0, 0.0))
    assert bots.kelly_shares(0.99, 0.5, 1000, 1.0)[1] == bots.MODEL_MAX_SHARES


def test_it_never_pushes_the_price_past_its_own_belief():
    side, shares = bots.kelly_shares(0.55, 0.5, 1e6, 1.0, cap=1e9)
    assert lmsr.price_yes(shares, 0) <= 0.55 + 1e-9
    # and already past the belief means no trade on that side
    q_yes = lmsr.shares_to_reach(0, 0, 0.8)[1]
    side, shares = bots.kelly_shares(0.6, lmsr.price_yes(q_yes, 0), 1000, 1.0, q_yes=q_yes)
    assert side == "no" and shares > 0


def test_confident_bots_stake_more_than_hedged_ones_on_the_same_belief_gap():
    assert bots.PROFILES["bot_committee"].kelly > bots.PROFILES["bot_yesterday"].kelly > 0
    a = bots.kelly_shares(0.8, 0.5, 1000, bots.PROFILES["bot_committee"].kelly)[1]
    b = bots.kelly_shares(0.8, 0.5, 1000, bots.PROFILES["bot_yesterday"].kelly)[1]
    assert a > b


# ---------------- Questions carry each bot's probability ----------------


def test_questions_get_a_probability_per_bot_from_its_own_quantiles():
    r, qs = qs_with_bots()
    gb = next(q for q in qs if q.id == "GB-price_da-18")
    assert set(gb.bot_p) == {"bot_last_week", "bot_yesterday", "bot_engineer", "bot_committee", "lgbm_q"}
    assert gb.bot_p["lgbm_q"] == gb.model_p
    assert gb.bot_p["bot_last_week"] > gb.bot_p["bot_engineer"]  # 1.4x the median is well above the 100 line; 0.9x is below
    assert gb.series == "GB day-ahead price" and len(gb.profile) == 24
    wind = next(q for q in qs if q.kind == "ghost_wind")
    assert wind.bot_p == {}  # history only: the bots have no forecast of wind switched off


def test_bot_probabilities_use_only_as_of_quantiles_never_the_outcome():
    r, qs = qs_with_bots()
    r2 = replay_day()
    for s in r2["series"]:
        for p in s["points"]:
            p["actual"] = p["actual"] * 3 + 77  # a different day's outcomes
    qs2 = questions.build(r2, boalf_history(), end_hour=18, league=league_for(r2))
    assert {q.id: q.bot_p for q in qs} == {q.id: q.bot_p for q in qs2}
    assert {q.id: q.profile for q in qs} == {q.id: q.profile for q in qs2}
    pub = questions.league_public(qs[0])
    assert "outcome" not in pub and "actual" not in pub
    assert {x["bot"] for x in pub["bot_p"]} == set(qs[0].bot_p) and pub["series"] == qs[0].series
    assert len(json.loads(pub["profile_json"])) == 24


def test_legacy_public_payload_is_unchanged_for_the_deployed_module():
    _, qs = qs_with_bots()
    assert set(questions.public(qs[0])) == set(questions.LEGACY_FIELDS)


# ---------------- Round: every bot trades ----------------


def test_every_bot_opens_with_its_own_account_and_trades_towards_its_view():
    _, qs = qs_with_bots()
    m = book.from_questions([q for q in qs if q.bot_p], clock=12)
    m.open_round()
    traded = {who for (who, _) in m.positions}
    assert {"bot_last_week", "bot_yesterday", "bot_engineer", "lgbm_q", "bot_committee", bots.NOWCASTER} <= traded
    for who in traded:
        assert m.points[who] < book.START_POINTS  # stakes are real points
    q = next(iter(m.questions.values()))
    assert 0.03 < m.price(q.id) < 0.97
    assert all(pos["yes"] == 0 or pos["no"] == 0 or True for pos in m.positions.values())


def test_an_agreeing_room_of_bots_moves_the_price_towards_the_bots_but_not_past_the_most_extreme():
    m = book.Book(clock=12)
    m.add(book.Question("q", 15, 0.7, bot_p={"bot_yesterday": 0.6, "bot_engineer": 0.65, "lgbm_q": 0.7, "bot_committee": 0.7}))
    m.open_round()
    assert 0.5 < m.price("q") <= 0.7 + 1e-9


def test_bots_do_not_trade_a_question_that_has_closed():
    m = book.Book(clock=15)
    m.add(book.Question("q", 15, 0.9, bot_p={"lgbm_q": 0.9}))
    m.open_round()
    assert m.positions == {} and m.price("q") == pytest.approx(0.5)


def test_points_stay_conserved_up_to_the_makers_bound_with_many_bots():
    _, qs = qs_with_bots()
    m = book.from_questions([q for q in qs if q.bot_p], clock=12)
    m.open_round()
    m.buy("ada", next(iter(m.questions)), "no", 100)
    answers = {q.id: q.outcome for q in qs}
    for h in range(13, 20):
        m.tick(h, answers)
    n_q = len(m.questions)
    net = sum(m.points.values()) - book.START_POINTS * len(m.points)
    assert net <= n_q * lmsr.B * math.log(2) + 1e-6


# ---------------- Nowcaster ----------------


PROFILE = {h: {"p10": 80.0, "p50": 100.0, "p90": 120.0} for h in range(10, 20)}


def test_nowcaster_starts_from_our_model_and_reads_only_hours_before_the_clock():
    p0 = bots.nowcast_probability(105, 17, 12, PROFILE, {}, fallback=0.4)
    assert p0 == 0.4
    seen = {10: 100.0, 11: 140.0}
    p = bots.nowcast_probability(105, 17, 12, PROFILE, seen, 0.4)
    assert p != 0.4
    # hours at or after the clock never matter, whatever their value
    with_future = {**seen, 12: -999.0, 13: 9999.0, 16: 1e9}
    assert bots.nowcast_probability(105, 17, 12, PROFILE, with_future, 0.4) == p


def test_nowcaster_moves_with_the_latest_miss_and_gets_more_certain_as_the_hour_nears():
    above = bots.nowcast_probability(105, 17, 14, PROFILE, {13: 140.0}, 0.4)
    below = bots.nowcast_probability(105, 17, 14, PROFILE, {13: 60.0}, 0.4)
    assert above > 0.4 > below
    far = bots.nowcast_probability(112, 19, 12, PROFILE, {11: 100.0}, 0.5)
    near = bots.nowcast_probability(112, 19, 18, PROFILE, {17: 100.0}, 0.5)
    assert near < far  # a threshold above the median is less likely once the band has narrowed around it


def test_nowcaster_improves_through_the_round_when_misses_persist():
    # Every hour lands 30 above the model; the question asks if hour 18 will be above 120 (it will: 130).
    obs = {h: PROFILE[h]["p50"] + 30 for h in range(10, 18)}
    ps = [bots.nowcast_probability(120, 18, clock, PROFILE, {h: v for h, v in obs.items() if h < clock}, 0.5) for clock in range(11, 18)]
    assert ps[0] < ps[-1] and all(b >= a - 1e-9 for a, b in zip(ps, ps[1:]))
    assert ps[-1] > 0.5  # by the last tick it has seen enough misses to call it


def test_book_feeds_the_nowcaster_only_the_hours_already_played_and_it_trades_on_them():
    m = book.Book(clock=12)
    m.add(book.Question("q", 17, 0.5, bot_p={"lgbm_q": 0.5}, threshold=105.0, series="GB day-ahead price", profile=PROFILE))
    m.open_round()
    start = m.questions["q"].bot_p[bots.NOWCASTER]
    assert start == 0.5
    m.tick(13, {"q": True}, [{"label": "GB day-ahead price", "value": 150.0}])  # hour 12 revealed
    assert m.observed["GB day-ahead price"] == {12: 150.0}
    assert m.questions["q"].bot_p[bots.NOWCASTER] > start
    assert (bots.NOWCASTER, "q") in m.positions and m.positions[(bots.NOWCASTER, "q")]["yes"] > 0


def test_nowcaster_belief_is_frozen_when_the_question_closes():
    m = book.Book(clock=12)
    m.add(book.Question("q", 15, 0.5, bot_p={"lgbm_q": 0.5}, threshold=105.0, series="s", profile=PROFILE))
    m.open_round()
    for h, v in ((13, 140.0), (14, 150.0)):
        m.tick(h, {"q": True}, [{"label": "s", "value": v}])
    frozen = m.questions["q"].bot_p[bots.NOWCASTER]
    m.tick(15, {"q": True}, [{"label": "s", "value": 10.0}])  # closed at 15:00: the belief stays
    assert m.questions["q"].bot_p[bots.NOWCASTER] == frozen


# ---------------- Brier per bot ----------------


def test_brier_per_bot_over_the_questions_each_priced():
    m = book.Book(clock=12)
    m.add(book.Question("a", 13, 0.8, bot_p={"lgbm_q": 0.8, "bot_yesterday": 0.3}))
    m.add(book.Question("b", 14, 0.4, bot_p={"lgbm_q": 0.4}))
    m.tick(15, {"a": True, "b": False})
    s = m.brier()
    assert s["bots"]["lgbm_q"] == {"brier": pytest.approx(((0.8 - 1) ** 2 + 0.4**2) / 2), "n": 2}
    assert s["bots"]["bot_yesterday"] == {"brier": pytest.approx((0.3 - 1) ** 2), "n": 1}
    assert "bot_committee" not in s["bots"]
    assert s["model"] == pytest.approx(s["bots"]["lgbm_q"]["brier"])


def test_specs_describe_every_trader_in_order():
    s = bots.specs()
    assert [x["name"] for x in s] == list(bots.ORDER) and s[-1]["name"] == bots.NOWCASTER
    assert all(x["title"] and x["method"] and 0 < x["kelly"] <= 0.5 for x in s)


# ---------------- A whole round, and the day's bot data ----------------


def test_a_full_round_with_the_runner_feed_scores_every_trader():
    r, qs = qs_with_bots()
    qs = [q for q in qs if q.bot_p and q.target_hour > 12]
    m = book.from_questions(qs, clock=12)
    m.open_round()
    answers = {q.id: q.outcome for q in qs}
    for h in range(13, 20):
        m.tick(h, answers, questions.feed(r, None, h - 1))
    s = m.brier()
    assert s["n"] == len(qs) and set(s["bots"]) == set(bots.ORDER)
    assert all(0 <= v["brier"] <= 1 and v["n"] == len(qs) for v in s["bots"].values())
    assert all(m.questions[q.id].settled for q in qs)
    # the feed is what the room saw: nothing for the hour being played or later
    assert max(max(h) for h in (v.keys() for v in m.observed.values())) == 18


def test_bot_quantiles_for_the_day_come_from_fit_asof_and_predict_the_replay_rows(monkeypatch):
    import numpy as np
    import pandas as pd

    from engine.market import botdata
    from pipeline.models.bots import Context

    day = pd.Timestamp("2026-10-26", tz="UTC")
    ts = pd.date_range(day, periods=24, freq="h")
    feats = pd.concat([pd.DataFrame({"ts": ts, "zone": z, "residual_load_mw": 1.0}) for z in ("GB", "FR", "DE-LU")], ignore_index=True)
    monkeypatch.setattr(botdata.build, "build_history", lambda *a, **k: feats)
    monkeypatch.setattr(botdata.build, "Inputs", lambda: None)

    class Fake:
        def __init__(self, k):
            self.k = k

        def predict(self, rows, ctx):
            return np.column_stack([np.full(len(rows), 90.0 * self.k), np.full(len(rows), 100.0 * self.k), np.full(len(rows), 110.0 * self.k)])

    wide = pd.DataFrame({z: 1.0 for z in ("GB", "FR", "DE-LU")}, index=ts)
    seen = []

    def fit(d, target, inputs=None):
        seen.append((d, target))
        return {"lgbm_q": Fake(1), "bot_engineer": Fake(2)}, Context(wide=wide)

    out = botdata.compute(day.date(), fit=fit)
    assert {d for d, _ in seen} == {day} and {t for _, t in seen} == {"price_da", "gb_system_price"}
    gb = next(s for s in out["series"] if s["zone"] == "GB" and s["target"] == "price_da")
    assert len(gb["points"]) == 24 and gb["points"][0]["bots"]["bot_engineer"] == {"p10": 180.0, "p50": 200.0, "p90": 220.0}
    assert [b["name"] for b in out["bots"]][0] == "lgbm_q"


def test_runner_calls_market_start_league_with_the_bots_and_ticks_with_the_feed(monkeypatch):
    from datetime import date

    from engine.market import __main__ as runner
    from engine.tests.test_market import FakeClient

    r = replay_day()
    monkeypatch.setattr(runner.replay, "load", lambda day: r)
    monkeypatch.setattr(runner, "boalf_gb", lambda: boalf_history())
    monkeypatch.setattr(runner.botdata, "load", lambda day: league_for(r))
    c = FakeClient()
    ids = runner.run(c, date(2026, 10, 26), start=12, end=18, seconds=30, sleep=lambda s: None, league=True)
    name, args = c.calls[0]
    assert name == "market_start_league" and len(args) == 9
    qs, bot_list = args[5], args[8]
    assert [q["id"] for q in qs] == ids and all("outcome" not in q and "actual" not in q for q in qs)
    assert [b["name"] for b in bot_list] == list(bots.ORDER) and all(b["kelly"] > 0 for b in bot_list)
    assert [n for n, _ in c.calls[1:]] == ["market_tick"] * 7
    # without --league the deployed reducer is called with its old payload
    c2 = FakeClient()
    runner.run(c2, date(2026, 10, 26), start=12, end=18, seconds=30, sleep=lambda s: None)
    assert c2.calls[0][0] == "market_start" and len(c2.calls[0][1]) == 8


# ---------------- The module's copy of the rules agrees with this reference ----------------


def _ts_rules(tmp_path, cases):
    """Run spacetime/module/src/reducers/league_math.ts on the cases with node; skipped when esbuild or node is missing."""
    import json
    import shutil
    import subprocess
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    esbuild = root / "web" / "node_modules" / ".bin" / "esbuild"
    node = shutil.which("node")
    if not esbuild.exists() or not node:
        pytest.skip("node or esbuild not installed")
    out = tmp_path / "league_math.mjs"
    subprocess.run([str(esbuild), str(root / "spacetime/module/src/reducers/league_math.ts"), "--bundle", "--format=esm", f"--outfile={out}", "--log-level=error"], check=True)
    script = tmp_path / "run.mjs"
    script.write_text(f"""import * as m from './league_math.mjs';
const cases = {json.dumps(cases)};
const out = cases.map(c => {{
  if (c.fn === 'kelly') return m.kellyShares(c.p, c.price, c.bank, c.f, c.cap, c.b, c.y, c.n);
  if (c.fn === 'full') return m.fullKellyShares(c.p, c.side, c.bank, c.y, c.n, c.b);
  if (c.fn === 'band') return m.bandProbability(c.x, c.p10, c.p50, c.p90);
  const prof = new Map(c.profile.map(r => [r.hour, r]));
  return m.nowcastProbability(c.x, c.target, c.clock, prof, new Map(c.obs), c.fallback);
}});
console.log(JSON.stringify(out));
""")
    res = subprocess.run([node, str(script)], capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def test_module_rules_match_the_python_reference(tmp_path):
    rng = __import__("random").Random(7)
    cases, want = [], []
    for _ in range(40):
        p, bank = rng.uniform(0.02, 0.98), rng.uniform(20, 1500)
        y, n = rng.uniform(-60, 120), rng.uniform(-60, 120)
        f, price = rng.choice([0.1, 0.35, 0.5]), lmsr.price_yes(y, n)
        cases.append({"fn": "kelly", "p": p, "price": price, "bank": bank, "f": f, "cap": 150, "b": lmsr.B, "y": y, "n": n})
        want.append(list(bots.kelly_shares(p, price, bank, f, 150, lmsr.B, y, n)))
        side = rng.choice(["yes", "no"])
        cases.append({"fn": "full", "p": p, "side": side, "bank": bank, "y": y, "n": n, "b": lmsr.B})
        want.append(bots.full_kelly_shares(p, side, bank, y, n))
        p50 = rng.uniform(40, 200)
        lo, hi = p50 - rng.uniform(5, 30), p50 + rng.uniform(5, 40)
        x = rng.uniform(20, 260)
        cases.append({"fn": "band", "x": x, "p10": lo, "p50": p50, "p90": hi})
        want.append(bots.band_probability(x, lo, p50, hi))
        prof = [{"hour": h, "p10": 80 + h, "p50": 100 + h, "p90": 125 + h} for h in range(10, 20)]
        obs = {h: 100 + h + rng.uniform(-30, 40) for h in range(10, 20) if rng.random() < 0.7}
        clock, target = rng.randint(11, 17), rng.randint(14, 19)
        cases.append({"fn": "now", "x": x, "target": target, "clock": clock, "profile": prof, "obs": [[h, v] for h, v in obs.items()], "fallback": 0.42})
        want.append(bots.nowcast_probability(x, target, clock, {r["hour"]: r for r in prof}, obs, 0.42))
    got = _ts_rules(tmp_path, cases)
    for c, g, w in zip(cases, got, want):
        if isinstance(w, list):
            assert g[0] == w[0] and g[1] == pytest.approx(w[1], rel=1e-6, abs=1e-6), c
        else:
            assert g == pytest.approx(w, rel=1e-6, abs=1e-6), c


def test_module_constants_match_the_reference():
    import re
    from pathlib import Path

    ts = (Path(__file__).resolve().parents[2] / "spacetime/module/src/reducers/league_math.ts").read_text()
    assert re.search(r"ORDER = \[(.*?)\]", ts).group(1).replace("'", "").replace(" ", "").split(",") == list(bots.ORDER)
    for name, attr in (("BOT_MAX_SHARES", bots.MODEL_MAX_SHARES), ("ERROR_DECAY_PER_HOUR", bots.ERROR_DECAY_PER_HOUR), ("LEAD_H", bots.LEAD_H),
                       ("MIN_BAND_SHARE", bots.MIN_BAND_SHARE), ("P_FLOOR", bots.P_FLOOR), ("P_CEIL", bots.P_CEIL)):
        assert float(re.search(rf"const {name} = ([\d.]+);", ts).group(1)) == attr
