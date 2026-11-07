import importlib

import numpy as np
import pandas as pd
import pytest

from pipeline import cache, schemas
from pipeline.models import quantile, train
from pipeline.tests.test_features import MADE_AT, populated  # noqa: F401  (fixture)
from pipeline.tests.test_models import SMALL

explain = importlib.import_module("pipeline.models.explain")  # the package re-exports a function of that name
REAL_FIXTURES = cache.FIXTURES


def fixture_features():
    return schemas.validate(pd.read_parquet(REAL_FIXTURES / "features/latest.parquet"), "features/latest")


@pytest.fixture
def model(populated):  # noqa: F811
    path = train.train(["price_da"], trained_before=MADE_AT, trained_at=MADE_AT, version="lgbm-x", params=SMALL)
    return quantile.QuantileModel.load(path)


def feats():
    f = fixture_features()
    rng = np.random.default_rng(1)
    f["wind_speed_100m"] += rng.normal(0, 2, len(f))
    return f


def test_contributions_sum_to_raw_p50(model):
    f = feats()
    c = explain.contributions(model, f)
    assert list(c.columns) == schemas.EXPLANATION_COLUMNS and len(c) == len(f)
    raw = model.boosters["price_da"]["p50"].predict(quantile.design(f), num_threads=1)
    np.testing.assert_allclose(c["base"] + c[schemas.GROUPS].sum(axis=1), raw, atol=1e-6)


def test_delta_sums_to_change_in_p50(model):
    before = feats()
    after = before.copy()
    after["gas_ttf_eur_mwh"] *= 1.5
    after["wind_gen_fc_mw"] *= 0.6
    d = explain.explain_delta(model, before, after)

    def p50(f):
        return model.boosters["price_da"]["p50"].predict(quantile.design(f), num_threads=1)

    np.testing.assert_allclose(d["total"], p50(after) - p50(before), atol=1e-6)
    assert (d["time_of_day"].abs() < 1e-9).all()


def test_module_explain_uses_active_model_else_zeros(populated):  # noqa: F811
    f = fixture_features()
    z = explain.explain(f)
    assert (z[["base", *schemas.GROUPS]] == 0).all().all()
    train.train(["price_da"], trained_before=MADE_AT, trained_at=MADE_AT, version="lgbm-x", params=SMALL)
    assert explain.explain(f)[schemas.GROUPS].abs().sum().sum() > 0


def test_stub_model_explains_with_zeros():
    out = quantile.QuantileModel().explain(fixture_features())
    assert list(out.columns) == schemas.EXPLANATION_COLUMNS and (out[schemas.GROUPS] == 0).all().all()


def row(**kw):
    base = {c: 0.0 for c in schemas.FEATURE_COLUMNS}
    base.update(wind_speed_100m=9.0, wind_gen_fc_mw=5000.0, load_fc_mw=30000.0, gas_ttf_eur_mwh=35.0, eua_eur_t=70.0,
             gas_marginal_share=0.5, import_net_mw=1200.0, temperature_c=8.0, solar_irradiance_wm2=100.0)
    base.update(kw)
    return pd.Series(base)


def deltas(**kw):
    return pd.Series({g: kw.get(g, 0.0) for g in schemas.GROUPS})


def test_sentence_snapshot_gb():
    before, after = row(), row(wind_gen_fc_mw=3000.0, import_net_mw=0.0)
    s = explain.sentence("GB", deltas(wind=12.4, imports=5.2, time_of_day=0.2), before, after)
    assert s == "GB price up £18: wind down 40% (+£12), less imported power (+£5)"


def test_sentence_snapshot_euro_and_fall():
    before, after = row(), row(gas_ttf_eur_mwh=52.5, eua_eur_t=100.0)
    s = explain.sentence("FR", deltas(gas=22.0, carbon=6.4, wind=-3.0), before, after)
    assert s == "FR price up €25: gas up 50% (+€22), carbon up €30/t (+€6), wind (−€3)"
    s = explain.sentence("DE-LU", deltas(solar=-9.0, demand=-2.0), row(), row(solar_irradiance_wm2=200.0, load_fc_mw=28500.0))
    assert s == "DE-LU price down €11: sunshine up 100% (−€9), demand down 5% (−€2)"


def test_sentence_limits_to_three_drivers_and_handles_no_change():
    d = deltas(wind=4.0, solar=3.0, demand=2.0, gas=1.5, carbon=1.0)
    s = explain.sentence("GB", d, row(), row())
    assert s.count("(") == 3 and s.startswith("GB price up £12:")
    assert explain.sentence("NL", deltas(wind=0.2), row(), row()) == "NL price little changed"


def test_describe_fallbacks():
    assert explain.describe("wind", row(wind_gen_fc_mw=0, wind_speed_100m=5.0), row(wind_gen_fc_mw=0, wind_speed_100m=7.5)) == "wind up 50%"
    assert explain.describe("solar", row(solar_irradiance_wm2=0), row(solar_irradiance_wm2=300)) == "more sunshine"
    assert explain.describe("demand", row(), row(temperature_c=3.0)) == "colder by 5°C"
    assert explain.describe("gas", row(), row(gas_marginal_share=0.8)) == "gas more often setting the price"
    assert explain.describe("time_of_day", row(), row()) == "time of day"


def test_explain_change_and_forecast_give_sentences_for_every_row(model):
    before = feats()
    after = before.copy()
    after["gas_ttf_eur_mwh"] *= 1.5
    c = explain.explain_change(model, before, after)
    assert len(c) == len(before) and c["sentence"].str.contains("price").all()
    assert c["sentence"].str.contains("gas up 50%").any() or (c["total"].abs() < 0.5).all()
    f = explain.explain_forecast(model, before)
    assert len(f) == len(before) and "sentence" in f


def test_mismatched_inputs_are_rejected(model):
    f = feats()
    with pytest.raises(ValueError):
        explain.explain_delta(model, f, f.iloc[:-1])
    with pytest.raises(ValueError):
        explain.explain_delta(model, f, f.iloc[::-1])
