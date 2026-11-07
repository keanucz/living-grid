"""Definition of done, offline: with LG_OFFLINE=1 and no network, every hero-moment endpoint answers from fixtures."""

import socket
import time

import httpx
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine.app import app
from engine.schemas import CarbonResponse, GhostWindResponse, InterventionResult, ScoresResponse, StateResponse
from pipeline import cache, scoring

client = TestClient(app)


class NetworkUsed(AssertionError):
    pass


def _no_network(*args, **kwargs):
    raise NetworkUsed("network access attempted with LG_OFFLINE=1")


@pytest.fixture(autouse=True)
def offline(tmp_path, monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.setattr(socket.socket, "connect", _no_network)
    monkeypatch.setattr(socket, "create_connection", _no_network)
    monkeypatch.setattr(socket, "getaddrinfo", _no_network)
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", _no_network)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", _no_network)
    return tmp_path


def test_network_is_really_blocked():
    with pytest.raises(NetworkUsed):
        httpx.get("https://example.com")


def test_health_reports_offline():
    assert client.get("/health").json() == {"ok": True, "offline": True}


def test_hero1_ghost_wind_and_constraint_costs():
    r = client.get("/unseen/ghost-wind")
    assert r.status_code == 200, r.text
    body = GhostWindResponse.model_validate(r.json())
    assert body.regions and body.total_boalf_mwh > 0 and body.total_weather_gap_mwh > 0
    assert any(reg.series for reg in body.regions)
    assert all(reg.kind == "estimated" for reg in body.regions)
    assert body.constraint_costs and body.constraint_cost_total_gbp > 0


def test_hero1_carbon_through_imports_covers_every_zone():
    from engine import data

    at = client.get("/state").json()["at"]
    r = client.get(f"/unseen/carbon?at={at}")
    assert r.status_code == 200, r.text
    body = CarbonResponse.model_validate(r.json())
    assert {z.zone for z in body.zones} == set(data.ZONES)
    assert all(z.consumption_gco2_kwh > 0 and z.kind == "modelled" for z in body.zones)


def test_hero2_hormuz_answers_within_a_second():
    client.get("/zones")
    t0 = time.perf_counter()
    r = client.post("/intervene", json={"type": "hormuz"})
    elapsed = time.perf_counter() - t0
    assert r.status_code == 200, r.text
    assert elapsed < 1.0, f"Hormuz took {elapsed:.2f}s"
    body = InterventionResult.model_validate(r.json())
    assert body.zones and all(z.hourly for z in body.zones)
    assert any(z.avg_delta > 0 for z in body.zones), "closing Hormuz should raise prices"
    assert body.cost_total_gbp.p50 > 0
    assert body.cost_total_gbp.p10 <= body.cost_total_gbp.p50 <= body.cost_total_gbp.p90
    assert body.explanation.sentence


def test_hero2_precomputed_scenarios_are_served():
    keys = {s["key"] for s in client.get("/scenarios").json()["scenarios"]}
    assert "hormuz" in keys


def test_scrub_six_hours_ahead_shows_bands():
    log = cache.read_file(cache.FIXTURES / "forecasts" / "log.parquet")
    at = log["made_at"].max() + pd.Timedelta(hours=6)
    r = client.get(f"/state?at={at:%Y-%m-%dT%H:%M:%SZ}")
    assert r.status_code == 200, r.text
    body = StateResponse.model_validate(r.json())
    for z in body.zones:
        assert z.forecast, f"{z.zone} has no forecast at +6 h"
        assert z.forecast.p10 < z.forecast.p50 < z.forecast.p90
        assert z.forecast.horizon_h == 6 and z.forecast.made_at <= body.at


def _honest_and_leaked_log() -> tuple[pd.DataFrame, int]:
    """Real fixture forecasts moved so their outcomes are known, made before the auction; plus leaked copies."""
    actuals = scoring.load_actuals()
    prices = actuals[actuals["series"] == "price_da"]
    day = prices["ts"].max().floor("D")
    log = cache.read_file(cache.FIXTURES / "forecasts" / "log.parquet")
    log = log[log["target"] == "price_da"].copy()
    log["ts"] = day + pd.to_timedelta(log["ts"].dt.hour, unit="h")
    log["made_at"] = day - pd.Timedelta(days=1) + pd.Timedelta(hours=8)
    log = log.drop_duplicates(["zone", "ts"])
    honest = int(log.merge(prices[["zone", "ts"]], on=["zone", "ts"]).shape[0])
    leaked = log.copy()
    leaked["made_at"] = leaked["ts"] + pd.Timedelta(hours=1)
    late = log.copy()
    late["made_at"] = day - pd.Timedelta(hours=12)  # after the day-ahead result was public
    return pd.concat([log, leaked, late], ignore_index=True), honest


def test_scores_count_only_forecasts_logged_before_the_outcome():
    log, honest = _honest_and_leaked_log()
    assert honest > 0
    zones, overall = scoring.score(log=log)
    cache.write(scoring.SCORES, zones)
    cache.write(scoring.OVERALL, overall)
    r = client.get("/scores")
    assert r.status_code == 200, r.text
    body = ScoresResponse.model_validate(r.json())
    assert body.headline.forecasts_scored == honest
    assert "sample data" not in body.headline.sentence
    assert body.headline.mae_persistence > 0


def test_scores_answer_offline_with_no_live_scores():
    r = client.get("/scores")
    assert r.status_code == 200, r.text
    assert ScoresResponse.model_validate(r.json()).headline.forecasts_scored >= 0


@pytest.mark.parametrize("path", ["/zones", "/explain?zone=GB&ts=2026-11-08T05:00:00Z", "/household?region=A",
                                  "/replay?event=2026-10-26", "/reveal"])
def test_other_endpoints_answer_offline(path):
    r = client.get(path)
    assert r.status_code == 200, r.text
