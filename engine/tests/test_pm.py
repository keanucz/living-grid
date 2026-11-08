import copy
import json
import shutil
import subprocess
from datetime import date
from pathlib import Path

import numpy as np
import pytest

from engine.pm import build
from engine.tests.test_beat import league_for
from engine.tests.test_choices import boalf_history, replay_day

ROOT = Path(__file__).resolve().parents[2]
HALF = 1


def clamp(c):
    return int(min(99, max(1, round(c))))


def quote(price):
    p = clamp(price)
    yb, ya = max(1, p - HALF), min(99, p + HALF)
    return {"yes_bid": yb, "yes_ask": ya, "no_bid": 100 - ya, "no_ask": 100 - yb}


def fill(price, side, action):
    q = quote(price)
    return q[f"{side}_{'ask' if action == 'buy' else 'bid'}"]


def bot_order(p, price, cash):
    yes = p - fill(price, "yes", "buy") / 100
    no = 1 - p - fill(price, "no", "buy") / 100
    side = "yes" if yes >= no else "no"
    edge = max(yes, no)
    if edge < 0.03:
        return None
    shares = min(300, int((cash * min(0.2, 1.5 * edge) * 100) // fill(price, side, "buy")))
    return (side, shares) if shares > 0 else None


def test_the_spread_is_the_only_cost_of_a_round_trip_and_no_mirrors_yes():
    for price in (1, 2, 30, 50, 97, 99):
        q = quote(price)
        assert q["yes_bid"] <= clamp(price) <= q["yes_ask"] and q["yes_ask"] - q["yes_bid"] <= 2 * HALF
        assert q["no_ask"] == 100 - q["yes_bid"] and q["no_bid"] == 100 - q["yes_ask"]
        # buying YES then selling it straight back loses the spread; so does the same with NO
        assert fill(price, "yes", "sell") - fill(price, "yes", "buy") == -(q["yes_ask"] - q["yes_bid"])
        assert fill(price, "no", "sell") - fill(price, "no", "buy") == -(q["no_ask"] - q["no_bid"])
        # a YES and a NO share bought together cost at least 100 (the spread is the house edge), never less
        assert fill(price, "yes", "buy") + fill(price, "no", "buy") >= 100


def test_buying_at_the_models_price_has_no_edge_after_the_spread_and_a_better_belief_does():
    """With true probability p the expected payout per share is p (YES) or 1 - p (NO) points: only a belief beyond the
    quote's spread is worth trading, which is how a player profits by beating the model's pricing."""
    price = 60
    ev_yes = lambda p: p - fill(price, "yes", "buy") / 100  # noqa: E731
    ev_no = lambda p: (1 - p) - fill(price, "no", "buy") / 100  # noqa: E731
    assert ev_yes(0.60) < 0 and ev_no(0.60) < 0  # the model is right: both sides lose the spread
    assert ev_yes(0.70) > 0 and ev_no(0.50) > 0


def test_bots_only_trade_with_an_edge_and_size_by_it():
    assert bot_order(0.60, 60, 1000) is None
    s, n = bot_order(0.80, 50, 1000)
    assert s == "yes" and n > 0
    s2, n2 = bot_order(0.20, 50, 1000)
    assert s2 == "no" and n2 > 0
    big = bot_order(0.95, 50, 1000)[1]
    assert big >= n and big * fill(50, "yes", "buy") / 100 <= 1000 * 0.2 + 1  # stake capped at 20% of points


def test_module_pricing_matches_the_reference(tmp_path):
    esbuild = ROOT / "web" / "node_modules" / ".bin" / "esbuild"
    node = shutil.which("node")
    if not esbuild.exists() or not node:
        pytest.skip("node or esbuild not installed")
    out = tmp_path / "pm_math.mjs"
    subprocess.run([str(esbuild), str(ROOT / "spacetime/module/src/pm_math.ts"), "--bundle", "--format=esm", f"--outfile={out}", "--log-level=error"], check=True)
    prices = [0, 1, 2, 17, 50, 83, 98, 99, 150]
    orders = [(p, pr, c) for p in (0.1, 0.3, 0.55, 0.7, 0.95) for pr in (5, 40, 60, 95) for c in (100, 1000)]
    script = tmp_path / "run.mjs"
    script.write_text(f"""import {{ quote, fill, botOrder, points, mark }} from './pm_math.mjs';
console.log(JSON.stringify({{ quotes: {json.dumps(prices)}.map(quote), fills: {json.dumps(prices)}.map(p => ['yes', 'no'].flatMap(s => ['buy', 'sell'].map(a => fill(p, s, a)))),
  orders: {json.dumps(orders)}.map(([p, pr, c]) => botOrder(p, pr, c)), pts: [points(3, 61), points(10, 49), points(7, 33)], marks: [mark(30, 'yes'), mark(30, 'no')] }}));
""")
    got = json.loads(subprocess.run([node, str(script)], capture_output=True, text=True, check=True).stdout)
    for price, q in zip(prices, got["quotes"]):
        assert q == quote(price)
    for price, f in zip(prices, got["fills"]):
        assert f == [fill(price, s, a) for s in ("yes", "no") for a in ("buy", "sell")]
    for (p, pr, c), o in zip(orders, got["orders"]):
        ref = bot_order(p, pr, c)
        assert (o and (o["side"], o["shares"])) == ref
    assert got["pts"] == [1.83, 4.9, 2.31] and got["marks"] == [30, 70]


# ---------------- the markets ----------------


def day5():
    r = replay_day(5)
    return r, boalf_history(), league_for(r)


def test_price_paths_move_with_the_hours_played_and_stay_in_one_to_ninety_nine_cents():
    r, boalf, league = day5()
    ms = build.markets(r, boalf, league)
    assert ms and all(m["close_hour"] > 12 for m in ms)
    for m in ms:
        assert set(m["prices"]) == {str(h) for h in range(12, m["close_hour"])}
        assert all(isinstance(p, int) and 1 <= p <= 99 for p in m["prices"].values())
        assert m["reasons"]["12"].startswith("Opening")
    build.validate(ms, 12, 18)


def test_the_price_at_an_hour_never_depends_on_that_hour_or_later():
    """Changing every actual at or after hour h must not change the price at h (nor anything before it)."""
    r, boalf, league = day5()
    base = {m["id"]: m for m in build.markets(r, boalf, league)}
    for h in (13, 14, 15, 16):
        other = copy.deepcopy(r)
        for s in other["series"]:
            for p in s["points"]:
                from pandas import Timestamp

                if Timestamp(p["ts"]).hour >= h:
                    p["actual"] = (p["actual"] or 0) * 3 + 50
        changed = {m["id"]: m for m in build.markets(other, boalf, league)}
        for mid, m in base.items():
            if mid not in changed or m["kind"] == "ghost_wind":
                continue
            for hh in range(12, h + 1):
                if str(hh) in m["prices"]:
                    assert m["prices"][str(hh)] == changed[mid]["prices"][str(hh)], (mid, h, hh)


def test_outcomes_come_from_the_actuals_and_prices_do_not():
    r, boalf, league = day5()
    a = build.markets(r, boalf, league)
    flipped = copy.deepcopy(r)
    for s in flipped["series"]:
        for p in s["points"]:
            p["actual"] = 10_000.0
    b = build.markets(flipped, boalf, league)
    ya = {m["id"]: m for m in a}
    assert any(ya[m["id"]]["outcome"] != m["outcome"] for m in b if m["id"] in ya)
    assert {m["id"]: m["prices"]["12"] for m in a} == {m["id"]: m["prices"]["12"] for m in b}  # the opening price is as-of


def test_without_bot_data_only_our_model_trades_and_a_thin_day_is_refused():
    r, boalf, _ = day5()
    ms = build.markets(r, boalf, None)
    assert all(set(m["bots"]) == {build.OUR_MODEL} for m in ms)
    with pytest.raises(ValueError):
        build.validate([], 12, 18)
    assert json.loads(build.payload(date(2026, 10, 26), r, boalf=boalf, league=league_for(r))[4])


def test_cents_clamps_to_one_to_ninety_nine():
    assert build.cents(0) == 1 and build.cents(1) == 99 and build.cents(0.504) == 50
