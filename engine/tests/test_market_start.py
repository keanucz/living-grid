from dataclasses import dataclass
from datetime import date

from engine.market import __main__ as market


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
    monkeypatch.setattr(market, "plan", lambda day, end: ({}, qs, None))
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
