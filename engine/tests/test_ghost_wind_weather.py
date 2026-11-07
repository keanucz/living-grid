import numpy as np
import pandas as pd
import pytest

from engine.ghost_wind import weather_gap as wg
from pipeline import cache, static

TS = pd.date_range("2026-11-06", periods=6, freq="h", tz="UTC")


def weather(values, point="moray_firth", zone="GB"):
    return pd.DataFrame({"ts": TS[: len(values)], "issued_at": TS[0], "zone": zone, "point": point,
                         "variable": "wind_speed_100m", "value": np.asarray(values, float)})


def test_power_curve_cut_in_rated_cut_out():
    cf = wg.power_curve([0, wg.CUT_IN_MS - 0.1, wg.CUT_IN_MS, 8, wg.RATED_MS, 20, wg.CUT_OUT_MS, 30])
    assert cf[0] == cf[1] == cf[2] == 0
    assert 0 < cf[3] < 1
    assert cf[4] == cf[5] == 1
    assert cf[6] == cf[7] == 0
    v = np.linspace(wg.CUT_IN_MS, wg.RATED_MS, 50)
    assert (np.diff(wg.power_curve(v)) > 0).all()
    assert np.isnan(wg.power_curve([np.nan]))[0]


def test_shear_raises_speed_above_100m():
    assert wg.to_hub_height(10.0, 150) > 10.0 > wg.to_hub_height(10.0, 80)
    assert wg.to_hub_height(10.0, 100) == pytest.approx(10.0)


def test_implied_output_bounded_by_capacity():
    out = wg.implied_output(weather([2, 6, 10, 14, 26, 18]))
    farms = static.wind_farms().dropna(subset=["region", "capacity_mw"])
    assert set(out["bm_unit"]) == set(farms["bm_unit"])
    assert (out["implied_mwh"] >= 0).all()
    assert (out["implied_mwh"] <= out["capacity_mw"] * wg.AVAILABILITY + 1e-9).all()


def test_nearest_point_is_used():
    w = pd.concat([weather([20] * 6, "moray_firth"), weather([2] * 6, "london")])
    ws = wg.farm_wind(w, static.wind_farms())
    assert set(ws["ws_100m"]) == {20.0}, "every mapped Scottish farm is nearer Moray Firth than London"


def test_zone_mean_fallback_for_unknown_points():
    w = cache.read("weather/openmeteo_historical_forecast")
    out = wg.implied_output(w)
    assert len(out) and out["implied_mwh"].notna().all()


def test_gap_non_negative_and_regional():
    implied = wg.implied_output(weather([14] * 6))
    farms = implied["bm_unit"].unique()
    rng = np.random.default_rng(0)
    metered = pd.DataFrame([{"ts": t, "bm_unit": f"{f}-1", "mwh": rng.uniform(0, 1500)} for t in TS for f in farms])
    g = wg.gap(implied, metered)
    assert list(g.columns) == wg.COLUMNS
    assert (g["mwh"] >= 0).all()
    assert set(g["region"]) <= {"N", "P"} and set(g["kind"]) == {"modelled"}
    assert (g["mwh"] >= (g["implied_mwh"] - g["metered_mwh"]).clip(lower=0) - 1e-9).all()
    over = metered.assign(mwh=1e6)
    assert (wg.gap(implied, over)["mwh"] == 0).all()


def test_missing_metered_hours_are_dropped_not_counted():
    implied = wg.implied_output(weather([14] * 6))
    one = implied["bm_unit"].iloc[0]
    metered = pd.DataFrame({"ts": TS[:2], "bm_unit": one, "mwh": [0.0, 0.0]})
    g = wg.gap(implied, metered)
    assert set(g["ts"]) == set(TS[:2]) and (g["farms"] == 1).all()


def test_estimate_empty_without_metered():
    out = wg.estimate(weather([14] * 6), None)
    assert out.empty and list(out.columns) == wg.COLUMNS
