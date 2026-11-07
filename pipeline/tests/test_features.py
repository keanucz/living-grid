import numpy as np
import pandas as pd
import pytest

from pipeline import cache, schemas
from pipeline.features import build
from pipeline.features.calendar import calendar_features

START = pd.Timestamp("2026-10-10T00:00Z")
END = pd.Timestamp("2026-11-10T00:00Z")
MADE_AT = pd.Timestamp("2026-11-07T14:20Z")
HOURS = pd.date_range(START, END, freq="h", inclusive="left")
rng = np.random.default_rng(3)


def act(zone, series, values, unit="MW"):
    return pd.DataFrame({"ts": HOURS, "zone": zone, "series": series, "value": values, "unit": unit})


def synth():
    n = len(HOURS)
    daily = 1 + 0.3 * np.sin(2 * np.pi * HOURS.hour / 24)
    ec, gb_elx = [], []
    for z in schemas.ZONES:
        if z != "GB":
            ec += [
                act(z, "price_da", 60 + 20 * daily + rng.normal(0, 3, n), "EUR/MWh"),
                act(z, "load", 30000 * daily),
                act(z, "gen_wind_onshore", 3000 + 1000 * rng.random(n)),
                act(z, "gen_wind_offshore", 500 + 100 * rng.random(n)),
                act(z, "gen_solar", np.clip(4000 * np.sin(np.pi * (HOURS.hour - 6) / 12), 0, None)),
                act(z, f"flow_net_{z}", rng.normal(500, 100, n)),
                act(z, f"flow_{z}_GB", rng.normal(-800, 50, n)),
            ]
    gb_elx = [
        act("GB", "system_price", 70 + 10 * daily, "GBP/MWh"),
        act("GB", "load", 28000 * daily),
        act("GB", "gen_wind", 8000 + 2000 * rng.random(n)),
    ]
    flows = [act("GB", f"flow_GB_{p}", rng.normal(900, 40, n)) for p in ("FR", "NO2")]
    return pd.concat(ec), pd.concat(gb_elx), flows


def weather_frames():
    pts = [("GB", "london"), ("GB", "moray"), ("FR", "paris"), ("DE-LU", "hamburg"), ("NL", "ams"), ("BE", "bru"), ("NO2", "sta")]
    h, live = [], []
    for zone, pt in pts:
        for var, mu in (("wind_speed_100m", 8), ("temperature_2m", 8), ("shortwave_radiation", 150)):
            v = mu + rng.normal(0, 1, len(HOURS))
            h.append(pd.DataFrame({"ts": HOURS, "issued_at": HOURS.floor("D"), "zone": zone, "point": pt, "variable": var, "value": v}))
    fut = pd.date_range("2026-11-07T14:00Z", periods=60, freq="h")
    for issued in (pd.Timestamp("2026-11-07T06:00Z"), pd.Timestamp("2026-11-07T12:00Z"), pd.Timestamp("2026-11-08T06:00Z")):
        for zone, pt in pts:
            for var, mu in (("wind_speed_100m", 9), ("temperature_2m", 7), ("shortwave_radiation", 100)):
                v = mu + (issued.hour / 6) + rng.normal(0, 0.1, len(fut))
                live.append(pd.DataFrame({"ts": fut, "issued_at": issued, "zone": zone, "point": pt, "variable": var, "value": v}))
    return pd.concat(h), pd.concat(live)


