import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine.app import app
from engine.routes.explain import REFERENCE_NOTE
from engine.schemas import ExplainResponse, ScoresResponse
from pipeline import cache, schemas
from pipeline.features import build
from pipeline.models import quantile, train
from pipeline.tests.test_features import MADE_AT, populated  # noqa: F401  (fixture)
from pipeline.tests.test_models import SMALL

client = TestClient(app)


@pytest.fixture
def fixtures_only(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.setenv("LG_OFFLINE", "1")
    return tmp_path


@pytest.fixture
def trained(populated, monkeypatch):  # noqa: F811
    monkeypatch.delenv("LG_OFFLINE", raising=False)
    build.latest(MADE_AT)
    train.train(["price_da"], trained_before=MADE_AT, trained_at=MADE_AT, version="lgbm-t", params=SMALL)
    monkeypatch.setenv("LG_OFFLINE", "1")


# ---------------- /explain ----------------


def test_explain_without_a_trained_model_says_so_instead_of_inventing_drivers(fixtures_only):
    r = client.get("/explain?zone=GB")
    assert r.status_code == 200, r.text
    body = ExplainResponse.model_validate(r.json())
    assert "no trained model" in body.sentence
    assert [c.group for c in body.contributions] == schemas.GROUPS and all(c.value == 0 for c in body.contributions)
    assert body.delta == 0 and body.base == body.prediction and body.unit == "GBP/MWh" and body.kind == "forecast"


def test_explain_with_a_trained_model_adds_up_and_matches_the_pipeline(trained):
    ts = "2026-11-08T08:00:00Z"
    r = client.get(f"/explain?zone=FR&ts={ts}")
    assert r.status_code == 200, r.text
    body = ExplainResponse.model_validate(r.json())
    total = sum(c.value for c in body.contributions)
    assert body.delta == pytest.approx(total) and body.base + total == pytest.approx(body.prediction)
    assert body.unit == "EUR/MWh" and body.target == "price_da" and body.ts == pd.Timestamp(ts)
    assert body.sentence.startswith("FR price") and body.sentence.endswith(f"({REFERENCE_NOTE})")

    from pipeline.models.explain import explain_change, reference_rows

    rows = build.latest(rebuild=False)
    fr = rows[rows.zone == "FR"].reset_index(drop=True)
    i = int(fr.index[fr.ts == pd.Timestamp(ts)][0])
    expect = explain_change(quantile.active(), reference_rows(fr).iloc[[i]], fr.iloc[[i]]).iloc[0]
    for c in body.contributions:
        assert c.value == pytest.approx(float(expect[c.group]))
    assert body.sentence.startswith(expect["sentence"])


def test_explain_defaults_to_the_first_hour_and_floors_to_the_hour(trained):
    first = client.get("/explain?zone=GB").json()
    rows = build.latest(rebuild=False)
    assert pd.Timestamp(first["ts"]) == rows[rows.zone == "GB"].ts.min()
    a = client.get("/explain?zone=NL&ts=2026-11-08T09:00:00Z").json()
    b = client.get("/explain?zone=NL&ts=2026-11-08T09:47:00Z").json()
    assert a == b
    assert client.get("/explain?zone=GB&ts=2026-11-08T09:00:00%2B01:00").json()["ts"] == "2026-11-08T08:00:00Z"


def test_explain_unknown_hour_is_404_with_the_available_range_and_bad_zone_is_422(fixtures_only):
    r = client.get("/explain?zone=GB&ts=2030-01-01T00:00:00Z")
    assert r.status_code == 404 and "2026-11-08T00:00Z" in r.json()["detail"]
    assert client.get("/explain?zone=XX").status_code == 422


# ---------------- /scores ----------------

T = pd.Timestamp("2026-11-07T12:00Z")


def row(zone, target, metric, model, value, n, end=None):
    return {"window_start": T, "window_end": T + pd.Timedelta(hours=10) if end is None else end, "zone": zone, "target": target, "metric": metric, "model": model,
            "value": value, "n": n}


def live_scores():
    return pd.DataFrame([
        row("GB", "price_da", "mae", "lgbm-1", 8.0, 10), row("GB", "price_da", "mae", "persistence", 10.0, 10),
        row("GB", "price_da", "mae", "yesterday", 11.0, 10), row("GB", "price_da", "coverage_p10_p90", "lgbm-1", 0.7, 10),
        row("GB", "price_da", "forecasts_scored", "lgbm-1", 12, 12),
        row("FR", "price_da", "mae", "lgbm-1", 4.0, 30), row("FR", "price_da", "mae", "persistence", 8.0, 30),
        row("FR", "price_da", "coverage_p10_p90", "lgbm-1", 0.9, 30), row("FR", "price_da", "forecasts_scored", "lgbm-1", 33, 33),
        row("FR", "load", "forecasts_scored", "lgbm-1", 7, 7),
    ])


def test_scores_headline_is_pooled_and_matches_hand_calculation(fixtures_only):
    cache.write("scores/scores", live_scores())
    r = client.get("/scores")
    assert r.status_code == 200, r.text
    body = ScoresResponse.model_validate(r.json())
    h = body.headline
    assert h.mae_model == pytest.approx((8 * 10 + 4 * 30) / 40) and h.mae_persistence == pytest.approx((10 * 10 + 8 * 30) / 40)
    assert h.coverage_p10_p90 == pytest.approx((0.7 * 10 + 0.9 * 30) / 40)
    assert h.forecasts_scored == 52 and h.since == T
    assert h.sentence == "52 forecasts since Saturday 12:00 UTC, all logged before the outcome"
    assert body.as_of == T + pd.Timedelta(hours=10)


def test_scores_live_rows_have_model_and_baselines_with_null_baseline_coverage(fixtures_only):
    cache.write("scores/scores", live_scores())
    live = client.get("/scores").json()["live"]
    by = {(r["zone"], r["model"]): r for r in live}
    assert by[("GB", "lgbm-1")]["coverage_p10_p90"] == 0.7 and by[("GB", "lgbm-1")]["mae"] == 8.0 and by[("GB", "lgbm-1")]["n"] == 10
    assert by[("GB", "persistence")]["coverage_p10_p90"] is None and by[("GB", "yesterday")]["mae"] == 11.0
    assert len(live) == 5


def test_headline_uses_the_newest_model_and_only_zones_that_have_a_baseline(fixtures_only):
    extra = pd.DataFrame([
        row("GB", "price_da", "mae", "lgbm-2", 5.0, 20, end=T + pd.Timedelta(hours=40)),
        row("GB", "price_da", "coverage_p10_p90", "lgbm-2", 0.8, 20, end=T + pd.Timedelta(hours=40)),
        row("DE-LU", "price_da", "mae", "lgbm-2", 99.0, 20, end=T + pd.Timedelta(hours=40)),
    ])
    cache.write("scores/scores", pd.concat([live_scores(), extra], ignore_index=True))
    h = client.get("/scores").json()["headline"]
    assert h["mae_model"] == pytest.approx(5.0) and h["mae_persistence"] == pytest.approx(10.0)
    assert h["coverage_p10_p90"] == pytest.approx(0.8)


def test_backtest_rows_come_from_walk_forward_with_null_baseline_coverage(fixtures_only):
    cache.write("scores/scores", live_scores())
    cache.write("backtest/walk_forward", pd.DataFrame([
        {"fold": 1, "zone": "GB", "target": "price_da", "model": "persistence", "mae": 12.5, "coverage_p10_p90": np.nan, "n": 168},
        {"fold": 0, "zone": "GB", "target": "price_da", "model": "lgbm_q", "mae": 9.5, "coverage_p10_p90": 0.78, "n": 168},
    ]).astype({"fold": "int32"}))
    bt = client.get("/scores").json()["backtest"]
    assert [(r["fold"], r["model"]) for r in bt] == [(0, "lgbm_q"), (1, "persistence")]
    assert bt[0]["coverage_p10_p90"] == 0.78 and bt[1]["coverage_p10_p90"] is None and bt[1]["n"] == 168


def test_scores_are_labelled_sample_data_when_only_fixtures_exist(fixtures_only):
    body = client.get("/scores").json()
    assert body["headline"]["sentence"].endswith("(sample data: no live scores yet)")
    assert body["live"] and body["backtest"]
    cache.write("scores/scores", live_scores())
    assert "sample data" not in client.get("/scores").json()["headline"]["sentence"]


def test_scores_with_nothing_scored_yet_say_so(fixtures_only):
    cache.write("scores/scores", live_scores().iloc[0:0])
    body = client.get("/scores").json()
    assert body["headline"]["sentence"] == "No forecasts have been scored yet" and body["headline"]["forecasts_scored"] == 0
    assert body["live"] == []


def test_live_battery_fields_never_show_sample_numbers(fixtures_only):
    # With live scores but no settled day-ahead hours, the battery comparison is empty, not the fixture.
    cache.write("scores/scores", live_scores())
    body = client.get("/scores").json()
    assert all(b["strategy"] in ("median_only", "risk_aware", "naive", "perfect_foresight") for b in body["battery"])
    share = body["headline"]["battery_share_of_perfect"]
    assert share is None or 0.0 <= share <= 1.0
    if share is None:
        assert body["headline"]["battery_note"], "a null share always carries a reason"
