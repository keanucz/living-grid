import time

import pytest
from fastapi.testclient import TestClient

from engine.app import app
from engine.interventions import passthrough as pt
from engine.interventions import registry
from engine.schemas import InterventionResult
from pipeline import cache

client = TestClient(app)


@pytest.fixture(autouse=True)
def fixtures_only(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)


def post(**body):
    r = client.post("/intervene", json=body)
    assert r.status_code == 200, r.text
    return InterventionResult.model_validate(r.json())


def deltas(res):
    return {z.zone: z.avg_delta for z in res.zones}


def test_registered():
    assert {"hormuz", "carbon_price"} <= set(registry())


def test_gas_up_50pct_moves_gas_marginal_zones_most():
    post(type="hormuz")
    t = time.perf_counter()
    res = post(type="hormuz", magnitude=50)
    assert time.perf_counter() - t < 1.0
    d = deltas(res)
    assert all(v > 0 for v in d.values())
    assert d["NO2"] < 0.1 * max(d["GB"], d["NL"]), "Norway is hydro: gas is rarely marginal"
    assert d["FR"] < d["DE-LU"] < d["NL"]
    assert res.explanation.sentence.startswith("GB price up £") and "gas up 50%" in res.explanation.sentence
    assert "approximates market coupling" in res.method_note
    assert res.cost_total_gbp.p10 < res.cost_total_gbp.p50 < res.cost_total_gbp.p90
    assert res.applied_hours == 24 * 14


def test_pass_through_formula():
    # 35 EUR/MWh TTF in the fixtures: +50% is +17.5 EUR/MWh gas, x2 for a 50% efficient CCGT, x NL share
    res = post(type="hormuz", magnitude=50)
    expected = 17.5 * pt.gas_pass_through() * pt.PRIOR_GAS_MARGINAL_SHARE["NL"]
    assert deltas(res)["NL"] == pytest.approx(expected, rel=0.01)
    gb = 17.5 * pt.gas_pass_through() * pt.PRIOR_GAS_MARGINAL_SHARE["GB"] / 1.15
    assert deltas(res)["GB"] == pytest.approx(gb, rel=0.01)


def test_gas_shock_clamped_to_2022_peak():
    res = post(type="hormuz", magnitude=5000)
    assert res.clamped
    assert 35 * (1 + res.applied_magnitude / 100) == pytest.approx(pt.TTF_2022_PEAK_EUR_MWH)


def test_bigger_gas_shock_costs_more():
    assert post(type="hormuz", magnitude=80).cost_total_gbp.p50 > post(type="hormuz", magnitude=20).cost_total_gbp.p50


def test_carbon_spike():
    res = post(type="carbon_price", magnitude=30)
    d = deltas(res)
    assert d["NL"] == pytest.approx(30 * pt.CCGT_CO2_T_PER_MWH * pt.PRIOR_GAS_MARGINAL_SHARE["NL"], rel=0.01)
    assert d["NO2"] < d["GB"]
    assert "carbon up €30/t" in res.explanation.sentence


def test_carbon_fall_lowers_prices():
    assert all(v < 0 for v in deltas(post(type="carbon_price", magnitude=-20)).values())


def test_differentiated_pipeline_share_wins(tmp_path):
    import pandas as pd

    feats = pd.read_parquet(cache.FIXTURES / "features" / "latest.parquet")
    share = pd.DataFrame(
        {"zone": feats["zone"], "hour_of_day": feats["ts"].dt.hour, "month": feats["ts"].dt.month}
    ).drop_duplicates()
    share["share"] = share["zone"].map({"GB": 1.0}).fillna(0.0)
    (tmp_path / "features").mkdir()
    share.to_parquet(tmp_path / "features" / "gas_marginal_share.parquet")
    d = deltas(post(type="hormuz", magnitude=50))
    assert d["NL"] == pytest.approx(17.5 * pt.gas_pass_through() * pt.SHARE_BOUNDS["NL"][0], rel=0.01), "estimate 0 is lifted to the NL floor"
    assert d["GB"] == pytest.approx(17.5 * pt.gas_pass_through() / 1.15, rel=0.01)


def _differentiated(tmp_path, basis):
    import pandas as pd

    feats = pd.read_parquet(cache.FIXTURES / "features" / "latest.parquet")
    share = pd.DataFrame(
        {"zone": feats["zone"], "hour_of_day": feats["ts"].dt.hour, "month": feats["ts"].dt.month}
    ).drop_duplicates()
    share["share"] = share["zone"].map({"GB": 0.9, "BE": 0.30, "FR": 0.40}).fillna(0.5)
    (tmp_path / "features").mkdir(exist_ok=True)
    share.to_parquet(tmp_path / "features" / "gas_marginal_share.parquet")
    pd.DataFrame({"zone": list(basis), "n_hours": 100, "raw_share": 0.1, "basis": list(basis.values())}).to_parquet(
        tmp_path / "features" / "gas_marginal_share_meta.parquet"
    )
    return feats


def test_prior_only_zones_use_and_are_labelled_as_standard_estimates(tmp_path):
    feats = _differentiated(tmp_path, {"GB": "estimated", "FR": "estimated", "BE": "prior only"})
    share, source = pt.marginal_share(feats)
    by = dict(zip(feats["zone"], share))
    assert by["BE"] == pytest.approx(pt.PRIOR_GAS_MARGINAL_SHARE["BE"]) and by["FR"] == pytest.approx(0.40)
    assert "estimated from generation mix" in source and "standard estimates for BE" in source
    res = post(type="hormuz", magnitude=50)
    assert "standard estimates for BE" in res.method_note


def test_all_prior_only_says_standard_estimates(tmp_path):
    feats = _differentiated(tmp_path, {z: "prior only" for z in pt.PRIOR_GAS_MARGINAL_SHARE})
    share, source = pt.marginal_share(feats)
    assert source.startswith("standard estimates") and "estimated from" not in source


def test_all_estimated_keeps_the_estimated_label(tmp_path):
    feats = _differentiated(tmp_path, {z: "estimated" for z in pt.PRIOR_GAS_MARGINAL_SHARE})
    _, source = pt.marginal_share(feats)
    assert source.startswith("estimated from generation mix and 2021 to 2026 prices,") and "standard estimates for" not in source
