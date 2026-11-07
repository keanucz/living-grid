import os
import shutil
import time

import pytest
from fastapi.testclient import TestClient

from engine.app import app
from engine.interventions import results_cache as rc
from engine.routes.intervene import _compute_for
from engine.schemas import InterventionRequest
from pipeline import cache

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    monkeypatch.setattr(cache, "DATA", tmp_path)
    rc.RESULTS.clear()
    yield tmp_path
    rc.RESULTS.clear()


def warm() -> int:
    return rc.RESULTS.warm(_compute_for, lambda kind: InterventionRequest(type=kind))


def touch_inputs(tmp_path):
    """A new input file, as the scheduler would write: changes the signature."""
    (tmp_path / "features").mkdir(exist_ok=True)
    dst = tmp_path / "features" / "latest.parquet"
    shutil.copy(cache.FIXTURES / "features" / "latest.parquet", dst)
    os.utime(dst, ns=(time.time_ns() + 10**9, time.time_ns() + 10**9))


def test_warm_computes_every_preset_once():
    assert warm() == len(rc.PRESETS)
    assert warm() == 0, "nothing changed, nothing recomputed"


@pytest.mark.parametrize("kind", rc.PRESETS)
def test_preset_is_served_from_memory_fast(kind):
    warm()
    t0 = time.perf_counter()
    r = client.post("/intervene", json={"type": kind})
    elapsed = time.perf_counter() - t0
    assert r.status_code == 200, r.text
    assert r.headers["X-LG-Cache"] == "hit"
    assert elapsed < 0.3, f"{kind} took {elapsed:.3f}s"


def test_each_cached_event_is_a_new_event():
    warm()
    a = client.post("/intervene", json={"type": "hormuz"}).json()
    b = client.post("/intervene", json={"type": "hormuz"}).json()
    assert a["id"] != b["id"]
    assert a["zones"] == b["zones"]
    assert b["triggered_at"] >= a["triggered_at"]


def test_custom_magnitude_is_computed_then_memoised():
    r1 = client.post("/intervene", json={"type": "hormuz", "magnitude": 25})
    r2 = client.post("/intervene", json={"type": "hormuz", "magnitude": 25})
    assert r1.headers["X-LG-Cache"] == "miss" and r2.headers["X-LG-Cache"] == "hit"
    assert r1.json()["applied_magnitude"] == 25
    preset = client.post("/intervene", json={"type": "hormuz"}).json()
    assert preset["applied_magnitude"] != 25


def test_custom_request_recomputes_when_inputs_change(isolated):
    client.post("/intervene", json={"type": "hormuz", "magnitude": 25})
    touch_inputs(isolated)
    assert client.post("/intervene", json={"type": "hormuz", "magnitude": 25}).headers["X-LG-Cache"] == "miss"


def test_preset_serves_stale_instantly_and_refreshes_in_background(isolated):
    warm()
    touch_inputs(isolated)
    r = client.post("/intervene", json={"type": "hormuz"})
    assert r.status_code == 200 and r.headers["X-LG-Cache"] == "stale"
    deadline = time.time() + 10
    while time.time() < deadline:
        sig, _ = rc.RESULTS.peek(rc.key(InterventionRequest(type="hormuz")))
        if sig == rc.signature():
            break
        time.sleep(0.05)
    assert client.post("/intervene", json={"type": "hormuz"}).headers["X-LG-Cache"] == "hit"


def test_a_different_data_root_never_shares_results(tmp_path, monkeypatch):
    warm()
    other = tmp_path / "other"
    other.mkdir()
    monkeypatch.setattr(cache, "DATA", other)
    assert client.post("/intervene", json={"type": "hormuz"}).headers["X-LG-Cache"] == "miss"


def test_invalid_request_is_still_rejected():
    assert client.post("/intervene", json={"type": "hormuz", "hours": 0}).status_code == 422
