import json
import re
from pathlib import Path

import httpx
import pandas as pd
import pytest

from engine import publisher as P
from engine.publisher import rows as R
from engine.publisher.__main__ import run_once
from pipeline import cache

NOW = pd.Timestamp("2026-11-07T12:00:00Z")
PUBLISH_TS = Path(__file__).resolve().parents[2] / "spacetime" / "module" / "src" / "reducers" / "publish.ts"
REDUCER_KIND = {reducer: kind for kind, (reducer, _) in P.Publisher.REDUCERS.items()}


class FakeDB:
    """Answers SELECT <col> FROM <table>, applies upserts by R.KEYS and delete_keys."""

    def __init__(self):
        self.tables: dict[str, set[str]] = {table: set() for table, _, _ in R.KEYS.values()}
        self.deletes: list[tuple[str, list[str]]] = []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path == "/v1/identity":
            return httpx.Response(200, json={"identity": "abc", "token": "tok"})
        if path.endswith("/sql"):
            table = re.match(r"SELECT \w+ FROM (\w+)", req.content.decode()).group(1)
            return httpx.Response(200, json=[{"rows": [[k] for k in sorted(self.tables[table])]}])
        name, args = path.rsplit("/", 1)[-1], json.loads(req.content)
        if name == "delete_keys":
            table, keys = args
            self.deletes.append((table, keys))
            self.tables[table] -= set(keys)
        elif name in REDUCER_KIND:
            table, _, key = R.KEYS[REDUCER_KIND[name]]
            self.tables[table] |= {key(r) for r in args[0]}
        return httpx.Response(200)


@pytest.fixture
def db():
    return FakeDB()


def client(db):
    return P.Client("http://stdb.test", "lg", token="tok", transport=httpx.MockTransport(db))


def test_stray_keys_removed_live_keys_untouched(db, monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")  # fixtures stand in for the live cache here
    pub = P.Publisher(client(db))
    run_once(pub, hours_back=48, now=NOW)
    live = {t: set(keys) for t, keys in db.tables.items()}
    assert live["score"] and live["carbon"] and live["actual"]
    db.tables["score"] |= {"XX|price_da|mae|sample"}
    db.tables["carbon"] |= {"XX|1"}
    db.tables["actual"] |= {"FR|ci_gco2_kwh|1"}

    run_once(P.Publisher(client(db)), hours_back=48, now=NOW, reconcile_first=True)
    assert "XX|price_da|mae|sample" not in db.tables["score"]
    assert "XX|1" not in db.tables["carbon"]
    assert "FR|ci_gco2_kwh|1" not in db.tables["actual"]
    for table, keys in live.items():
        assert keys <= db.tables[table], f"{table}: live rows were deleted"


def test_missing_live_source_empties_the_table(db, monkeypatch, tmp_path):
    monkeypatch.delenv("LG_OFFLINE", raising=False)
    monkeypatch.setattr(cache, "DATA", tmp_path)
    db.tables["score"] |= {"GB|price_da|mae|lgbm", "FR|price_da|mae|lgbm"}
    db.tables["carbon"] |= {"GB|1793923200000000"}
    run_once(P.Publisher(client(db)), hours_back=48, now=NOW, reconcile_first=True)
    assert db.tables["score"] == set() and db.tables["carbon"] == set()


def test_no_reconcile_after_first_pass(db, monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    db.tables["score"] |= {"XX|price_da|mae|sample"}
    run_once(P.Publisher(client(db)), hours_back=48, now=NOW)
    assert "XX|price_da|mae|sample" in db.tables["score"]
    assert db.deletes == []


def test_deletes_are_batched(db):
    db.tables["carbon"] = {f"GB|{i}" for i in range(1234)}
    assert P.reconcile(client(db), {"carbon": None}) == {"carbon": 1234}
    assert [len(k) for _, k in db.deletes] == [500, 500, 234]


def test_offline_reconcile_is_a_no_op():
    assert P.reconcile(None, {"carbon": None}) == {}


def test_python_keys_match_the_reducers():
    src = PUBLISH_TS.read_text()
    templates = dict(re.findall(r"upsert\(ctx\.db\.(\w+), \{[^`]*key: `([^`]+)`", src, flags=re.DOTALL))
    sample = {f: f for f in ["zone", "series", "ts_us", "target", "made_at_us", "metric", "model", "region", "method", "strategy"]}
    for table, col, key in R.KEYS.values():
        if col != "key":
            continue
        expected = re.sub(r"\$\{r\.(\w+)\}", r"\1", templates[table]).replace("${ts_us}", "ts_us").replace("${made_at_us}", "made_at_us")
        assert key(sample) == expected, (table, templates[table])


def test_reconcile_failure_still_publishes(db, monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")

    def no_delete_keys(req):
        if req.url.path.endswith("/delete_keys"):
            return httpx.Response(530, text="no such reducer")
        return db(req)

    db.tables["score"] |= {"XX|price_da|mae|sample"}
    pub = P.Publisher(P.Client("http://stdb.test", "lg", token="tok", transport=httpx.MockTransport(no_delete_keys)))
    sent = run_once(pub, hours_back=48, now=NOW, reconcile_first=True)
    assert sent["reconcile_failed"] == 1 and sent["actuals"] > 0
