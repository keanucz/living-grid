"""Data quality of /state online: no fixture values served as live, plausible load per zone, sensible default at."""

from datetime import UTC, datetime
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine import data
from engine.app import app
from pipeline import cache

client = TestClient(app)
# Plausible instantaneous load in MW per zone (GB transmission demand; continental totals). NO2 has no zonal source.
LOAD_BOUNDS = {"GB": (15_000, 50_000), "FR": (30_000, 95_000), "DE-LU": (35_000, 85_000), "NL": (7_000, 20_000), "BE": (6_000, 15_000)}
TYPICAL = {"GB": 31_000, "FR": 54_000, "DE-LU": 55_000, "NL": 12_000, "BE": 10_000, "NO2": 15_600}  # NO2 = all of Norway
RUNNER = Path("/srv/hack/runner/data")


def _now_hour() -> pd.Timestamp:
    return pd.Timestamp(datetime.now(UTC)).floor("h")


def _write_live(base: Path, now: pd.Timestamp) -> None:
    """A small cache laid out like the runner's: energy_charts_* names, Energy-Charts ~3 h behind."""
    (base / "actuals").mkdir(parents=True)
    ec_ts = pd.date_range(now - pd.Timedelta(hours=12), now - pd.Timedelta(hours=3), freq="h")
    ec = pd.DataFrame(
        [{"ts": t, "zone": z, "series": "load", "value": float(v), "unit": "MW"} for t in ec_ts for z, v in TYPICAL.items() if z != "GB"]
        + [{"ts": t, "zone": z, "series": "gen_wind", "value": 1000.0, "unit": "MW"} for t in ec_ts for z in TYPICAL if z != "GB"]
    )
    ec.to_parquet(base / "actuals" / "energy_charts_load.parquet")
    gb_ts = pd.date_range(now - pd.Timedelta(hours=12), now, freq="h")
    pd.DataFrame({"ts": gb_ts, "zone": "GB", "series": "load", "value": float(TYPICAL["GB"]), "unit": "MW"}).to_parquet(
        base / "actuals" / "elexon_load.parquet"
    )
    da_ts = pd.date_range(now - pd.Timedelta(hours=12), now + pd.Timedelta(hours=30), freq="h")
    pd.DataFrame(
        [{"ts": t, "zone": z, "series": "price_da", "value": 100.0, "unit": "GBP/MWh" if z == "GB" else "EUR/MWh"} for t in da_ts for z in TYPICAL]
    ).to_parquet(base / "actuals" / "energy_charts_price_da.parquet")


@pytest.fixture
def online(tmp_path, monkeypatch):
    monkeypatch.delenv("LG_OFFLINE", raising=False)
    monkeypatch.setattr(cache, "DATA", tmp_path)
    _write_live(tmp_path, _now_hour())
    return tmp_path


def test_default_at_is_current_hour_not_tomorrow(online):
    body = client.get("/state").json()
    assert pd.Timestamp(body["at"]) == _now_hour()


def test_load_plausible_per_zone_and_no_fixture_leak(online):
    zones = {z["zone"]: z for z in client.get("/state").json()["zones"]}
    for zone, (lo, hi) in LOAD_BOUNDS.items():
        assert lo <= zones[zone]["load_mw"] <= hi, (zone, zones[zone]["load_mw"])
        assert zones[zone]["load_mw"] == TYPICAL[zone], f"{zone}: value did not come from the live cache"


def test_no2_country_level_load_and_mix_are_not_shown(online):
    no2 = next(z for z in client.get("/state").json()["zones"] if z["zone"] == "NO2")
    assert no2["load_mw"] is None and no2["mix_mw"] == {}


def test_online_never_serves_fixture_carbon_or_forecasts(online):
    zones = client.get("/state").json()["zones"]
    assert all(z["carbon"] is None for z in zones), "no live carbon file: omit rather than serve placeholders"
    assert all(z["forecast"] is None for z in zones), "no live forecast log"
    assert data.carbon().empty and data.forecast_log().empty


def test_source_names_with_underscores():
    assert data.source_of("energy_charts_load") == "energycharts"
    assert data.source_of("energycharts_price_da") == "energycharts"
    assert data.source_of("carbon_intensity_ci_gco2_kwh") == "carbonintensity"
    assert data.source_of("elexon_flow_GB_FR") == "elexon"


def test_price_source_from_live_name_is_ranked(online):
    gb = next(z for z in client.get("/state").json()["zones"] if z["zone"] == "GB")
    assert gb["price"]["source"] == "energycharts"


@pytest.mark.skipif(not (RUNNER / "actuals").is_dir(), reason="runner data not on this machine")
def test_runner_data_is_plausible(monkeypatch):
    monkeypatch.delenv("LG_OFFLINE", raising=False)
    monkeypatch.setattr(cache, "DATA", RUNNER)
    zones = {z["zone"]: z for z in client.get("/state").json()["zones"]}
    for zone, (lo, hi) in LOAD_BOUNDS.items():
        load = zones[zone]["load_mw"]
        assert load is None or lo <= load <= hi, (zone, load)
