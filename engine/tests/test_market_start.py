from dataclasses import dataclass
from datetime import date

import pytest

from engine.market import __main__ as market
from engine.market import questions


@dataclass
class Q:
    id: str
    target_hour: int
    outcome: bool = True
    actual: float = 1.0


class Recorder:
    def __init__(self):
        self.calls = []

    def call(self, reducer, *args):
        self.calls.append((reducer, args))


def _plan(monkeypatch, hours):
    qs = [Q(id=f"q{h}", target_hour=h) for h in hours]
    monkeypatch.setattr(market, "plan", lambda day, start, end: ({}, qs, None))
    monkeypatch.setattr(market.questions, "public", lambda q: {"id": q.id, "target_hour": q.target_hour})
    monkeypatch.setattr(market.questions, "feed", lambda r, b, hour: [])


def test_questions_at_or_before_the_start_hour_are_dropped(monkeypatch):
    _plan(monkeypatch, [12, 15, 16, 17, 18])
    client = Recorder()
    ids = market.run(client, date(2026, 10, 26), 16, 18, 0, sleep=lambda s: None)
    assert ids == ["q17", "q18"]
    reducer, args = client.calls[0]
    assert reducer == "market_start"
    assert [q["id"] for q in args[5]] == ["q17", "q18"]
    assert [a["question_id"] for a in args[6]] == ["q17", "q18"]


def test_a_start_after_every_question_is_refused_before_touching_the_module(monkeypatch):
    _plan(monkeypatch, [12, 13])
    client = Recorder()
    try:
        market.run(client, date(2026, 10, 26), 14, 18, 0, sleep=lambda s: None)
    except SystemExit:
        pass
    else:
        raise AssertionError("expected SystemExit")
    assert client.calls == []


def test_default_hours_are_kept_when_they_fit_the_round():
    assert [questions.fit_hour(h, 12, 18) for h in (13, 15, 17, 18)] == [13, 15, 17, 18]


@pytest.mark.parametrize("start,end", [(s, e) for s in range(0, 23) for e in range(s + 1, 24)])
def test_every_default_hour_lands_inside_the_round(start, end):
    for _, _, hour in questions.PRICE_QUESTIONS:
        assert start < questions.fit_hour(hour, start, end) <= end


def test_end_not_after_start_is_refused_before_touching_the_module(monkeypatch):
    _plan(monkeypatch, [13])
    client = Recorder()
    with pytest.raises(SystemExit):
        market.run(client, date(2026, 10, 26), 18, 18, 0, sleep=lambda s: None)
    assert client.calls == []


def test_reset_only_clears_the_round(monkeypatch):
    client = Recorder()
    monkeypatch.setattr(market, "from_env", lambda: client)
    monkeypatch.setattr("sys.argv", ["engine.market", "--reset"])
    market.main()
    assert client.calls == [("market_reset", ())]
