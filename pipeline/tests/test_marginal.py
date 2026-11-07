import numpy as np
import pandas as pd
import pytest

from pipeline import cache, marginal, schemas

DAYS = pd.date_range("2026-11-01", periods=60 * 24, freq="h", tz="UTC")
MC = 30 / 0.5 + 70 * 0.37  # TTF 30, EUA 70


def markets(ttf=30.0, eua=70.0):
    d = pd.date_range("2026-10-25", periods=80, freq="D", tz="UTC")
    return pd.DataFrame(
        [{"ts": t, "series": s, "value": v, "unit": "x", "source": "t"} for t in d for s, v in (("gas_ttf", ttf), ("eua", eua))]
    )


def actuals(zone="NL", marginal_hours=range(12), gas_series="gen_fossil_gas", unit="EUR/MWh", price_scale=1.0, gas_on=True):
    on = DAYS.hour.isin(list(marginal_hours))
    price = np.where(on, MC * price_scale, 20.0 * price_scale)
    gas = np.full(len(DAYS), 1000.0 if gas_on else 0.0)
    rows = pd.concat(
        [
            pd.DataFrame({"ts": DAYS, "zone": zone, "series": "price_da", "value": price, "unit": unit}),
            pd.DataFrame({"ts": DAYS, "zone": zone, "series": gas_series, "value": gas, "unit": "MW"}),
        ]
    )
    return rows


def cell(share, zone, hour, month):
    return share[(share.zone == zone) & (share.hour_of_day == hour) & (share.month == month)]["share"].iloc[0]


def test_gas_priced_hours_score_high_and_others_low():
    share, meta = marginal.estimate(actuals(), markets())
    assert cell(share, "NL", 3, 11) > 0.8 and cell(share, "NL", 15, 11) < 0.2
    assert meta[meta.zone == "NL"].iloc[0]["basis"] == "estimated"
    assert meta[meta.zone == "NL"].iloc[0]["raw_share"] == pytest.approx(0.5)


def test_scarcity_prices_and_idle_gas_are_not_gas_marginal():
    spike = actuals(price_scale=3.0)  # price far above 1.5x of gas cost, and renewables hours at 3x of 20 too
    s, _ = marginal.estimate(spike, markets())
    assert cell(s, "NL", 3, 11) < marginal.PRIOR["NL"]
    off = actuals(gas_on=False)
    s2, _ = marginal.estimate(off, markets())
    assert cell(s2, "NL", 3, 11) < marginal.PRIOR["NL"]


def test_every_zone_hour_and_month_is_present_and_in_unit_interval():
    share, _ = marginal.estimate(actuals(), markets())
    assert len(share) == 6 * 24 * 12
    assert share.groupby("zone").size().eq(24 * 12).all()
    assert share["share"].between(0, 1).all()
    assert not share.duplicated(["zone", "hour_of_day", "month"]).any()
    schemas.validate(share, "features/gas_marginal_share")


def test_no_data_gives_the_priors_and_zones_differ():
    share, meta = marginal.estimate(pd.DataFrame(columns=schemas.ACTUALS.names), None)
    for z, p in marginal.PRIOR.items():
        assert share[share.zone == z]["share"].to_numpy() == pytest.approx(p)
    assert set(meta["basis"]) == {"prior only"}
    assert share.groupby("zone")["share"].mean().nunique() > 1


def test_missing_markets_or_gas_series_fall_back_to_the_prior():
    s, m = marginal.estimate(actuals(), None)
    assert cell(s, "NL", 3, 11) == marginal.PRIOR["NL"] and m[m.zone == "NL"].iloc[0]["basis"] == "prior only"
    s2, m2 = marginal.estimate(actuals(gas_series="gen_wind"), markets())
    assert cell(s2, "NL", 3, 11) == marginal.PRIOR["NL"] and m2[m2.zone == "NL"].iloc[0]["basis"] == "prior only"


def test_gb_prices_in_pounds_are_converted_to_euros():
    gb = actuals("GB", gas_series="gen_gas", unit="GBP/MWh", price_scale=1 / marginal.EUR_PER_GBP)
    s, _ = marginal.estimate(gb, markets())
    assert cell(s, "GB", 3, 11) > 0.8


def test_market_costs_forward_fill_the_daily_series():
    hours = pd.date_range("2026-11-03 05:00", periods=3, freq="h", tz="UTC")
    cost = marginal._market_costs(markets(), hours)
    assert cost.round(6).eq(round(MC, 6)).all()


def test_fixture_fallback_when_nothing_is_cached(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    fx = marginal.load()
    assert {"zone", "hour_of_day", "month", "share"} <= set(fx.columns) and fx["share"].between(0, 1).all()
    assert set(fx.zone) == set(schemas.ZONES) and (fx.hour_of_day.nunique(), len(fx)) == (24, 6 * 24)


def test_run_writes_both_files_with_no_cache_at_all(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    counts = marginal.run()
    assert counts[marginal.SHARE] == 6 * 24 * 12
    schemas.validate(cache.read("features/gas_marginal_share"), "features/gas_marginal_share")
    assert list(cache.read("features/gas_marginal_share_meta").columns) == marginal.META_COLUMNS


def test_run_uses_cached_actuals_and_markets(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    cache.write("actuals/energy_charts_price_da", actuals().query("series == 'price_da'"))
    cache.write("actuals/energy_charts_generation", actuals().query("series != 'price_da'"))
    cache.write("markets/gas_carbon", markets())
    marginal.run()
    got = cache.read("features/gas_marginal_share")
    assert cell(got, "NL", 3, 11) > 0.8


def test_passthrough_reads_this_file(tmp_path, monkeypatch):
    passthrough = pytest.importorskip("engine.interventions.passthrough")
    monkeypatch.setattr(cache, "DATA", tmp_path)
    cache.write("actuals/energy_charts_price_da", actuals().query("series == 'price_da'"))
    cache.write("actuals/energy_charts_generation", actuals().query("series != 'price_da'"))
    cache.write("markets/gas_carbon", markets())
    marginal.run()
    feats = pd.DataFrame({"zone": ["NL", "NL", "FR"], "ts": pd.to_datetime(["2026-11-05 03:00", "2026-11-05 15:00", "2026-11-05 03:00"], utc=True)})
    share, source = passthrough.marginal_share(feats)
    assert source.startswith("estimated") and share[0] > 0.8 > share[1] and share[2] == pytest.approx(marginal.PRIOR["FR"])
