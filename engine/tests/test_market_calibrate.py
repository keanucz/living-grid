"""Opening prices calibrated on earlier replay days' residuals (#291): leakage-safe, line unchanged, raw fallback."""

import pandas as pd
import pytest

from engine.market import calibrate as cal
from engine.market import questions as q
from engine.pm import build as pm


def replay(day: str, bias: float = 0.0, p50: float = 100.0, spread: float = 40.0, zone: str = "GB", target: str = "price_da",
           unit: str = "GBP/MWh") -> dict:
    """One replay day: every hour's actual is p50 + bias, with an 80% range of `spread`."""
    pts = []
    for h in range(24):
        ts = pd.Timestamp(day, tz="UTC") + pd.Timedelta(hours=h)
        pts.append({"ts": ts.isoformat(), "made_at": (ts - pd.Timedelta(hours=30)).isoformat(), "actual": p50 + bias,
                    "p10": p50 - spread / 2, "p50": p50, "p90": p50 + spread / 2})
    return {"event": day, "series": [{"zone": zone, "target": target, "unit": unit, "points": pts}]}


EARLIER = [replay(f"2026-10-{d:02d}", bias=8.0) for d in range(1, 11)]  # always above the median


def test_afternoon_bias_raises_the_opening_probability_above_the_raw_model():
    c = cal.Calibration(EARLIER)
    raw = q.prob_above(100.0, 80.0, 100.0, 120.0)
    p, note = c.prob("GB", "price_da", 18, 100.0, 80.0, 100.0, 120.0, raw)
    assert raw == pytest.approx(0.5)
    assert p > 0.8, p
    assert "earlier" in note and "above our median" in note


def test_no_bias_leaves_the_probability_near_the_raw_model():
    c = cal.Calibration([replay(f"2026-10-{d:02d}", bias=b) for d in range(1, 11) for b in (-8.0, 8.0)][:10])
    raw = q.prob_above(100.0, 80.0, 100.0, 120.0)
    p, _ = c.prob("GB", "price_da", 18, 100.0, 80.0, 100.0, 120.0, raw)
    assert abs(p - raw) < 0.1


def test_only_days_strictly_before_the_mystery_day_are_used():
    later = [replay("2026-10-26", bias=-30.0), replay("2026-10-27", bias=-30.0)]
    c = cal.for_day(pd.Timestamp("2026-10-26"), EARLIER + later)
    assert c.days == len(EARLIER)
    p, _ = c.prob("GB", "price_da", 18, 100.0, 80.0, 100.0, 120.0, 0.5)
    assert p > 0.8, "a later (or the same) day's misses must not leak into the open"


def test_thin_history_falls_back_to_the_raw_model_and_says_so():
    c = cal.Calibration(EARLIER[:1])
    p, note = c.prob("GB", "price_da", 18, 100.0, 80.0, 100.0, 120.0, 0.5)
    assert p == 0.5 and "raw model" in note


def test_other_zones_and_series_do_not_borrow_each_others_residuals():
    c = cal.Calibration(EARLIER)
    p, note = c.prob("FR", "price_da", 13, 100.0, 80.0, 100.0, 120.0, 0.5)
    assert p == 0.5 and "raw model" in note


def test_price_question_keeps_the_line_at_the_median_and_opens_calibrated():
    day = replay("2026-10-26", bias=8.0, p50=101.0)
    raw = q.price_questions(day, asks=(("GB", "price_da", 18),))[0]
    got = q.price_questions(day, asks=(("GB", "price_da", 18),), calibration=cal.Calibration(EARLIER))[0]
    assert got.threshold == raw.threshold == 100.0
    assert got.model_p > raw.model_p + 0.2
    assert "earlier" in got.model_note


def test_pm_market_opens_at_the_calibrated_price_in_both_directions():
    day = replay("2026-10-26", bias=8.0)
    c = cal.Calibration(EARLIER)
    ms = pm.markets(day, calibration=c)
    assert ms, "the market should still be offered"
    for m in ms:
        open_ = m["prices"]["12"]
        assert (open_ > 75) if m["direction"] == "above" else (open_ < 25), m


def test_pm_markets_without_calibration_are_unchanged():
    day = replay("2026-10-26", bias=8.0)
    assert pm.markets(day) == pm.markets(day, calibration=None)
