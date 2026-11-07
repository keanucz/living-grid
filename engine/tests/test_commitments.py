import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine.app import app
from pipeline import cache, commit_chain as cc

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.setenv("LG_OFFLINE", "1")
    monkeypatch.setenv("LG_SOLANA_KEYPAIR", str(tmp_path / "none.json"))


def _commit():
    df = pd.DataFrame(
        {
            "made_at": pd.to_datetime(["2026-11-07T20:00Z"]),
            "zone": ["GB"],
            "target": ["price_da"],
            "ts": pd.to_datetime(["2026-11-09T10:00Z"]),
            "horizon_h": [38],
            "p10": [1.0],
            "p50": [2.0],
            "p90": [3.0],
            "model_version": ["m"],
        }
    )
    return cc.commit_run(df, pd.Timestamp("2026-11-07T20:00Z"))


def test_empty_list():
    r = client.get("/commitments")
    assert r.status_code == 200 and r.json()["records"] == []


def test_lists_records_and_serves_exact_hashed_bytes():
    rec = _commit()
    body = client.get("/commitments").json()
    assert body["records"][0]["sha256"] == rec["sha256"]
    f = client.get(f"/commitments/file/{rec['id']}")
    assert f.status_code == 200
    assert cc.sha256_hex(f.content) == rec["sha256"]


@pytest.mark.parametrize("bad", ["../etc/passwd", "run-1", "freeze-20261107T235900Z"])
def test_rejects_bad_or_missing_ids(bad):
    assert client.get(f"/commitments/file/{bad}").status_code == 404


def test_not_in_openapi_contract():
    assert "/commitments" not in app.openapi()["paths"]
