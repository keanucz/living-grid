import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine.app import app
from engine.schemas import RevealResponse
from pipeline import cache

client = TestClient(app)
FROZEN = pd.read_parquet(cache.FIXTURES / "forecasts" / "frozen_monday.parquet")


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.setenv("LG_OFFLINE", "1")
    return tmp_path


def write(tmp_path, name, df):
    p = tmp_path / f"{name}.parquet"
    p.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(p)


def results(zones, offset=0.0, seen="2026-11-08T10:01Z"):
    f = FROZEN[FROZEN["zone"].isin(zones)]
    return pd.DataFrame(
        {
            "seen_at": pd.Timestamp(seen),
            "zone": f["zone"].to_numpy(),
            "ts": f["ts"].to_numpy(),
            "value": (f["p50"] + offset).to_numpy(),
            "unit": "EUR/MWh",
        }
    )


def get():
    r = client.get("/reveal")
    assert r.status_code == 200, r.text
    return RevealResponse.model_validate(r.json())


def test_none_published(isolated):
    write(isolated, "forecasts/frozen_monday", FROZEN)
    body = get()
    assert body.zones_published == 0 and body.mean_abs_error is None and body.zones_inside_band is None
    assert len(body.zones) == 6 and all(not z.published and z.mae is None for z in body.zones)
    assert all(h.actual is None for z in body.zones for h in z.hours)
    assert body.frozen_at == FROZEN["frozen_at"].max()


def test_gb_only(isolated):
    write(isolated, "forecasts/frozen_monday", FROZEN)
    write(isolated, "reveal/results", results(["GB"], offset=3.0))
    body = get()
    gb = next(z for z in body.zones if z.zone == "GB")
    assert gb.published and gb.mae == pytest.approx(3.0) and gb.inside_band_share == 1.0
    assert body.zones_published == 1 and body.mean_abs_error == pytest.approx(3.0) and body.zones_inside_band == 1
    assert all(not z.published for z in body.zones if z.zone != "GB")


def test_all_published_latest_observation_wins(isolated):
    write(isolated, "forecasts/frozen_monday", FROZEN)
    old = results(list(FROZEN["zone"].unique()), offset=500.0, seen="2026-11-08T11:55Z")
    new = results(list(FROZEN["zone"].unique()), offset=0.0, seen="2026-11-08T12:05Z")
    write(isolated, "reveal/results", pd.concat([old, new]))
    body = get()
    assert body.zones_published == 6 and body.mean_abs_error == 0 and body.zones_inside_band == 6


def test_partial_zone_is_not_published(isolated):
    write(isolated, "forecasts/frozen_monday", FROZEN)
    write(isolated, "reveal/results", results(["FR"]).head(5))
    fr = next(z for z in get().zones if z.zone == "FR")
    assert not fr.published and fr.mae == 0 and sum(h.actual is not None for h in fr.hours) == 5


def test_latest_freeze_is_served(isolated):
    later = FROZEN.assign(frozen_at=FROZEN["frozen_at"] + pd.Timedelta(hours=10), p50=FROZEN["p50"] + 1)
    write(isolated, "forecasts/frozen_monday", pd.concat([FROZEN, later]))
    body = get()
    assert body.frozen_at == later["frozen_at"].max()


def test_online_never_serves_the_fixture_as_a_freeze(monkeypatch):
    monkeypatch.delenv("LG_OFFLINE")
    r = client.get("/reveal")
    assert r.status_code == 404 and "not frozen yet" in r.json()["detail"]


def test_offline_falls_back_to_fixture():
    assert get().frozen_at == FROZEN["frozen_at"].max()
