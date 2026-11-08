import json

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine.app import app
from engine.routes import scores as route
from pipeline import cache

client = TestClient(app)

MAES = {"lgbm_q": 30.0, "bot_committee": 33.0, "bot_yesterday": 36.0, "bot_engineer": 40.0, "bot_last_week": 55.0,
        "persistence": 50.0, "yesterday": 36.0}


def frame():
    rows = []
    for fold in (0, 1):
        for zone, n, k in (("GB", 100, 1.0), ("FR", 300, 2.0)):
            for m, v in MAES.items():
                rows.append({"fold": fold, "zone": zone, "target": "price_da", "model": m, "mae": v * k, "n": n,
                             "coverage_p10_p90": float("nan") if m in ("persistence", "yesterday") else 0.8})
    rows.append({"fold": 0, "zone": "GB", "target": "load", "model": "lgbm_q", "mae": 1.0, "n": 5, "coverage_p10_p90": 0.5})
    return pd.DataFrame(rows)


def dm(zone, baseline, p):
    return {"target": "price_da", "zone": zone, "baseline": baseline, "p_value": p,
            "verdict": "model better" if p < 0.05 else "no significant difference"}


def test_techniques_pool_and_rank_with_one_yesterday():
    out = route.techniques(frame())
    names = [m["name"] for m in out["models"]]
    assert names == ["lgbm_q", "bot_committee", "bot_yesterday", "bot_engineer", "persistence", "bot_last_week"]
    ours = out["models"][0]
    assert ours["ours"] and ours["title"] == "Our model" and ours["mae"] == pytest.approx(1.75 * 30.0)  # n-weighted
    assert out["hours"] == 800 and out["zones"] == 2 and out["folds"] == 2
    assert out["models"][4]["coverage_p10_p90"] is None and out["models"][1]["coverage_p10_p90"] == pytest.approx(0.8)
    assert {m["title"] for m in out["models"]} >= {"The Committee", "Persistence", "Last week"}


def test_techniques_dm_lines_count_and_name_the_ties():
    ev = {"dm": [dm("GB", "persistence", 1e-9), dm("FR", "persistence", 2e-4), dm("NO2", "persistence", 0.9),
                 dm("GB", "yesterday", 0.003), dm("FR", "yesterday", 0.4)]}
    out = route.techniques(frame(), ev)
    p, y = out["dm"]
    assert (p["baseline"], p["zones"], p["better"], p["not_significant"]) == ("persistence", 3, 2, ["NO2"])
    assert p["max_p"] == pytest.approx(2e-4) and (y["better"], y["not_significant"]) == (1, ["FR"])


def test_techniques_empty_backtest_says_so():
    out = route.techniques(pd.DataFrame())
    assert out["models"] == [] and out["dm"] == []


def test_endpoint_reads_cache_and_stays_out_of_the_contract(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.setenv("LG_OFFLINE", "1")
    (tmp_path / "backtest").mkdir()
    frame().to_parquet(tmp_path / "backtest/walk_forward.parquet")
    (tmp_path / "backtest/evaluation.json").write_text(json.dumps({"dm": [dm("GB", "persistence", 1e-9)]}))
    body = client.get("/scores/techniques").json()
    assert body["models"][0]["name"] == "lgbm_q" and body["dm"][0]["better"] == 1
    assert "/scores/techniques" not in client.get("/openapi.json").json()["paths"]
