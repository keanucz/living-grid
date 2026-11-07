import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine import impact
from engine.app import app

client = TestClient(app)


def synth(slope=-6.0, n=24 * 40, seed=1, solar=-3.0):
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2026-09-01", periods=n, freq="h", tz="UTC")
    wind = rng.uniform(500, 12000, n)
    sun = np.clip(np.sin((idx.hour - 6) / 12 * np.pi), 0, None) * rng.uniform(2000, 9000, n)
    load = rng.uniform(25000, 40000, n)
    price = 90 + slope * wind / 1000 + solar * sun / 1000 + 1.5 * load / 1000 + rng.normal(0, 1, n)
    rows = []
    for series, v in [("price_da", price), ("gen_wind", wind), ("gen_solar", sun), ("load", load)]:
        rows.append(pd.DataFrame({"ts": idx, "zone": "FR", "series": series, "value": v, "unit": "x"}))
    return pd.concat(rows, ignore_index=True)


def test_regression_recovers_known_slopes():
    p = impact.panel("FR", synth(), gas=pd.Series(dtype=float))
    m = impact.fit(p)
    assert m["wind_per_gw"] == pytest.approx(-6.0, abs=0.3)
    assert m["solar_per_gw"] == pytest.approx(-3.0, abs=0.3)
    assert m["r2"] > 0.95


def test_effect_money_and_sentence():
    a = synth()
    out = impact.renewables("FR", "2026-10-01T00:00Z", "2026-10-01T23:00Z", a=a, gas=pd.Series(dtype=float))
    assert len(out["hours"]) == 24
    h = out["hours"][12]
    assert h["wind_effect_per_mwh"] == pytest.approx(-6.0 * h["wind_mw"] / 1000, abs=0.4 * h["wind_mw"] / 1000)
    load = a[(a.series == "load") & (a.ts == pd.Timestamp(h["ts"]))]["value"].iloc[0]
    assert h["wind_effect_money"] == pytest.approx(h["wind_effect_per_mwh"] * load, rel=1e-3)
    assert out["wind_total_money"] < 0 and "Wind cut France prices by €" in out["sentence"] and "estimate" in out["sentence"]
    assert out["kind"] == "estimated" and out["fit"]["wind_slope_clear"]


def test_too_little_data_raises():
    with pytest.raises(LookupError):
        impact.renewables("FR", "2026-09-01T00:00Z", "2026-09-01T05:00Z", a=synth(n=20), gas=pd.Series(dtype=float))


def test_gb_uses_pound_sign():
    assert "£" in impact.sentence("GB", "Great Britain", "today", -31.0, -24e6, None, None)
    assert "£24m" in impact.sentence("GB", "Great Britain", "today", -31.0, -24e6, None, None)


def test_route_unknown_zone_and_fixture_zone():
    assert client.get("/impact/renewables", params={"zone": "XX"}).status_code == 404
    r = client.get("/impact/renewables", params={"zone": "FR"})
    assert r.status_code in (200, 404), r.text
    if r.status_code == 200:
        b = r.json()
        assert b["kind"] == "estimated" and b["currency"] == "EUR" and b["hours"]
