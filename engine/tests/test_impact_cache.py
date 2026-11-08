import os

import pandas as pd

from engine import impact
from pipeline import cache
from pipeline.features import build

START, END = pd.Timestamp("2026-11-07 00:00", tz="UTC"), pd.Timestamp("2026-11-07 23:00", tz="UTC")


def _actuals_file(tmp_path):
    d = tmp_path / "actuals"
    d.mkdir(parents=True, exist_ok=True)
    f = d / "nordpool_price_da.parquet"
    pd.DataFrame({"ts": [START]}).to_parquet(f)
    return f


def test_renewables_runs_once_until_an_input_changes(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.delenv("LG_OFFLINE", raising=False)
    impact._cached.cache_clear()
    calls = []
    monkeypatch.setattr(impact, "renewables", lambda zone, s, e: calls.append(zone) or {"zone": zone, "n": len(calls)})
    f = _actuals_file(tmp_path)

    first = impact.cached_renewables("GB", START, END)
    assert impact.cached_renewables("GB", START + pd.Timedelta(minutes=20), END) is first, "same hours, same entry"
    impact.cached_renewables("FR", START, END)
    assert calls == ["GB", "FR"]

    st = f.stat()
    os.utime(f, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    assert impact.cached_renewables("GB", START, END)["n"] == 3

    (tmp_path / "features").mkdir()
    pd.DataFrame({"ts": [START]}).to_parquet(tmp_path / "features" / "latest.parquet")
    impact.cached_renewables("GB", START, END)
    assert len(calls) == 4, "a new features file invalidates the cache"


def test_model_check_reads_cached_features_and_never_rebuilds(monkeypatch):
    monkeypatch.delenv("LG_OFFLINE", raising=False)
    seen = []

    def fake_latest(now=None, rebuild=None):
        seen.append(rebuild)
        return pd.DataFrame(columns=["ts", "zone"])

    monkeypatch.setattr(build, "latest", fake_latest)
    monkeypatch.setattr("pipeline.features.latest", fake_latest)
    assert impact._model_check("GB", START, END) is None
    assert seen == [False]


def test_offline_route_is_fast_when_warm(monkeypatch):
    import time

    from fastapi.testclient import TestClient

    from engine.app import app

    monkeypatch.setenv("LG_OFFLINE", "1")
    client = TestClient(app)
    first = client.get("/impact/renewables", params={"zone": "GB"})
    assert first.status_code == 200, first.text
    t = time.perf_counter()
    again = client.get("/impact/renewables", params={"zone": "GB"})
    assert again.status_code == 200 and again.json() == first.json()
    assert time.perf_counter() - t < 0.5
