import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine.app import app
from engine.routes import scores as route
from pipeline import cache

client = TestClient(app)
T = pd.Timestamp("2026-11-07T12:00:00Z")


@pytest.fixture
def offline(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.setenv("LG_OFFLINE", "1")
    return tmp_path


def row(zone, metric, model, value, n, target="price_da"):
    return {"window_start": T, "window_end": T + pd.Timedelta(hours=2), "zone": zone, "target": target,
            "metric": metric, "model": model, "value": value, "n": n}


def one_scored():
    return pd.DataFrame([
        row("GB", "mae", "lgbm-1", 0.0, 1), row("GB", "mae", "persistence", 0.0, 1),
        row("GB", "coverage_p10_p90", "lgbm-1", 0.0, 1), row("GB", "forecasts_scored", "lgbm-1", 1, 1),
        row("FR", "forecasts_scored", "lgbm-1", 30, 30, target="load"),
    ])


def walk_forward():
    rows = []
    for fold in (0, 1):
        for zone, n in (("GB", 100), ("FR", 300)):
            rows += [{"fold": fold, "zone": zone, "target": "price_da", "model": "lgbm", "mae": 6.0 if zone == "GB" else 10.0,
                      "coverage_p10_p90": 0.7 if zone == "GB" else 0.9, "n": n},
                     {"fold": fold, "zone": zone, "target": "price_da", "model": "persistence", "mae": 12.0,
                      "coverage_p10_p90": float("nan"), "n": n}]
    return pd.DataFrame(rows).astype({"fold": "int32"})


def test_one_scored_hour_falls_back_to_the_backtest_headline(offline):
    cache.write("scores/scores", one_scored())
    cache.write("backtest/walk_forward", walk_forward())
    h = client.get("/scores").json()["headline"]
    assert h["mae_model"] == pytest.approx((6 * 100 + 10 * 300) / 400)
    assert h["mae_persistence"] == pytest.approx(12.0)
    assert h["coverage_p10_p90"] == pytest.approx((0.7 * 100 + 0.9 * 300) / 400)
    assert h["forecasts_scored"] == 31
    assert h["sentence"] == ("Scoring starts as forecasts reach their target hour: 31 scored so far. "
                             "Headline figures are from the walk-forward backtest (800 hours)")


def test_other_targets_do_not_count_towards_the_day_ahead_minimum(offline):
    cache.write("scores/scores", one_scored())
    assert route.scored_for(one_scored(), "price_da") == 1
    assert route.scored_for(one_scored(), "load") == 30


def test_few_scored_and_no_backtest_shows_zeros_not_the_tiny_sample(offline):
    s = one_scored()
    s.loc[s["metric"] == "mae", "value"] = [50.0, 1.0]
    cache.write("scores/scores", s)
    h = client.get("/scores").json()["headline"]
    assert h["mae_model"] == 0.0 and h["mae_persistence"] == 0.0 and h["coverage_p10_p90"] == 0.0
    assert h["sentence"].startswith("Scoring starts as forecasts reach their target hour: 31 scored so far")


def test_enough_scored_uses_live_numbers(offline):
    live = pd.DataFrame([
        row("GB", "mae", "lgbm-1", 8.0, 24), row("GB", "mae", "persistence", 10.0, 24),
        row("GB", "coverage_p10_p90", "lgbm-1", 0.75, 24), row("GB", "forecasts_scored", "lgbm-1", 24, 24),
    ])
    cache.write("scores/scores", live)
    cache.write("backtest/walk_forward", walk_forward())
    h = client.get("/scores").json()["headline"]
    assert h["mae_model"] == 8.0 and h["mae_persistence"] == 10.0 and h["coverage_p10_p90"] == 0.75
    assert h["sentence"].startswith("24 forecasts since")


def test_threshold_is_configurable():
    h = route.headline(one_scored(), sample=False, battery={"share": 0.5}, backtest=walk_forward(), min_scored=1)
    assert h["sentence"].startswith("31 forecasts since")
