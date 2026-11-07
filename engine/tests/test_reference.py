import json
from pathlib import Path

import pytest

from engine.reference import research as r

FACTS_DIR = Path(r.__file__).resolve().parent / "facts"


def test_figures_normalises_thousands_and_keeps_decimals():
    assert r.figures("1,400 MW and 0.334 tCO2/MWh") == ["1400", "0.334"]
    assert r.figures("1 000 MW") == ["1000"]


def test_figures_handles_unit_glued_to_number():
    assert r.figures("1,000MW") == ["1000"]
    assert r.figures("1,075MW") == ["1075"]


def test_present_accepts_unit_scaling_and_rounding_only():
    assert r.present("6700", "a transfer capability of 6.7 GW")
    assert r.present("4000", "NESO states 4 GW")
    assert r.present("10.241337", "about 10.24 TWh curtailed")
    assert not r.present("0.20196", "56,100 kg/TJ")


def test_present_does_not_match_inside_longer_numbers():
    assert not r.present("20", "published in 2026")
    assert not r.present("1000", "21000 units")
    assert r.present("20", "almost 20% of trade")


def test_figures_ignores_years_when_the_answer_has_a_value():
    assert r.figures("8% of EU LNG imports in 2025 (report 2026)") == ["8"]
    assert r.figures("25 October 2026") == ["25"]
    assert r.figures("since 2021") == ["2021"]


def test_figures_falls_back_to_single_digits_when_nothing_longer():
    assert r.figures("2 requests per minute with a burst of 4") == ["2", "4"]
    assert r.figures("no numbers here") == []


def test_figures_deduplicates_and_caps():
    assert r.figures("10 10 11 12 13 14 15 16") == ["10", "11", "12", "13", "14", "15"]


def test_figure_check_reports_found_and_missing(monkeypatch):
    def fake_call(method, path, body=None, retries=5):
        assert path == "/v1/extract"
        return {"results": [{"excerpts": ["Capacity of 1,400 MW since 2021"]}]}
    monkeypatch.setattr(r, "call", fake_call)
    found, missing = r.figure_check("q", ["1400", "720"], ["https://example.org"])
    assert found == ["1400"] and missing == ["720"]


def test_figure_check_treats_fetch_failure_as_missing(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("down")
    monkeypatch.setattr(r, "call", boom)
    assert r.figure_check("q", ["1400"], ["https://example.org"]) == ([], ["1400"])


AGREE = {"agrees": True, "disagreement": "none"}


@pytest.mark.parametrize("cross, found, missing, figs, expected", [
    (None, [], [], ["1"], False),
    ({"agrees": False, "disagreement": "source says 1000"}, ["1400"], [], ["1400"], False),
    (AGREE, ["1400"], ["720"], ["1400", "720"], False),
    (AGREE, ["1400", "720"], [], ["1400", "720"], True),
    (AGREE, [], [], [], True),
])
def test_decide_requires_crosscheck_and_every_figure(cross, found, missing, figs, expected):
    ok, how = r.decide({"value": "x"}, cross, found, missing, figs)
    assert ok is expected and how


def test_decide_without_answer_is_unverified():
    ok, how = r.decide({"verification": "research run did not complete"}, AGREE, [], [], [])
    assert not ok and "did not complete" in how


def test_manual_override_wins_and_is_marked():
    fact = {"id": "a", "verified": False, "verification": "auto"}
    out = r.apply_manual(fact, {"a": {"verified": True, "verification": "human"}})
    assert out["verified"] is True and out["manual_override"] is True
    assert r.apply_manual(fact, {}) == fact


def test_committed_facts_are_well_formed():
    ids = {q["id"] for q in json.loads((FACTS_DIR.parent / "questions.json").read_text())}
    facts = [f for p in FACTS_DIR.glob("*.json") for f in json.loads(p.read_text())]
    assert facts, "no facts committed"
    for f in facts:
        assert f["id"] in ids
        assert isinstance(f["verified"], bool) and f["verification"]
        if f["verified"] and not f.get("manual_override"):
            assert f.get("sources"), f"{f['id']} verified without sources"
