import copy
from datetime import date

import numpy as np
import pandas as pd
import pytest

from engine.market import library as lib

DAY = date(2026, 10, 26)
D0 = pd.Timestamp(DAY, tz="UTC")
HOURS = pd.date_range(D0 - pd.Timedelta(days=70), D0 + pd.Timedelta(hours=23), freq="h")


class Stub:
    def __init__(self, series):
        self.s = series

    def get(self, zone, series):
        return self.s.get((zone, series), pd.Series(dtype=float))


def diurnal(rng, base, amp, noise, peak=15):
    h = np.asarray(HOURS.hour)
    smooth = pd.Series(rng.normal(0, noise, len(HOURS))).rolling(18, min_periods=1).mean().to_numpy() * 3  # weather persists for hours
    return pd.Series(base + amp * np.cos((h - peak) / 24 * 2 * np.pi) + smooth, index=HOURS)


def make(seed=1):
    rng = np.random.default_rng(seed)
    flows = {("GB", f"flow_GB_{z}"): diurnal(rng, -300, 100, 80) for z in ("BE", "DK1", "FR", "IE", "NI", "NL", "NO2")}
    series = {("GB", "gen_wind"): diurnal(rng, 8000, 1500, 2500), ("DE-LU", "gen_solar"): diurnal(rng, 12000, 12000, 1500, peak=12).clip(lower=0), **flows}
    boalf = pd.Series(rng.gamma(2.0, 800, len(HOURS)), index=HOURS)
    return Stub(series), boalf


def replay_doc(seed=2):
    rng = np.random.default_rng(seed)
    series = []
    for zone, target, unit, base in (("GB", "price_da", "GBP/MWh", 90.0), ("DE-LU", "price_da", "EUR/MWh", 40.0), ("FR", "price_da", "EUR/MWh", 80.0)):
        pts = []
        for h in range(24):
            p50 = base + (6 if zone == "GB" else 25) * np.cos((h - 18) / 24 * 2 * np.pi) + (-45 if zone == "DE-LU" and 10 <= h <= 14 else 0)
            pts.append({"ts": (D0 + pd.Timedelta(hours=h)).isoformat(), "p10": p50 - 25, "p50": p50, "p90": p50 + 25,
                        "actual": p50 + rng.normal(0, 15), "made_at": (D0 + pd.Timedelta(hours=h - 12)).isoformat()})
        series.append({"zone": zone, "target": target, "unit": unit, "points": pts})
    return {"event": DAY.isoformat(), "series": series}


def build(replay=None, data=None, boalf=None):
    d, b = make()
    return lib.build(DAY, replay or replay_doc(), data or d, boalf if boalf is not None else b)


def test_library_has_8_to_12_uncertain_markets_each_with_a_source_and_history():
    d, b = make()
    ms = lib.build(DAY, replay_doc(), d, b)
    assert 7 <= len(ms) <= 12
    doc = lib.document(DAY, ms, 12, 18)
    for m in ms:
        assert m.method and m.source and lib.OPEN_RANGE[0] <= m.open_p <= lib.OPEN_RANGE[1]
        assert [h["hour"] for h in m.history] == list(range(12, m.target_hour + 1))
    assert {"price", "wind", "solar", "imports", "ghost_wind"} <= {m.kind for m in ms}
    assert len({m.id for m in ms}) == len(ms)
    assert not [e for e in lib.problems(doc) if "expected" not in e]


def test_no_actual_reaches_a_probability_before_its_hour():
    d, b = make()
    base = lib.build(DAY, replay_doc(), d, b)
    r2, d2 = replay_doc(), Stub({k: v.copy() for k, v in d.s.items()})
    for s in r2["series"]:
        for p in s["points"]:
            if pd.Timestamp(p["ts"]).hour >= 15:
                p["actual"] += 500
    for k in d2.s:
        d2.s[k][D0 + pd.Timedelta(hours=15):] += 99999
    b2 = b.copy()
    b2[D0 + pd.Timedelta(hours=15):] += 99999
    alt = lib.build(DAY, r2, d2, b2)
    by = {m.id: m for m in alt}
    checked = 0
    for m in base:
        if m.id not in by:
            continue
        for h0, h1 in zip(m.history, by[m.id].history, strict=False):
            if h0["hour"] <= 15:  # a reading at 15:00 can only matter from the 16:00 probability on
                assert h0["p"] == h1["p"], (m.id, h0["hour"])
                checked += 1
    assert checked >= 15


def test_public_part_has_no_outcome_and_problems_flags_a_leak():
    ms = build()
    lib.settle_history_markets(ms, make()[0], make()[1], D0)
    doc = lib.document(DAY, ms, 12, 18)
    assert all("outcome" not in m and "actual" not in m for m in doc["markets"])
    assert all(a["outcome"] is not None for a in doc["answers"])
    bad = copy.deepcopy(doc)
    bad["markets"][0]["outcome"] = True
    assert any("leaks" in e for e in lib.problems(bad))


def test_price_probability_follows_the_latest_miss_and_fades():
    r = replay_doc()
    pts = {pd.Timestamp(p["ts"]).hour: p for p in r["series"][0]["points"]}
    act = {h: p["actual"] for h, p in pts.items()}
    act[12] = pts[12]["p50"] + 40  # a big upside miss at 12:00
    act[11] = pts[11]["p50"] + 40  # the 11:00 reading is the last one visible when the clock reaches 12:00
    assert lib.band(pts, act, 12, 14)[1] == pytest.approx(pts[14]["p50"] + 40 * 0.5 ** 3)
    act[12] = pts[12]["p50"] + 40
    assert lib.band(pts, act, 13, 14)[1] == pytest.approx(pts[14]["p50"] + 40 * 0.25)
    assert lib.band(pts, act, 13, 18)[1] == pytest.approx(pts[18]["p50"] + 40 * 0.5 ** 6)
    assert lib.band(pts, {}, 13, 14)[1] == pts[14]["p50"]  # nothing observed: the forecast stands


def test_history_probability_rises_when_today_is_running_high():
    d, _ = make()
    wind = d.s[("GB", "gen_wind")].copy()
    wind[D0 + pd.Timedelta(hours=11)] = 20000
    high, _ = lib.analog_probability(lib.point(wind, 15), D0, 12, 8000, True)
    wind[D0 + pd.Timedelta(hours=11)] = 0
    low, _ = lib.analog_probability(lib.point(wind, 15), D0, 12, 8000, True)
    assert low < high


def test_markets_without_enough_history_are_left_out_not_invented():
    d, b = make()
    short = Stub({k: v[D0 - pd.Timedelta(days=5):] for k, v in d.s.items()})
    ms = lib.build(DAY, replay_doc(), short, b[D0 - pd.Timedelta(days=5):])
    assert not {m.kind for m in ms} & {"wind", "solar", "imports", "ghost_wind"}
    assert {m.id for m in ms} <= {"GB-da-up10-18", "GB-da-max", "DE-da-neg", "FR-da-13"}


def test_weather_source_markets_are_added_when_provided():
    class W:
        def markets(self, day, start, end):
            m = lib.Market("SCO-gust-50", "Gusts above 50 mph anywhere in Scotland before 18:00?", "weather", "GB", "mph", 50.0, "above", 18,
                           "ensemble forecast", "ensemble issued before the day", "n")
            m.history = [{"hour": h, "p": 0.4, "basis": "ensemble"} for h in range(start, 19)]
            m.outcome, m.actual = False, 41.0
            return [m]

    d, b = make()
    ms = lib.build(DAY, replay_doc(), d, b, weather=W())
    assert any(m.id == "SCO-gust-50" for m in ms)