@pytest.fixture
def populated(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.setattr(cache, "FIXTURES", tmp_path / "none")
    ec, gb, flows = synth()
    for series, d in ec.groupby("series"):
        pass
    cache.write("actuals/energy_charts_price_da", ec[ec.series == "price_da"])
    cache.write("actuals/energy_charts_load", ec[ec.series == "load"])
    cache.write("actuals/energy_charts_generation", ec[ec.series.str.startswith("gen_")])
    cache.write("actuals/energy_charts_flows", ec[ec.series.str.startswith("flow_")])
    for s, d in gb.groupby("series"):
        cache.write(f"actuals/elexon_{s}", d)
    for f in flows:
        cache.write(f"actuals/elexon_{f.series.iloc[0]}", f)
    h, live = weather_frames()
    cache.write("weather/historical_forecast", h)
    cache.write("weather/live_forecast", live)
    days = pd.date_range(pd.Timestamp("2021-01-01T00:00Z"), END.normalize(), freq="D")
    m = pd.concat(
        [pd.DataFrame({"ts": days, "series": s, "value": v, "unit": u, "source": "t"}) for s, v, u in (("gas_ttf", 35.0, "EUR/MWh"), ("eua", 70.0, "EUR/t"))]
    )
    m["value"] += np.arange(len(m)) % 7 * 0.1
    cache.write("markets/gas_carbon", m)
    rows = [(z, hr, mo, 0.5) for z in schemas.ZONES for hr in range(24) for mo in range(1, 13)]
    cache.write("features/gas_marginal_share", pd.DataFrame(rows, columns=["zone", "hour_of_day", "month", "share"]))
    return tmp_path


def test_calendar_is_utc():
    c = calendar_features(pd.DatetimeIndex([pd.Timestamp("2026-11-07T23:00Z")]))
    assert c.iloc[0].tolist() == [23, 5, 11]


def test_future_features_match_contract(populated):
    df = build.build_future(MADE_AT)
    schemas.validate(df, "features/latest")
    assert set(df.zone) == set(schemas.ZONES)
    assert df.ts.min() == pd.Timestamp("2026-11-07T15:00Z") and df.ts.max() == pd.Timestamp("2026-11-09T14:00Z")
    assert len(df) == 48 * 6 and not df.isna().any().any()
    assert (df.wind_gen_fc_mw >= 0).all()
    assert np.allclose(df.residual_load_mw, df.load_fc_mw - df.wind_gen_fc_mw - df.solar_gen_fc_mw)


def test_lag_uses_freshest_complete_day(populated):
    df = build.build_future(MADE_AT)
    px = pd.concat([cache.read("actuals/energy_charts_price_da")]).set_index(["zone", "ts"])["value"]
    near = df[(df.zone == "FR") & (df.ts == pd.Timestamp("2026-11-08T08:00Z"))].iloc[0]
    far = df[(df.zone == "FR") & (df.ts == pd.Timestamp("2026-11-09T08:00Z"))].iloc[0]
    assert near.price_lag_24h == pytest.approx(px[("FR", pd.Timestamp("2026-11-07T08:00Z"))])
    assert far.price_lag_24h == pytest.approx(px[("FR", pd.Timestamp("2026-11-07T08:00Z"))])


def test_future_rows_ignore_data_after_made_at(populated):
    before = build.build_future(MADE_AT)
    for name in ("actuals/energy_charts_price_da", "actuals/energy_charts_load", "actuals/energy_charts_generation",
                 "actuals/energy_charts_flows", "actuals/elexon_load", "actuals/elexon_gen_wind",
                 "actuals/elexon_system_price", "actuals/elexon_flow_GB_FR", "actuals/elexon_flow_GB_NO2"):
        d = cache.read(name)
        d.loc[d.ts >= MADE_AT.floor("h") - pd.Timedelta(hours=0), "value"] += 1e6
        cache.write(name, d)
    live = cache.read("weather/live_forecast")
    live.loc[live.issued_at > MADE_AT, "value"] += 100
    cache.write("weather/live_forecast", live)
    m = cache.read("markets/gas_carbon")
    m.loc[m.ts >= MADE_AT.floor("D"), "value"] += 1000
    cache.write("markets/gas_carbon", m)
    pd.testing.assert_frame_equal(build.build_future(MADE_AT), before)


def test_latest_weather_issue_before_made_at_is_used(populated):
    df = build.build_future(MADE_AT)
    live = cache.read("weather/live_forecast")
    t = pd.Timestamp("2026-11-08T00:00Z")
    expect = live[(live.issued_at == pd.Timestamp("2026-11-07T12:00Z")) & (live.zone == "FR") & (live.ts == t)
                  & (live.variable == "wind_speed_100m")].value.mean()
    got = df[(df.zone == "FR") & (df.ts == t)].wind_speed_100m.iloc[0]
    assert got == pytest.approx(expect)


def test_history_rows_equal_rows_built_from_data_known_at_their_origin(populated):
    hist = build.build_history(pd.Timestamp("2026-11-01T00:00Z"), pd.Timestamp("2026-11-05T00:00Z"))
    schemas.validate(hist, "features/latest")
    row = hist[(hist.ts == pd.Timestamp("2026-11-03T18:00Z"))].reset_index(drop=True)
    origin = pd.Timestamp("2026-11-03T18:00Z") - pd.Timedelta(hours=build.HISTORY_LEAD_H)
    inp = build.Inputs(origin)
    rebuilt = build._finish(pd.concat([build._zone_features(z, pd.DatetimeIndex([row.ts[0]]), pd.DatetimeIndex([origin]), inp)
                                      for z in schemas.ZONES])).reset_index(drop=True)
    num = [c for c in schemas.FEATURE_COLUMNS if c not in ("wind_speed_100m", "solar_irradiance_wm2", "temperature_c",
                                                         "wind_gen_fc_mw", "solar_gen_fc_mw", "residual_load_mw")]
    pd.testing.assert_frame_equal(row[["ts", "zone", *num]], rebuilt[["ts", "zone", *num]], check_dtype=False)


def test_latest_writes_cache_online_and_reads_it_offline(populated, monkeypatch):
    monkeypatch.delenv("LG_OFFLINE", raising=False)
    built = build.latest(MADE_AT)
    assert cache.exists("features/latest")
    monkeypatch.setenv("LG_OFFLINE", "1")
    pd.testing.assert_frame_equal(build.latest(), built)


def test_missing_input_raises_clearly(populated):
    (populated / "markets/gas_carbon.parquet").unlink()
    with pytest.raises(ValueError, match="missing inputs"):
        build.build_future(MADE_AT)


def test_offline_latest_serves_fixture(monkeypatch, tmp_path):
    monkeypatch.setenv("LG_OFFLINE", "1")
    monkeypatch.setattr(cache, "DATA", tmp_path)
    df = build.latest()
    assert set(df.zone) == set(schemas.ZONES) and len(df)
    schemas.validate(df, "features/latest")


def test_power_curve():
    f = build.power_curve(np.array([0.0, 3.0, 7.5, 12.0, 20.0, 26.0]))
    assert f[0] == 0 and f[1] == 0 and 0 < f[2] < 1 and f[3] == 1 and f[4] == 1 and f[5] == 0
