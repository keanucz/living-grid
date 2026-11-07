import pytest
from fastapi.testclient import TestClient

from engine import scenarios as sc
from engine.app import app
from engine.schemas import ScenariosResponse
from pipeline import cache

client = TestClient(app)


@pytest.fixture(autouse=True)
def fixtures_only(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    return tmp_path


def get():
    r = client.get("/scenarios")
    assert r.status_code == 200, r.text
    return {s.key: s for s in ScenariosResponse.model_validate(r.json()).scenarios}


def test_serves_fixtures_before_any_build():
    got = get()
    assert list(got) == [s["key"] for s in sc.SCENARIOS]
    assert got["hormuz"].result.id.startswith("fixture-")


def test_offline_build_then_serve(tmp_path):
    written = sc.build()
    assert {"hormuz", "norway_link"} <= set(written)
    assert (tmp_path / "scenarios" / "hormuz.json").exists()
    got = get()
    hormuz, norway = got["hormuz"].result, got["norway_link"].result
    assert not hormuz.id.startswith("fixture-") and not norway.id.startswith("fixture-")
    assert hormuz.request.type == "hormuz" and hormuz.applied_magnitude == 40
    assert norway.target == "nsl"
    gb = {z.zone: z.avg_delta for z in hormuz.zones}
    assert gb["GB"] > gb["NO2"] > 0
    assert list(got) == [s["key"] for s in sc.SCENARIOS], "unbuilt scenarios still fall back to fixtures"


def test_build_subset(tmp_path):
    assert sc.build(["norway_link"]) == ["norway_link"]
    assert not (tmp_path / "scenarios" / "hormuz.json").exists()
