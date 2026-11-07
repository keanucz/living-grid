import json

import numpy as np
import pandas as pd
import pytest

from engine.market import question_types as qt
from engine.market import questions as q


def replay_day(n_zones=4):
    hours = pd.date_range("2026-10-26", periods=24, freq="h", tz="UTC")

    def series(zone, unit, base, scale):
        pts = []
        for i, t in enumerate(hours):
            m = base + scale * np.sin((i - 6) / 24 * 2 * np.pi)
            pts.append({"ts": t.isoformat(), "actual": float(m + (80 if i == 19 else 0)), "p10": float(m * 0.6), "p50": float(m), "p90": float(m * 1.5),
                        "made_at": "2026-10-26T00:00:00+00:00"})
        return {"zone": zone, "target": "price_da", "unit": unit, "points": pts}

    zones = [("GB", "GBP/MWh", 90, 40), ("DE-LU", "EUR/MWh", 120, 50), ("FR", "EUR/MWh", 100, 30), ("NL", "EUR/MWh", 110, 45), ("BE", "EUR/MWh", 105, 35)][:n_zones]
    return {"event": "2026-10-26", "series": [series(z, u, b, s) for z, u, b, s in zones]}


def assert_valid_choice(x):
    ps = [c["p"] for c in x.choices]
    assert len(x.choices) >= 2 and sum(ps) == pytest.approx(1, abs=0.01) and min(ps) >= 0.019
    assert x.outcome in {c["id"] for c in x.choices}
    assert len({c["id"] for c in x.choices}) == len(x.choices)
    pub = q.league_public(x)
    assert pub["choices"] == x.choices and "outcome" not in pub and "actual" not in pub


def test_price_bucket_edges_are_ordered_probabilities_sum_to_one_and_the_outcome_is_the_band_of_the_actual():
    x = qt.price_bucket(replay_day())
    assert_valid_choice(x)
    assert x.kind == "price_bucket" and len(x.choices) == 4 and 12 < x.target_hour <= 18
    edges = [float(c["label"].split("£")[-1].split()[0]) for c in x.choices[1:]]  # lower edge of each band after the first
    assert edges == sorted(edges)
    won = int(x.outcome[1:])
    lo = float(x.choices[won]["label"].split("£")[1].split()[0]) if won else -np.inf
    assert x.actual >= lo


def test_price_bucket_is_refused_when_the_forecast_or_actual_is_missing():
    r = replay_day()
    for p in r["series"][0]["points"]:
        p["actual"] = None
    assert qt.price_bucket(r) is None


def test_which_zone_picks_the_highest_in_euros_and_needs_three_zones():
    x = qt.which_zone(replay_day(5), asked=17)
    assert_valid_choice(x)
    # GB is converted at 1.15: a GB price of 100 pounds beats a 110 euro zone.
    r = replay_day(2)
    assert qt.which_zone(r) is None
    r = replay_day(3)
    for s in r["series"]:
        for p in s["points"]:
            if pd.Timestamp(p["ts"]).hour == 17:
                p["actual"] = {"GB": 100.0, "DE-LU": 110.0, "FR": 90.0}[s["zone"]]
    assert qt.which_zone(r, asked=17).outcome == "GB"


def test_model_probabilities_are_deterministic():
    a, b = qt.which_zone(replay_day(5)), qt.which_zone(replay_day(5))
    assert [c["p"] for c in a.choices] == [c["p"] for c in b.choices]


def test_peak_block_covers_the_day_and_settles_at_the_end_of_play():
    x = qt.peak_block(replay_day(), end=18)
    assert_valid_choice(x)
    assert x.target_hour == 18 and [c["id"] for c in x.choices] == ["night", "morning", "afternoon", "evening"]
    assert x.outcome == "evening"  # the fixture's actual peaks at 19:00
    r = replay_day()
    r["series"][0]["points"] = r["series"][0]["points"][:20]
    assert qt.peak_block(r) is None


def flows(days=40, hour_bias=1.0, today=300.0):
    ts = pd.date_range("2026-09-20", "2026-10-27", freq="h", tz="UTC")
    v = np.where(ts.day % 4 == 0, -400.0, 500.0 * hour_bias)
    df = pd.DataFrame({"ts": ts, "value": v})
    df.loc[df["ts"] == pd.Timestamp("2026-10-26T13:00Z"), "value"] = today  # 19:00 is outside the round, so the question wraps to 13:00
    return df


def test_import_export_uses_history_for_the_model_and_the_day_for_the_answer():
    day = pd.Timestamp("2026-10-26", tz="UTC")
    x = qt.import_export(day, flows(today=300.0))
    assert_valid_choice(x)
    assert x.outcome == "import" and "History only" in x.model_note
    assert qt.import_export(day, flows(today=-250.0)).outcome == "export"
    assert qt.import_export(day, None) is None and qt.import_export(day, flows().iloc[:5]) is None
    p_import = x.choices[0]["p"]
    assert 0.5 < p_import < 0.95  # three of four days import in the fixture


def test_gb_net_import_flips_the_sign_of_exports():
    ts = pd.date_range("2026-10-26", periods=2, freq="h", tz="UTC")
    a = pd.concat([pd.DataFrame({"ts": ts, "zone": "GB", "series": s, "value": v, "unit": "MW"}) for s, v in (("flow_GB_FR", 1000.0), ("flow_GB_NO2", -400.0))])
    out = qt.gb_net_import(a)
    assert out["value"].tolist() == [-600.0, -600.0]  # exports 1000, imports 400: net exporting 600


def boalf_history():
    ts = pd.date_range("2026-09-20", "2026-10-26 23:00", freq="h", tz="UTC")
    rng = np.random.default_rng(1)
    v = rng.uniform(0, 1000, len(ts))
    v[ts.normalize() == pd.Timestamp("2026-10-26", tz="UTC")] = 3000.0
    return pd.DataFrame({"ts": ts, "value": v})


def test_wind_band_splits_history_in_thirds_and_answers_from_the_day():
    day = pd.Timestamp("2026-10-26", tz="UTC")
    x = qt.wind_band(day, boalf_history(), 18)
    assert_valid_choice(x)
    assert x.outcome == "b2" and "History only" in x.model_note  # 3000 MWh x 18 h = 54 GWh, far above the usual 9
    assert qt.wind_band(day, None) is None


def test_build_adds_choice_questions_only_when_asked_and_keeps_every_hour_inside_the_round():
    r = replay_day(5)
    plain = q.build(r, boalf_history())
    more = q.build(r, boalf_history(), choices=True, net_import=flows())
    assert len(more) > len(plain) and all(not x.choices for x in plain)
    assert all(12 < x.target_hour <= 18 for x in more)
    ids = [x.id for x in more]
    assert len(ids) == len(set(ids))
    json.dumps([q.league_public(x) for x in more])  # serialisable for the pool
