import numpy as np
import pandas as pd
import pytest

from pipeline.ingest import weather_v2 as w


class Resp:
    status_code = 200
    headers = {}

    def __init__(self, body):
        self.body = body

    def raise_for_status(self):
        pass

    def json(self):
        return self.body


class Client:
    """Answers every request with one location per requested coordinate, from a per-url hourly payload."""

    def __init__(self, hourly):
        self.hourly, self.calls = hourly, []

    def get(self, url, params):
        self.calls.append((url, params))
        n = len(params["latitude"].split(","))
        return Resp([{"hourly": self.hourly(url, params, i)} for i in range(n)])


T = ["2026-10-26T00:00", "2026-10-26T01:00", "2026-10-26T02:00"]


def hist_payload(url, params, i):
    suffix = "_previous_day1" if "previous" in url else ""
    base = {"time": T}
    for v in params["hourly"].split(","):
        base[v] = [10.0 + i, 12.0 + i, 14.0 + i]
    return base


@pytest.fixture(autouse=True)
def online(monkeypatch):
    monkeypatch.delenv("LG_OFFLINE", raising=False)
    monkeypatch.setattr(w.time, "sleep", lambda s: None)


def test_locations_cover_cities_and_wind_farms():
    loc = w.locations()
    assert {"london", "glasgow", "paris", "berlin", "amsterdam", "brussels", "oslo", "birmingham", "manchester"} <= set(loc.location)
    farms = loc[loc.location.str.startswith("farm:")]
    assert len(farms) >= 10 and (farms.zone == "GB").all() and (farms.weight > 0).all()
    assert loc.location.is_unique


def test_archive_and_historical_forecast_long_shape_and_chunking():
    c = Client(hist_payload)
    df = w.fetch_archive("2026-10-26", "2026-10-26", c)
    assert list(df.columns) == w.COLUMNS
    assert set(df.variable) == set(w.VARIABLES) and (df.stat == "value").all()
    assert len(df) == len(w.locations()) * len(w.VARIABLES) * 3
    assert c.calls[0][1]["hourly"] == ",".join(w.VARIABLES) and c.calls[0][1]["wind_speed_unit"] == "ms"
    c2 = Client(hist_payload)
    w.fetch_historical_forecast("2026-01-01", "2026-03-15", c2)
    assert len(c2.calls) == 3  # 74 days in 31-day chunks


def test_start_naive_and_end_tz_aware_are_both_accepted():
    c = Client(hist_payload)
    df = w.fetch_archive("2026-10-26", pd.Timestamp("2026-10-26T15:00", tz="UTC"), c)
    assert len(c.calls) == 1 and len(df) > 0


def test_previous_day1_uses_suffixed_variables_and_marks_issue_time_24h_earlier():
    def payload(url, params, i):
        return {"time": T, **{v: [1.0, 2.0, 3.0] for v in params["hourly"].split(",")}}

    c = Client(payload)
    df = w.fetch_previous_day1("2026-10-26", "2026-10-26", c)
    assert c.calls[0][1]["hourly"] == "temperature_2m_previous_day1,precipitation_previous_day1,cloud_cover_previous_day1,wind_speed_10m_previous_day1"
    assert set(df.variable) == set(w.PREVIOUS_VARIABLES)
    assert ((df.ts - df.issued_at) == pd.Timedelta(hours=24)).all()


def test_wrong_location_count_is_an_error():
    class Short(Client):
        def get(self, url, params):
            return Resp([{"hourly": hist_payload(url, params, 0)}])

    with pytest.raises(ValueError):
        w.fetch_archive("2026-10-26", "2026-10-26", Short(hist_payload))


