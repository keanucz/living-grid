import os

from fastapi.testclient import TestClient

from engine.app import app
from engine.routes import ghost_wind as route

client = TestClient(app)
URL = "/unseen/ghost-wind?from=2026-10-26T00:00:00Z&to=2026-10-27T00:00:00Z"


def test_same_window_and_unchanged_inputs_build_once_then_rebuild_when_an_input_changes(monkeypatch, tmp_path):
    calls = []
    real = route.costs.build
    monkeypatch.setattr(route.costs, "build", lambda *a, **k: calls.append(a) or real(*a, **k))
    monkeypatch.setattr(route.costs, "has_data", lambda *a, **k: True)
    f = tmp_path / "bids.parquet"
    f.write_bytes(b"x")
    monkeypatch.setattr(route, "inputs", lambda: (str(f),))
    route.cached.cache_clear()

    a = client.get(URL)
    b = client.get(URL)
    assert a.status_code == b.status_code == 200 and a.json() == b.json()
    assert len(calls) == 1

    st = f.stat()
    os.utime(f, ns=(st.st_atime_ns, st.st_mtime_ns + 10**9))
    assert client.get(URL).status_code == 200
    assert len(calls) == 2

    client.get("/unseen/ghost-wind?from=2026-10-25T00:00:00Z&to=2026-10-26T00:00:00Z")
    assert len(calls) == 3


def test_inputs_cover_every_file_build_reads():
    names = {os.path.basename(p) for p in route.inputs()}
    for stem in ("wind_bids", "constraint_costs", "boundary_flows", "wind_metered", "live_forecast", "historical_forecast"):
        assert any(n.startswith(stem) for n in names), stem
