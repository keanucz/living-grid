import json
from datetime import date

import pandas as pd
import pytest

from engine import replay
from engine.market import __main__ as market
from engine.market import botdata, pool
from pipeline import cache
from pipeline.models import bots as league

DAY = date(2026, 10, 26)
ZONES = (("GB", "gb_system_price", "GBP/MWh"), ("GB", "price_da", "GBP/MWh"), ("FR", "price_da", "EUR/MWh"),
         ("DE-LU", "price_da", "EUR/MWh"), ("NL", "price_da", "EUR/MWh"), ("BE", "price_da", "EUR/MWh"),
         ("NO2", "price_da", "EUR/MWh"))


class Recorder:
    def __init__(self):
        self.calls = []

    def call(self, reducer, *args):
        self.calls.append((reducer, args))


def write_day(root, day, regime="calm", bots_file=True):
    d0 = pd.Timestamp(day, tz="UTC")
    series, bseries = [], []
    for i, (zone, target, unit) in enumerate(ZONES):
        pts, bpts = [], []
        for h in range(24):
            ts = d0 + pd.Timedelta(hours=h)
            mid = 60.0 + 7 * i + 3 * h
            pts.append({"ts": ts.isoformat(), "actual": mid + (9 if h % 2 else -9), "p10": mid - 15, "p50": mid, "p90": mid + 15,
                        "made_at": (ts - pd.Timedelta(hours=12)).isoformat(), "explanation": None})
            bpts.append({"ts": ts.isoformat(), "bots": {s["name"]: {"p10": mid - 20, "p50": mid + 1, "p90": mid + 20} for s in league.specs()}})
        series.append({"zone": zone, "target": target, "unit": unit, "points": pts})
        if target in league.TARGETS:
            bseries.append({"zone": zone, "target": target, "points": bpts})
    r = {"event": day.isoformat(), "title": "t", "trained_before": day.isoformat(), "series": series, "constraint_cost_gbp": 1.0, "summary": ""}
    if regime:
        r["regime"] = regime
    (root / f"{day.isoformat()}.json").write_text(json.dumps(r))
    if bots_file:
        b = {"event": day.isoformat(), "trained_before": day.isoformat(), "bots": league.specs(), "series": bseries}
        if regime:
            b["regime"] = regime
        (root / f"{day.isoformat()}.bots.json").write_text(json.dumps(b))


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.setattr(pool, "boalf_gb", lambda: None)
    r = tmp_path / "replay"
    r.mkdir()
    return r


def test_a_sound_day_becomes_a_pool_put_call(root):
    write_day(root, DAY, "windy")
    c = Recorder()
    assert pool.load(c, [DAY]) == ["2026-10-26"]
    (name, args), = c.calls
    row = dict(zip(["day", "regime", "start", "end", "qs", "ans", "feed", "clues"], args))
    assert name == "pool_put" and row["day"] == "2026-10-26" and row["regime"] == "windy" and (row["start"], row["end"]) == (12, 18)
    qs, ans = json.loads(row["qs"]), json.loads(row["ans"])
    assert qs and {q["id"] for q in qs} == {a["question_id"] for a in ans}
    assert all(12 < q["target_hour"] <= 18 for q in qs)
    assert any(q["bot_p"] for q in qs), "the bots' as-of probabilities travel with the questions"
    assert set(json.loads(row["feed"])) == {str(h) for h in range(12, 19)}
    assert set(json.loads(row["clues"])) <= {x["id"] for x in qs}


def test_the_pool_text_hides_outcomes_and_the_date(root):
    write_day(root, DAY)
    row = pool.day_row(DAY)
    public = row["questions_json"] + row["feed_json"].split('"clues"')[0]
    for q in json.loads(row["questions_json"]):
        assert "outcome" not in q and "actual" not in q
    assert "2026-10-26" not in row["questions_json"] and "2026-10" not in row["clues_json"]
    assert "outcome" in row["answers_json"] and public


def test_a_day_that_fails_its_checks_is_skipped_not_loaded(root):
    write_day(root, DAY)
    other = date(2026, 10, 27)
    write_day(root, other)
    broken = json.loads((root / "2026-10-27.bots.json").read_text())
    broken["series"][0]["points"][2]["actual"] = 5.0
    (root / "2026-10-27.bots.json").write_text(json.dumps(broken))
    c = Recorder()
    assert pool.load(c, [DAY, other, date(2026, 10, 28)]) == ["2026-10-26"]
    assert len(c.calls) == 1


def test_a_day_without_a_regime_is_refused(root):
    write_day(root, date(2026, 10, 27), regime=None)
    with pytest.raises(ValueError, match="regime"):
        pool.day_row(date(2026, 10, 27))
    write_day(root, DAY, regime=None)  # the headline day is known to be windy
    assert pool.day_row(DAY)["regime"] == "windy"


def test_no_bots_file_needs_the_explicit_flag(root):
    write_day(root, DAY, bots_file=False)
    with pytest.raises(ValueError):
        pool.day_row(DAY)
    row = pool.day_row(DAY, allow_no_bots=True)
    assert not any(q["bot_p"] for q in json.loads(row["questions_json"]))


def test_dry_run_sends_nothing_and_cli_routes_load_days(root, monkeypatch, capsys):
    write_day(root, DAY)
    monkeypatch.setattr("sys.argv", ["engine.market", "load-days", "--dry-run", "--days", "2026-10-26"])
    with pytest.raises(SystemExit) as e:
        market.main()
    assert e.value.code == 0 and "would load 1 days" in capsys.readouterr().out


def test_available_lists_the_replay_files(root):
    write_day(root, DAY)
    write_day(root, date(2026, 11, 2))
    assert pool.available() == [date(2026, 10, 26), date(2026, 11, 2)]
