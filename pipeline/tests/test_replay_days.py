import json
from datetime import date
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from pipeline import replay_days as rd

NAMES = ["Our model", "Yesterday", "Last week", "The Engineer", "The Committee"]


def fake_inputs(days=40, end="2026-11-07"):
    idx = pd.date_range(pd.Timestamp(end, tz="UTC") - pd.Timedelta(days=days), periods=days * 24, freq="h")
    wind = pd.DataFrame({"GB": np.repeat(np.arange(days) * 100.0, 24)}, index=idx)
    price = pd.DataFrame({"GB": 50.0}, index=idx)
    return SimpleNamespace(wind=wind, price=price)


def test_select_is_half_calm_half_windy_and_skips_the_headline():
    now = pd.Timestamp("2026-11-07T10:00Z")
    stats = rd.day_stats(fake_inputs(), now, weeks=6)
    picks = rd.select(stats, 12)
    assert len(picks) == 12 and len({p["day"] for p in picks}) == 12
    calm = [p for p in picks if p["regime"] == "calm"]
    windy = [p for p in picks if p["regime"] == "windy"]
    assert len(calm) == len(windy) == 6
    assert max(p["mean_wind_mw"] for p in calm) < min(p["mean_wind_mw"] for p in windy)
    assert date(2026, 10, 26) not in {p["day"] for p in picks}
    assert picks == rd.select(stats, 12)


def test_days_with_missing_prices_are_dropped():
    inp = fake_inputs()
    inp.price.iloc[-60:-50] = np.nan
    stats = rd.day_stats(inp, pd.Timestamp("2026-11-07T10:00Z"), weeks=6)
    assert pd.Timestamp("2026-11-04", tz="UTC") not in stats.index and len(stats) < 40


def write_pair(root, day, regime="calm", **bend):
    d0 = pd.Timestamp(day, tz="UTC")
    ts = [d0 + pd.Timedelta(hours=h) for h in range(24)]
    q = {"p10": 40.0, "p50": 50.0, "p90": 60.0}
    pts = [{"ts": t.isoformat(), "actual": 50.0, "made_at": (t - pd.Timedelta(hours=12)).isoformat(), **q} for t in ts]
    r = {"event": day, "trained_before": day, "regime": regime, "series": [{"zone": "GB", "target": "price_da", "points": pts}]}
    bp = [{"ts": t.isoformat(), "bots": {n: dict(q) for n in NAMES}} for t in ts]
    b = {"event": day, "trained_before": day, "regime": regime, "bots": [{"name": n} for n in NAMES],
         "series": [{"zone": "GB", "target": "price_da", "points": bp}]}
    if "leak" in bend:
        b["series"][0]["points"][3]["actual"] = 1.0
    if "late" in bend:
        r["series"][0]["points"][0]["made_at"] = r["series"][0]["points"][0]["ts"]
    if "missing_bot" in bend:
        del b["series"][0]["points"][5]["bots"]["Yesterday"]
    if "regime" in bend:
        del r["regime"]
    (root / f"{day}.json").write_text(json.dumps(r))
    (root / f"{day}.bots.json").write_text(json.dumps(b))


def test_check_accepts_a_sound_pair(tmp_path):
    write_pair(tmp_path, "2026-10-20")
    assert rd.check_day(date(2026, 10, 20), root=tmp_path) == []


@pytest.mark.parametrize("flaw", ["leak", "late", "missing_bot", "regime"])
def test_check_catches_flaws(tmp_path, flaw):
    write_pair(tmp_path, "2026-10-20", **{flaw: True})
    assert rd.check_day(date(2026, 10, 20), root=tmp_path)


def test_check_reports_a_missing_file(tmp_path):
    assert rd.check_day(date(2026, 10, 20), root=tmp_path)


def test_stamp_records_the_regime(tmp_path):
    p = tmp_path / "x.json"
    p.write_text('{"a": 1}')
    rd.stamp(p, "windy", 1234.5)
    assert json.loads(p.read_text()) == {"a": 1, "regime": "windy", "mean_gb_wind_mw": 1234.5}
