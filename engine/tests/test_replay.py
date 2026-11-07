import time
from datetime import date

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine import replay as rp
from engine.app import app
from engine.routes._fixtures import fixture
from engine.schemas import ReplayResponse
from pipeline import cache
from pipeline.models import asof, quantile, train
from pipeline.tests.test_features import populated  # noqa: F401  (fixture)
from pipeline.tests.test_models import SMALL

client = TestClient(app)
EVENT = date(2026, 10, 26)


@pytest.fixture
def model(populated, monkeypatch):  # noqa: F811
    monkeypatch.setattr(train, "MIN_ROWS", 100)  # the synthetic cache has under three weeks of history
    return asof.as_of(EVENT.isoformat(), targets=["price_da", "gb_system_price"], params=SMALL)


def test_replay_series_are_as_of_forecasts_against_actuals(model):
    r = rp.compute(EVENT, model=model)
    body = ReplayResponse.model_validate({**r, "event": r["event"]})
    assert body.trained_before == EVENT and body.title == "The 26 October storm"
    assert [(s.zone, s.target) for s in body.series] == [("GB", "gb_system_price")] + [(z, "price_da") for z in ("GB", "FR", "DE-LU", "NL", "BE", "NO2")]
    for s in body.series:
        assert len(s.points) == 24 and s.unit == ("GBP/MWh" if s.zone == "GB" else "EUR/MWh")
        for p in s.points:
            assert p.p10 <= p.p50 <= p.p90 and p.made_at == p.ts - pd.Timedelta(hours=12) and p.ts.date() == EVENT
            assert p.actual is not None


def test_actuals_are_the_cached_real_values(model):
    r = rp.compute(EVENT, model=model)
    fr = next(s for s in r["series"] if (s["zone"], s["target"]) == ("FR", "price_da"))
    cached = cache.read("actuals/energy_charts_price_da")
    want = cached[(cached.zone == "FR") & (cached.ts == pd.Timestamp("2026-10-26T09:00Z"))]["value"].iloc[0]
    assert next(p for p in fr["points"] if p["ts"] == pd.Timestamp("2026-10-26T09:00Z"))["actual"] == pytest.approx(want)


def test_model_used_saw_nothing_on_or_after_the_event(model):
    assert model.trained_before == pd.Timestamp("2026-10-26", tz="UTC")
    assert all(pd.Timestamp(w["end"]) < pd.Timestamp("2026-10-26", tz="UTC") for w in model.meta["window"].values())


def test_explanations_only_on_the_biggest_movers_and_say_what_they_compare_with(model):
    r = rp.compute(EVENT, model=model)
    for s in r["series"]:
        texts = [p["explanation"] for p in s["points"] if p["explanation"]]
        assert len(texts) == (rp.EXPLAINED_PER_SERIES if s["target"] == "price_da" else 0)
        assert all(t.endswith("(against a typical hour that day)") and "price" in t for t in texts)


def test_no_trained_model_is_reported_not_faked(populated):  # noqa: F811
    with pytest.raises(rp.ReplayUnavailable, match="as-of model"):
        rp.compute(EVENT)
    with pytest.raises(rp.ReplayUnavailable, match="stub"):
        rp.compute(EVENT, model=quantile.QuantileModel(trained_before=pd.Timestamp("2026-10-26", tz="UTC")))


def test_model_for_another_date_is_refused(model):
    with pytest.raises(rp.ReplayUnavailable, match="not"):
        rp.compute(date(2026, 10, 30), model=model)


def test_constraint_cost_prefers_cache_then_verified_neso_fact_then_the_brief(model, populated):  # noqa: F811
    r = rp.compute(EVENT, model=model)
    assert r["constraint_cost_gbp"] == pytest.approx(36_530_868.70) and "NESO datastore" in r["summary"]
    assert "£36.5M" in r["summary"] and "brief" not in r["summary"]
    cache.write("neso/constraint_costs", pd.DataFrame({"date": ["2026-10-25", "2026-10-26"], "total_cost_gbp": [1.0, 35_500_000.0]}))
    r = rp.compute(EVENT, model=model)
    assert r["constraint_cost_gbp"] == 35_500_000.0 and "NESO daily total" in r["summary"]
    assert rp.constraint_cost(date(2026, 10, 30)) == (36_000_000.0, "brief")


def test_unverified_cost_fact_falls_back_to_the_brief(monkeypatch):
    def refuse(*a, **k):
        raise rp.loader.UnverifiedFact("no")

    monkeypatch.setattr(rp.loader, "figure", refuse)
    assert rp.constraint_cost(EVENT) == (36_000_000.0, "brief")


def test_summary_counts_hours_inside_the_band():
    series = [{"points": [{"actual": 5, "p10": 1, "p90": 9}, {"actual": 20, "p10": 1, "p90": 9}, {"actual": None, "p10": 1, "p90": 9}]}]
    s = rp.summary(series, EVENT, 36e6, "brief", "asof-20261026")
    assert "1 of 2 hours landed inside" in s and "26 October 2026" in s and "12 hours ahead" in s


def test_route_falls_back_to_the_contract_sample_then_serves_the_precomputed_file(model):
    assert client.get("/replay").json() == fixture("replay")
    rp.run(EVENT, model=model)
    assert rp.path(EVENT).exists()
    got = ReplayResponse.model_validate(client.get("/replay?event=2026-10-26").json())
    assert got.series[0].points[0].made_at == got.series[0].points[0].ts - pd.Timedelta(hours=12)
    assert client.get("/replay").json() != fixture("replay")


def test_other_dates_are_404_until_precomputed(populated):  # noqa: F811
    r = client.get("/replay?event=2026-10-30")
    assert r.status_code == 404 and "python -m engine.replay" in r.json()["detail"]


def test_precomputed_response_is_fast(model):
    rp.run(EVENT, model=model)
    client.get("/replay")
    t = time.perf_counter()
    assert client.get("/replay").status_code == 200
    assert time.perf_counter() - t < 0.2


def test_cli_fails_cleanly_without_a_model(populated):  # noqa: F811
    assert rp.main(["--event", "2026-10-26"]) == 1
    assert not rp.path(EVENT).exists()


def test_replay_has_no_load_or_wind_series_so_country_level_norway_cannot_appear(model):
    assert {s["target"] for s in rp.compute(EVENT, model=model)["series"]} <= {"price_da", "gb_system_price"}
