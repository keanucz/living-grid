import json
from datetime import date
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from engine.market import clues, pool
from engine.tests.test_market_pool import DAY, root, write_day  # noqa: F401  (fixture)


def feats(day=DAY, zones=("GB", "FR", "DE-LU")):
    d0 = pd.Timestamp(day, tz="UTC")
    idx = pd.date_range(d0 - pd.Timedelta(days=31), d0 + pd.Timedelta(hours=23), freq="h")
    rows = []
    for z in zones:
        n = len(idx)
        rows.append(pd.DataFrame({
            "ts": idx, "zone": z, "wind_gen_fc_mw": 3000 + 50 * np.arange(n) % 700.0, "temperature_c": 8 + (np.arange(n) % 24) / 4,
            "gas_ttf_eur_mwh": 40 + np.arange(n) / 100, "load_fc_mw": 30000 + 20 * np.arange(n) % 5000.0, "import_net_mw": 1200.0 - 3 * np.arange(n) % 900,
        }))
    return pd.concat(rows, ignore_index=True)


def q(id="GB-price_da-18", hour=18, actual=77.34, note="Our forecast made 12 h ahead: median £70"):
    return SimpleNamespace(id=id, target_hour=hour, actual=actual, model_note=note)


def test_every_question_gets_the_six_clues_at_the_flat_price():
    out = clues.build(DAY, [q()], feats(), {"GB-price_da-18": "GB price up £18: wind down 40% (+£12)"})
    cs = out["GB-price_da-18"]
    assert [c["id"] for c in cs] == ["wind", "temperature", "gas", "demand", "flows", "model"]
    assert {c["cost"] for c in cs} == {clues.CLUE_COST}
    assert "median £70. GB price up" in cs[-1]["body"]


def test_the_zone_comes_from_the_question_id():
    assert [clues.zone_of(x) for x in ("DE-LU-price_da-17", "FR-price_da-13", "GB-wind-off-18", "choice-peak")] == ["DE-LU", "FR", "GB", "GB"]
    body = clues.build(DAY, [q("FR-price_da-13", 13)], feats())["FR-price_da-13"][0]["body"]
    assert "France" in body and "13:00" in body


def test_clues_never_name_the_date_or_show_the_answer():
    out = clues.build(DAY, [q(actual=77.34), q("FR-price_da-13", 13, 61.0)], feats())
    text = json.dumps(out)
    for form in clues.date_forms(DAY):
        assert form.lower() not in text.lower()
    assert "77.3" not in text and "61.0" not in text


@pytest.mark.parametrize("body", ["on 26 October the wind fell", "Monday looks windy", "2026-10-26", "Oct 26", "the price will be 77.3"])
def test_the_leak_check_catches_dates_weekdays_and_the_answer(body):
    with pytest.raises(clues.ClueLeak):
        clues.check_text(body, DAY, 77.34)


def test_a_model_sentence_that_names_the_date_stops_the_build():
    with pytest.raises(clues.ClueLeak):
        clues.build(DAY, [q()], feats(), {"GB-price_da-18": "storm of 26 October"})


def test_normals_use_only_days_before_the_day():
    f = feats()
    f.loc[f["ts"] >= pd.Timestamp(DAY, tz="UTC"), "wind_gen_fc_mw"] = 99999.0
    body = clues.for_question(DAY, "GB-price_da-18", 18, f)[0]["body"]
    assert "99,999 MW, against about" in body and "about 99" not in body.split("against about")[1]


def test_missing_features_still_leave_the_model_clue():
    cs = clues.for_question(DAY, "GB-price_da-18", 18, feats().iloc[0:0], None, "note")
    assert [c["id"] for c in cs] == ["model"] and "No single driver" in cs[0]["body"]


def test_load_days_carries_the_clues_and_they_stay_out_of_the_questions(root):  # noqa: F811
    write_day(root, DAY)
    row = pool.day_row(DAY, feats=feats(zones=("GB", "FR", "DE-LU", "NL", "BE", "NO2")))
    shop = json.loads(row["clues_json"])
    qs = json.loads(row["questions_json"])
    assert shop and set(shop) <= {x["id"] for x in qs}
    for body in (c["body"] for cs in shop.values() for c in cs):
        assert "2026-10-26" not in body
    answers = {a["question_id"]: a["actual"] for a in json.loads(row["answers_json"])}
    for qid, cs in shop.items():
        for c in cs:
            clues.check_text(c["body"], DAY, answers[qid])


def test_a_day_without_cached_features_loads_with_no_clues(root, monkeypatch):  # noqa: F811
    write_day(root, DAY)
    monkeypatch.setattr(clues, "features_for", lambda d: (_ for _ in ()).throw(FileNotFoundError("no cache")))
    assert pool.day_row(DAY)["clues_json"] == "{}"
