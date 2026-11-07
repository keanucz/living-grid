import json

import httpx
import pandas as pd
import pytest

from engine import publisher as P
from engine.publisher import rows as R
from engine.publisher.__main__ import run_once
from engine.routes._fixtures import fixture

NOW = pd.Timestamp("2026-11-07T12:00:00Z")


class Recorder:
    def __init__(self, fail_with: int | None = None):
        self.calls: list[tuple[str, list]] = []
        self.identity_calls = 0
        self.fail_with = fail_with

    def __call__(self, req: httpx.Request) -> httpx.Response:
        if req.url.path == "/v1/identity":
            self.identity_calls += 1
            return httpx.Response(200, json={"identity": "abc", "token": "tok"})
        assert req.headers["authorization"] == "Bearer tok"
        assert req.url.path.startswith("/v1/database/lg/call/")
        if self.fail_with:
            return httpx.Response(self.fail_with, text="forecast quantiles must satisfy p10 <= p50 <= p90")
        self.calls.append((req.url.path.rsplit("/", 1)[-1], json.loads(req.content)))
        return httpx.Response(200)

    def reducers(self) -> list[str]:
        return [c[0] for c in self.calls]


def client(rec: Recorder) -> P.Client:
    return P.Client("http://stdb.test", "lg", transport=httpx.MockTransport(rec))


def test_actuals_payload_shape():
    rec = Recorder()
    df = pd.DataFrame({
        "ts": pd.to_datetime(["2026-11-13T12:00:00Z", "2026-11-13T13:00:00Z"]),
        "zone": ["GB", "GB"], "series": ["price_da", "price_da"], "value": [82.5, float("nan")],
        "unit": ["GBP/MWh", "GBP/MWh"],
    })
    assert P.publish_actuals(client(rec), df) == 1
    (name, body), = rec.calls
    assert name == "upsert_actuals"
    assert body == [[{"ts_us": 1794571200000000, "zone": "GB", "series": "price_da", "value": 82.5, "unit": "GBP/MWh"}]]
    assert rec.identity_calls == 1


def test_forecast_rows_match_reducer_fields():
    row = R.forecasts(fixture_log().head(1))[0]
    assert set(row) == {"made_at_us", "zone", "target", "ts_us", "horizon_h", "p10", "p50", "p90", "model_version"}
    assert isinstance(row["made_at_us"], int) and isinstance(row["horizon_h"], int)


def test_scores_carbon_battery_shapes():
    from pipeline import cache

    s = R.scores(cache.read("scores/scores"))[0]
    assert set(s) == {"window_start_us", "window_end_us", "zone", "target", "metric", "model", "value", "n"}
    c = R.carbon(cache.read("carbon/consumption_intensity"))[0]
    assert set(c) == {"ts_us", "zone", "production_gco2_kwh", "consumption_gco2_kwh", "imports_share"}
    b = R.batteries(pd.DataFrame([{"zone": "GB", "strategy": "risk_aware", "soc_mwh": 1, "profit": 3,
                                   "currency": "GBP", "share_of_perfect": 0.7}]))[0]
    assert b == {"zone": "GB", "strategy": "risk_aware", "currency": "GBP", "soc_mwh": 1.0, "profit": 3.0,
                 "share_of_perfect": 0.7}
    g = R.ghost_wind(pd.DataFrame([{"ts": NOW, "region": "N Scotland", "method": "boalf", "mwh": 4, "cost_gbp": 9}]))[0]
    assert g == {"ts_us": 1794052800000000, "region": "N Scotland", "method": "boalf", "mwh": 4.0, "cost_gbp": 9.0}


def test_batches_large_payloads(monkeypatch):
    monkeypatch.setattr(P, "BATCH", 100)
    rec = Recorder()
    df = pd.DataFrame({"ts": pd.date_range(NOW, periods=250, freq="h"), "zone": "GB", "series": "load",
                       "value": 1.0, "unit": "MW"})
    assert P.publish_actuals(client(rec), df) == 250
    assert [len(body[0]) for _, body in rec.calls] == [100, 100, 50]


def test_intervention_args_from_fixture():
    rec = Recorder()
    result = fixture("intervene")
    P.publish_intervention(client(rec), result, triggered_by="main-screen")
    (name, args), = rec.calls
    assert name == "set_intervention" and len(args) == 10
    slot, typ, target, magnitude, hours, by, cost, currency, sentence, raw = args
    assert (slot, by, currency) == ("main", "main-screen", "GBP")
    assert typ == result["request"]["type"] and hours == result["applied_hours"]
    assert cost == result["cost_total_gbp"]["p50"] and sentence == result["explanation"]["sentence"]
    assert json.loads(raw)["id"] == result["id"]


def test_reducer_error_is_raised():
    with pytest.raises(P.ReducerError, match="530"):
        P.publish_forecasts(client(Recorder(fail_with=530)), fixture_log().head(1))


def test_offline_client_is_none(monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    monkeypatch.setenv("LG_STDB_URL", "http://stdb.test")
    assert P.from_env() is None
    assert P.publish_actuals(None, pd.DataFrame({"ts": [NOW], "zone": ["GB"], "series": ["load"],
                                                 "value": [1.0], "unit": ["MW"]})) == 0


def test_loop_sends_only_changes():
    rec = Recorder()
    pub = P.Publisher(client(rec))
    first = run_once(pub, hours_back=48, now=NOW)
    assert first["zones"] == 6 and first["actuals"] > 0 and first["forecasts"] > 0
    assert {"upsert_zones", "upsert_actuals", "upsert_forecasts", "upsert_scores", "upsert_carbon",
            "prune_before"} <= set(rec.reducers())
    zone_rows = next(body[0] for name, body in rec.calls if name == "upsert_zones")
    assert {z["code"] for z in zone_rows} == {"GB", "FR", "DE-LU", "NL", "BE", "NO2"}
    assert next(z for z in zone_rows if z["code"] == "GB")["currency"] == "GBP"
    rec.calls.clear()
    second = run_once(pub, hours_back=48, now=NOW)
    assert set(second.values()) == {0}
    assert rec.reducers() == ["prune_before"]


def fixture_log() -> pd.DataFrame:
    from pipeline import cache

    return cache.read("forecasts/log")


def test_online_without_token_is_disabled(monkeypatch):
    monkeypatch.delenv("LG_OFFLINE", raising=False)
    monkeypatch.delenv("LG_STDB_TOKEN", raising=False)
    monkeypatch.delenv("LG_STDB_TOKEN_FILE", raising=False)
    monkeypatch.setenv("LG_STDB_URL", "http://stdb.test")
    assert P.from_env() is None, "anonymous identities are rejected by the publish reducers"


def test_token_from_env_and_file(monkeypatch, tmp_path):
    monkeypatch.delenv("LG_OFFLINE", raising=False)
    monkeypatch.setenv("LG_STDB_URL", "http://stdb.test")
    monkeypatch.delenv("LG_STDB_TOKEN", raising=False)
    f = tmp_path / "tok"
    f.write_text("from-file\n")
    monkeypatch.setenv("LG_STDB_TOKEN_FILE", str(f))
    assert P.from_env().token == "from-file"
    monkeypatch.setenv("LG_STDB_TOKEN", "from-env")
    assert P.from_env().token == "from-env"


def test_rejected_publish_surfaces_the_auth_error():
    rec = Recorder(fail_with=530)
    with pytest.raises(P.ReducerError, match="530"):
        P.publish_intervention(client(rec), fixture("intervene"))