def test_offline_refuses(monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    with pytest.raises(RuntimeError):
        w.fetch_live()


def members(n=51, base=10.0):
    h = {"time": T, "wind_gusts_10m": [base] * 3}
    for k in range(1, n):
        h[f"wind_gusts_10m_member{k:02d}"] = [base + k * 0.1] * 3
    return h


def test_ensemble_summary_counts_members_and_threshold_share():
    h = members()
    s = w.summarise_members(h, "wind_gusts_10m", {"wind_gusts_10m": ("hi", 12.0)})
    got = s[s.ts == s.ts.iloc[0]].set_index("stat")["value"]
    assert got["members"] == 51 and got["mean"] == pytest.approx(np.mean([10 + k * 0.1 for k in range(51)]))
    assert got["p10"] < got["mean"] < got["p90"] and got["std"] > 0
    assert got["share_beyond_threshold"] == pytest.approx(sum(10 + k * 0.1 >= 12.0 for k in range(51)) / 51)
    cold = w.summarise_members({"time": T, "temperature_2m": [0.0] * 3, "temperature_2m_member01": [5.0] * 3}, "temperature_2m", {"temperature_2m": ("lo", 1.0)})
    assert cold[cold.stat == "share_beyond_threshold"]["value"].iloc[0] == 0.5


def test_fetch_ensemble_batches_locations_and_skips_nothing():
    def payload(url, params, i):
        h = {"time": T}
        for v in params["hourly"].split(","):
            h[v] = [1.0] * 3
            h[v + "_member01"] = [3.0] * 3
        return h

    c = Client(payload)
    df = w.fetch_ensemble(client=c, now="2026-11-08T10:30")
    assert set(df.stat) >= {"mean", "std", "p10", "p90", "members"}
    assert set(df.location) == set(w.locations().location)
    assert (df.issued_at == pd.Timestamp("2026-11-08T10:00", tz="UTC")).all()
    assert all(call[1]["models"] == w.ENSEMBLE_MODEL for call in c.calls)
    assert df[df.stat == "mean"]["value"].eq(2.0).all()


def archive_frame():
    rng = np.random.default_rng(3)
    ts = pd.date_range("2026-01-01", periods=1000, freq="h", tz="UTC")
    rows = []
    for loc, zone in (("glasgow", "GB"), ("paris", "FR")):
        for v, scale in (("wind_gusts_10m", 8), ("precipitation", 0.5), ("temperature_2m", 6), ("cloud_cover", 50), ("wind_speed_100m", 7)):
            rows.append(pd.DataFrame({"ts": ts, "issued_at": ts, "location": loc, "zone": zone, "variable": v, "stat": "value",
                                      "value": np.abs(rng.normal(scale, scale / 2, len(ts))) if v != "temperature_2m" else rng.normal(scale, 3, len(ts))}))
    return pd.concat(rows, ignore_index=True)


def test_alert_thresholds_are_percentiles_and_alerts_flag_about_one_percent():
    a = archive_frame()
    th = w.alert_thresholds(a)
    assert set(th.variable) == {"wind_gusts_10m", "precipitation", "temperature_2m"}
    assert set(th[th.variable == "temperature_2m"].side) == {"lo"} and set(th[th.variable == "wind_gusts_10m"].side) == {"hi"}
    al = w.alert(a, th)
    share = al.groupby("variable")["alert"].mean()
    assert (share > 0.005).all() and (share < 0.02).all()


def test_zone_features_aggregate_and_include_alert_shares():
    a = archive_frame()
    th = w.alert_thresholds(a)
    z = w.zone_features(a, th)
    assert {"gust_max_ms", "cloud_mean_pct", "precip_mm", "temp_c", "alert_gust_share", "alert_rain_share"} <= set(z.columns)
    assert set(z.zone) == {"GB", "FR"} and not z.duplicated(["ts", "zone"]).any()
    first = a[(a.ts == a.ts.min()) & (a.zone == "GB") & (a.variable == "wind_gusts_10m")]["value"].max()
    assert z[(z.ts == a.ts.min()) & (z.zone == "GB")]["gust_max_ms"].iloc[0] == pytest.approx(first)


def test_write_dedupes_and_keeps_every_live_run(tmp_path, monkeypatch):
    from pipeline import cache

    monkeypatch.setattr(cache, "DATA", tmp_path)
    a = archive_frame().head(20)
    w.write(a, "archive")
    w.write(a, "archive")
    assert len(w.read("archive")) == 20
    live1 = a.assign(issued_at=pd.Timestamp("2026-11-08T00:00", tz="UTC"))
    live2 = a.assign(issued_at=pd.Timestamp("2026-11-08T06:00", tz="UTC"), value=a.value + 1)
    w.write(live1, "live_forecast")
    w.write(live2, "live_forecast")
    assert len(w.read("live_forecast")) == 40


def test_comparison_reports_change_per_target_and_zone():
    from pipeline.experiments import weather_v2_backtest as exp

    def frame(mae, pin):
        return pd.DataFrame({"fold": [0, 1], "zone": "GB", "target": "price_da", "model": "lgbm_q", "mae": mae, "n": [10, 30],
                             "coverage_p10_p90": [0.8, 0.8], "pinball": pin})

    cmp = exp.compare(frame([10.0, 10.0], [4.0, 4.0]), frame([9.0, 9.0], [4.4, 4.4]))
    r = cmp.iloc[0]
    assert r.n_base == 40 and r.mae_change_pct == pytest.approx(-10.0) and r.pinball_change_pct == pytest.approx(10.0)
    text = exp.report(cmp)
    assert "-10.0%" in text and "+10.0%" in text and "0 of 1" in text


def test_variant_patches_features_and_restores_them():
    from pipeline.experiments import weather_v2_backtest as exp
    from pipeline.features import build
    from pipeline.models import quantile

    before = (build.build_history, list(quantile.FEATURES), list(schemas.FEATURE_COLUMNS))
    extra = pd.DataFrame({"ts": [pd.Timestamp("2026-01-01", tz="UTC")], "zone": ["GB"], "gust_max_ms": [20.0]})
    with exp.variant(extra, pd.Timestamp("2025-01-01", tz="UTC")):
        assert "gust_max_ms" in quantile.FEATURES and "gust_max_ms" in schemas.FEATURE_COLUMNS
    assert (build.build_history, quantile.FEATURES, schemas.FEATURE_COLUMNS) == before


def test_variant_history_merges_extra_columns_after_building_with_live_columns(monkeypatch):
    from pipeline.experiments import weather_v2_backtest as exp
    from pipeline.features import build

    ts = pd.date_range("2025-06-01", periods=3, freq="h", tz="UTC")

    def stub(*a, **k):  # like build._finish: selects whatever schemas.FEATURE_COLUMNS says at call time
        base = pd.DataFrame({"ts": ts, "zone": "GB", **{c: 1.0 for c in schemas.FEATURE_COLUMNS}})
        return base[["ts", "zone", *schemas.FEATURE_COLUMNS]]

    monkeypatch.setattr(build, "build_history", stub)
    extra = pd.DataFrame({"ts": ts[1:], "zone": "GB", "gust_max_ms": [20.0, 21.0]})
    with exp.variant(extra, ts[0]):
        h = build.build_history()
    assert list(h["gust_max_ms"].dropna()) == [20.0, 21.0] and h["gust_max_ms"].isna().sum() == 1
    assert "gust_max_ms" not in schemas.FEATURE_COLUMNS


from pipeline import schemas  # noqa: E402
