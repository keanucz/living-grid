import json
from pathlib import Path

import pytest

from engine.reference import research as r

FACTS_DIR = Path(r.__file__).resolve().parent / "facts"


def test_figures_normalises_thousands_and_keeps_decimals():
    assert r.figures("1,400 MW and 0.334 tCO2/MWh") == ["1400", "0.334"]
    assert r.figures("1 000 MW") == ["1000"]


def test_normalise_reads_european_decimal_commas_but_not_thousands():
    assert r.normalise("CCGT 53–58,5 and 57–60,5") == "CCGT 53–58.5 and 57–60.5"
    assert r.normalise("1,400 MW and 2,5 GW") == "1400 MW and 2.5 GW"
    assert r.present("58.5", r.normalise("BAT-AEEL 53–58,5 %"))


def test_figure_check_retries_full_content_when_excerpts_miss(monkeypatch):
    monkeypatch.setattr(r, "fetch_direct", lambda url: None)
    calls = []
    def fake_call(method, path, body=None, retries=5):
        calls.append(body)
        if body.get("advanced_settings", {}).get("full_content"):
            return {"results": [{"full_content": "CCGT, >= 600 MWth 57–60,5"}]}
        return {"results": [{"excerpts": ["nothing useful"]}]}
    monkeypatch.setattr(r, "call", fake_call)
    found, missing, route = r.figure_check("q", ["60.5"], ["https://eur-lex.example/pdf"])
    assert found == ["60.5"] and route == {"60.5": "parallel_extract_full"} and len(calls) == 2


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
    assert r.figures("since 2021") == ["2021"]


def test_figures_falls_back_to_single_digits_when_nothing_longer():
    assert r.figures("2 requests per minute with a burst of 4") == ["2", "4"]
    assert r.figures("no numbers here") == []


def test_figures_deduplicates_and_caps():
    assert r.figures("10 10 11 12 13 14 15 16") == ["10", "11", "12", "13", "14", "15"]


def test_figure_check_prefers_direct_fetch_and_falls_back_to_extract(monkeypatch):
    monkeypatch.setattr(r, "fetch_direct", lambda url: "Capacity of 1,400 MW since 2021")
    def fake_call(method, path, body=None, retries=5):
        assert path == "/v1/extract"
        if body.get("advanced_settings", {}).get("full_content"):
            return {"results": [{"full_content": "no match here"}]}
        assert body["search_queries"] == ["720", "99"]
        return {"results": [{"excerpts": ["about 720 MW at peak"]}]}
    monkeypatch.setattr(r, "call", fake_call)
    found, missing, route = r.figure_check("q", ["1400", "720", "99"], ["https://example.org"])
    assert found == ["1400", "720"] and missing == ["99"]
    assert route == {"1400": "direct", "720": "parallel_extract"}


def test_figure_check_skips_extract_when_direct_finds_everything(monkeypatch):
    monkeypatch.setattr(r, "fetch_direct", lambda url: "1,400 MW")
    monkeypatch.setattr(r, "call", lambda *a, **k: pytest.fail("Extract should not be called"))
    assert r.figure_check("q", ["1400"], ["https://example.org"]) == (["1400"], [], {"1400": "direct"})


def test_figure_check_treats_all_failures_as_missing(monkeypatch):
    monkeypatch.setattr(r, "fetch_direct", lambda url: None)
    def boom(*a, **k):
        raise RuntimeError("down")
    monkeypatch.setattr(r, "call", boom)
    assert r.figure_check("q", ["1400"], ["https://example.org"]) == ([], ["1400"], {})


def test_dates_are_checked_whole_including_the_year():
    assert r.figures("25 October 2026") == ["date:2026-10-25"]
    assert r.figures("EUR 339.20/MWh, reached on August 26.") == ["date:--08-26", "339.20"]
    assert r.present("date:2026-10-25", "clocks went back on Sunday 25 October 2026")
    assert r.present("date:2026-10-25", "on 2026-10-25 at 02:00")
    assert not r.present("date:2026-10-25", "clocks went back on 25 October 2025")
    assert r.present("date:--08-26", "peaked on 26 Aug at 339")


def test_rounding_keeps_three_significant_digits():
    assert r.present("10.241337", "about 10.2 TWh curtailed")
    assert not r.present("10.241337", "over 10 TWh curtailed")
    assert r.present("6700", "a transfer capability of 6.7 GW")
    assert not r.present("1630", "1.6 GW")


def test_corroboration_needs_an_agreeing_crosscheck_from_another_site():
    fact = {"sources": [{"url": "https://www.neso.energy/a"}]}
    same = {"agrees": True, "sources": [{"url": "https://neso.energy/b"}]}
    other = {"agrees": True, "sources": [{"url": "https://www.ofgem.gov.uk/x"}]}
    assert not r.corroborated(fact, same)
    assert r.corroborated(fact, other)
    assert not r.corroborated(fact, {**other, "agrees": False})
    assert not r.corroborated(fact, None)


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
