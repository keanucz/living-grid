import importlib

import pandas as pd

from pipeline import schemas

explain = importlib.import_module("pipeline.models.explain")  # the package re-exports a function of that name

BASE = {c: 1.0 for c in schemas.FEATURE_COLUMNS} | {
    "load_fc_mw": 30000.0, "residual_load_mw": 20000.0, "temperature_c": 8.0, "price_lag_24h": 100.0, "price_lag_168h": 100.0,
    "wind_gen_fc_mw": 5000.0, "wind_speed_100m": 8.0, "solar_irradiance_wm2": 0.0, "gas_ttf_eur_mwh": 80.0, "gas_marginal_share": 0.5,
    "eua_eur_t": 80.0, "import_net_mw": 1000.0,
}


def row(**kw):
    return pd.Series(BASE | kw)


def test_the_ticket_case_does_not_say_demand_down_when_the_group_pushes_the_price_up():
    # live GB 7 Nov: load forecast down 20%, residual load up (less wind), group contribution +£10
    before, after = row(), row(load_fc_mw=24000.0, residual_load_mw=23200.0)
    text = explain.describe("demand", before, after, 10.0)
    assert "down 20%" not in text and text == "demand left after wind and sun up 3.2 GW"


def test_demand_down_is_kept_when_it_agrees_with_a_falling_price():
    assert explain.describe("demand", row(), row(load_fc_mw=24000.0), -5.0) == "demand down 20%"
    assert explain.describe("demand", row(), row(load_fc_mw=33000.0), 8.0) == "demand up 10%"


def test_every_candidate_agrees_with_the_sign_of_the_contribution():
    cold = row(temperature_c=3.0)
    assert explain.describe("demand", row(), cold, 4.0) == "colder by 5°C"  # colder pushes the price up
    assert explain.describe("demand", row(), row(temperature_c=13.0), -4.0) == "warmer by 5°C"
    assert explain.describe("demand", row(), row(price_lag_24h=120.0), 4.0) == "yesterday’s prices higher"
    assert explain.describe("demand", row(), row(price_lag_168h=80.0), -4.0) == "last week’s prices lower"


def test_a_change_that_points_the_wrong_way_is_never_described():
    # warmer weather and a falling load cannot explain a price rise: fall back to a neutral label
    out = explain.describe("demand", row(), row(temperature_c=12.0, load_fc_mw=27000.0), 6.0)
    assert out == "demand and recent prices"
    assert explain.describe("demand", row(), row(), 6.0) == "demand and recent prices"


def test_without_a_contribution_the_first_change_is_described_as_before():
    assert explain.describe("demand", row(), row(load_fc_mw=24000.0)) == "demand down 20%"
    assert explain.describe("demand", row(), row(temperature_c=3.0)) == "colder by 5°C"


def test_sentence_passes_each_group_its_own_contribution():
    deltas = pd.Series({"wind": 0.0, "solar": 0.0, "demand": 10.0, "gas": 4.0, "carbon": 0.0, "imports": 0.0, "time_of_day": -11.0})
    before = row()
    after = row(load_fc_mw=24000.0, residual_load_mw=23200.0, gas_marginal_share=0.8)
    s = explain.sentence("GB", deltas, before, after)
    assert s.startswith("GB price up £3: ")
    assert "demand down" not in s and "(+£10)" in s and "demand left after wind and sun up 3.2 GW (+£10)" in s
