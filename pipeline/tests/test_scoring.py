import pandas as pd
import pytest

from pipeline import cache, forecast_log, schemas, scoring

T0 = pd.Timestamp("2026-11-01", tz="UTC")


def h(n):
    return T0 + pd.Timedelta(hours=n)


def actuals(zones=("GB",), series="system_price", hours=80):
    rows = [{"ts": h(i), "zone": z, "series": series, "value": 100.0 + i, "unit": "GBP/MWh"} for z in zones for i in range(hours)]
    return pd.DataFrame(rows)


def fc(made, target_hour, p10, p50, p90, zone="GB", target="gb_system_price", version="m1"):
    return {"made_at": h(made), "zone": zone, "target": target, "ts": h(target_hour), "horizon_h": max(target_hour - made, 0),
            "p10": p10, "p50": p50, "p90": p90, "model_version": version}


def metric(df, name, model="m1", zone="GB", target="gb_system_price"):
    r = df[(df.metric == name) & (df.model == model) & (df.zone == zone) & (df.target == target)]
    assert len(r) == 1, (name, model, len(r))
    return r.iloc[0]


LOG = pd.DataFrame(
    [
        fc(30, 34, 130, 140, 150),  # actual 134, persistence 129, yesterday 110
        fc(30, 40, 120, 135, 138),  # actual 140, outside the band
        fc(50, 34, 0, 1, 2),  # logged after its outcome
        fc(34, 34, 0, 1, 2),  # logged at its outcome time
        fc(1, 2, 90, 100, 110),  # no day-old value to compare with
    ]
)


def test_forecasts_logged_after_their_outcome_are_excluded():
    zones, _ = scoring.score(LOG, actuals())
    assert metric(zones, "forecasts_scored")["value"] == 3


def test_mae_coverage_and_baselines_on_hand_made_cases():
    zones, _ = scoring.score(LOG, actuals())
    mae = metric(zones, "mae")
    assert mae["value"] == pytest.approx((6 + 5) / 2) and mae["n"] == 2
    assert metric(zones, "coverage_p10_p90")["value"] == 0.5
    assert metric(zones, "mae", "persistence")["value"] == pytest.approx((5 + 11) / 2)
    assert metric(zones, "mae", "yesterday")["value"] == pytest.approx((24 + 24) / 2)
    assert metric(zones, "mae_ratio_vs_persistence")["value"] == pytest.approx(5.5 / 8)


def test_window_is_since_first_forecast_to_last_outcome():
    zones, _ = scoring.score(LOG, actuals())
    r = metric(zones, "forecasts_scored")
    assert r["window_start"] == h(1) and r["window_end"] == h(40)


def test_baselines_use_only_values_known_at_made_at():
    log = pd.DataFrame([fc(30, 60, 150, 160, 170)])  # 30 h ahead: yesterday is two days back
    df = scoring.attach_outcomes(log, actuals())
    assert df.loc[0, "actual"] == 160 and df.loc[0, "persistence"] == 129 and df.loc[0, "yesterday"] == 100 + 12
    on_the_hour = scoring.attach_outcomes(pd.DataFrame([fc(30, 54, 0, 1, 2)]), actuals())
    assert on_the_hour.loc[0, "yesterday"] == 100 + 54 - 48  # 24 h ahead needs two days, the day-old hour is not complete yet


def test_day_ahead_results_are_public_from_noon_the_day_before():
    base = actuals(("FR",), "price_da")
    rows = [fc(h_, 58, 140, 150, 160, "FR", "price_da") for h_ in (35, 36, 37)]  # 58 is 10:00 on 3 Nov; noon on 2 Nov is hour 36
    rows += [fc(h_, 58, 140, 150, 160, "FR", "load") for h_ in (35, 36, 37)]
    base = pd.concat([base, actuals(("FR",), "load")])
    df = scoring.attach_outcomes(pd.DataFrame(rows), base)
    assert list(df["valid"]) == [True, False, False, True, True, True]


def test_overall_is_unitless_and_has_no_zone():
    log = pd.DataFrame(
        [fc(30, 34, 130, 140, 150, z, "load") for z in ("GB", "FR")] + [fc(30, 40, 120, 135, 138, "GB", "load")]
    )
    zones, overall = scoring.score(log, actuals(("GB", "FR"), "load"))
    assert "zone" not in overall.columns
    o = overall[overall.target == "load"].set_index("metric")
    assert o.loc["forecasts_scored", "value"] == 3
    gb = metric(zones, "mae_ratio_vs_persistence", zone="GB", target="load")["value"]
    fr = metric(zones, "mae_ratio_vs_persistence", zone="FR", target="load")["value"]
    assert o.loc["mae_ratio_vs_persistence", "value"] == pytest.approx((gb + fr) / 2)
    assert o.loc["coverage_p10_p90", "value"] == pytest.approx((0.5 * 2 + 1.0 * 1) / 3)
    assert "mae" not in set(overall["metric"])


def test_models_are_scored_separately():
    log = pd.DataFrame([fc(30, 34, 130, 140, 150, version="a"), fc(30, 34, 130, 134, 150, version="b")])
    zones, _ = scoring.score(log, actuals())
    assert metric(zones, "mae", "a")["value"] == 6 and metric(zones, "mae", "b")["value"] == 0


def test_no_outcomes_gives_empty_frames():
    zones, overall = scoring.score(pd.DataFrame([fc(30, 34, 1, 2, 3)]), actuals(hours=10))
    assert zones.empty and overall.empty
    assert list(zones.columns) == schemas.SCORES.names and list(overall.columns) == scoring.OVERALL_COLUMNS


def test_actuals_prefer_nordpool_over_energy_charts(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    one = actuals(("FR",), "price_da", hours=3)
    cache.write("actuals/energy_charts_price_da", one.assign(value=1.0))
    cache.write("actuals/nordpool_price_da", one.assign(value=2.0))
    got = scoring.load_actuals()
    assert len(got) == 3 and (got["value"] == 2.0).all()


def test_run_writes_validated_files(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    cache.write("actuals/elexon_system_price", actuals())
    forecast_log.append(LOG.iloc[[0, 1, 4]])
    counts = scoring.run()
    assert counts[scoring.SCORES] > 0
    schemas.validate(cache.read("scores/scores"), "scores/scores")
    assert "forecasts_scored" in set(cache.read("scores/overall")["metric"])


def test_fixtures_only_when_nothing_cached(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    zones, overall = scoring.score()
    assert list(zones.columns) == schemas.SCORES.names and list(overall.columns) == scoring.OVERALL_COLUMNS
