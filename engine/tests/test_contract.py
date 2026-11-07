import pytest
from fastapi.testclient import TestClient

from engine import schemas as s
from engine.app import app
from engine.contract import export
from engine.routes._fixtures import fixture

client = TestClient(app)

GETS = {
    "/zones": ("zones", s.ZonesResponse),
    "/state?at=2026-11-07T12:00:00Z": ("state", s.StateResponse),
    "/explain?zone=GB&ts=2026-11-08T08:00:00Z": ("explain", s.ExplainResponse),
    "/unseen/ghost-wind?from=2026-11-06T12:00:00Z&to=2026-11-07T12:00:00Z": ("ghost_wind", s.GhostWindResponse),
    "/unseen/carbon?at=2026-11-07T12:00:00Z": ("carbon", s.CarbonResponse),
    "/scenarios": ("scenarios", s.ScenariosResponse),
    "/scores": ("scores", s.ScoresResponse),
    "/household?region=N": ("household", s.HouseholdResponse),
    "/replay?event=2026-10-26": ("replay", s.ReplayResponse),
    "/reveal": ("reveal", s.RevealResponse),
}


def test_openapi_committed_matches_app():
    assert export.PATH.read_text() == export.render(), "run: uv run python -m engine.contract.export"


@pytest.mark.parametrize("url", GETS)
def test_get_routes_serve_valid_fixture(url):
    name, model = GETS[url]
    model.model_validate(fixture(name))
    r = client.get(url)
    assert r.status_code == 200, r.text
    model.model_validate(r.json())


def test_get_routes_cover_the_contract():
    paths = {p for p, ops in app.openapi()["paths"].items() if "get" in ops} - {"/health"}
    assert paths == {u.split("?")[0] for u in GETS}


@pytest.mark.parametrize("typ", list(s.InterventionType.__args__))
def test_intervene_accepts_every_type(typ):
    r = client.post("/intervene", json={"type": typ})
    assert r.status_code == 200, r.text
    body = s.InterventionResult.model_validate(r.json())
    assert body.request.type == typ


def test_intervene_rejects_unknown_type():
    assert client.post("/intervene", json={"type": "asteroid"}).status_code == 422


def test_ghost_wind_uses_from_alias():
    assert "from" in client.get("/unseen/ghost-wind").json()
