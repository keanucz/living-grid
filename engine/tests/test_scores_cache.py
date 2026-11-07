import os

import pandas as pd

from engine.routes import scores as route
from pipeline import cache


def _touch_log(tmp_path):
    d = tmp_path / "forecasts"
    d.mkdir(parents=True, exist_ok=True)
    f = d / "log.parquet"
    pd.DataFrame({"made_at": [pd.Timestamp("2026-11-07", tz="UTC")]}).to_parquet(f)
    return f


def test_battery_comparison_runs_once_until_an_input_changes(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.delenv("LG_OFFLINE", raising=False)
    route._battery_run.cache_clear()
    calls = []
    monkeypatch.setattr(route.compare, "run", lambda: calls.append(1) or {"results": [], "n": len(calls)})
    f = _touch_log(tmp_path)

    first = route.battery_comparison()
    assert route.battery_comparison() is first
    assert len(calls) == 1

    st = f.stat()
    os.utime(f, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    assert route.battery_comparison()["n"] == 2
    assert len(calls) == 2


def test_a_new_actuals_file_invalidates_the_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.delenv("LG_OFFLINE", raising=False)
    route._battery_run.cache_clear()
    calls = []
    monkeypatch.setattr(route.compare, "run", lambda: calls.append(1) or {"results": []})
    _touch_log(tmp_path)
    route.battery_comparison()
    (tmp_path / "actuals").mkdir()
    pd.DataFrame({"ts": [pd.Timestamp("2026-11-07", tz="UTC")]}).to_parquet(tmp_path / "actuals" / "nordpool_price.parquet")
    route.battery_comparison()
    assert len(calls) == 2
