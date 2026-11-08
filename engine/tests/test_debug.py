import sqlite3

import pytest
from fastapi.testclient import TestClient

from engine.app import app
from engine.routes import debug

client = TestClient(app)


def make_db(path, tasks, merged_ts):
    con = sqlite3.connect(path)
    con.execute("create table tasks(id integer primary key, title text, detail text default '', paths text default '', status text default 'open', agent text, branch text, note text default '', handoff text default '', updated real)")
    con.execute("create table events(id integer primary key, ts real, task integer, agent text, kind text, msg text)")
    for t in tasks:
        con.execute("insert into tasks(id,title,paths,status,agent,updated) values (?,?,?,?,?,?)", t)
    for task, ts in merged_ts.items():
        con.execute("insert into events(ts,task,agent,kind,msg) values (?,?,?, 'merged','x')", (ts, task, "integrator"))
    con.commit()
    con.close()


@pytest.fixture
def hub(tmp_path, monkeypatch):
    db = tmp_path / "hub.db"
    make_db(db, [
        (10, "Battery panel v1", "web/src/panels/battery/", "merged", "stefan-1", 100.0),
        (11, "Battery panel tweak", "web/src/panels/battery/index.jsx", "merged", "stefan-2", 200.0),
        (12, "Everything in web", "web/src/", "merged", "manu", 50.0),
        (167, "Clue shop", "engine/market/clues.py spacetime/module/src/reducers/clues.ts", "merged", "stefan-3", 300.0),
        (198, "Flash timer", "web/src/panels/reactions/", "open", None, 10.0),
    ], {10: 1000.0, 11: 2000.0, 12: 500.0, 167: 3000.0})
    monkeypatch.setenv("LG_HUB_DB", str(db))
    return db


def feat(body, kind, fid):
    return next(f for f in body["features"] if f["kind"] == kind and f["id"] == fid)


def test_a_feature_is_credited_to_the_earliest_merged_task_that_covers_it(hub):
    body = client.get("/debug/features").json()
    battery = feat(body, "panel", "battery")
    assert battery["added_by"]["id"] == 10 and battery["added_by"]["agent"] == "stefan-1" and battery["added_by"]["merged_at"] == 1000.0
    assert battery["touched_by"] == [10, 11]


def test_a_broad_claim_such_as_all_of_web_credits_nothing(hub):
    body = client.get("/debug/features").json()
    assert all(12 not in f["touched_by"] for f in body["features"])
    assert not debug.covers("web/src/", "web/src/panels/battery/")
    assert debug.covers("web/src/panels/battery", "web/src/panels/battery/index.jsx") and debug.covers("engine/market/", "engine/market/clues.py")


def test_paused_features_and_tasks_are_flagged(hub):
    body = client.get("/debug/features").json()
    assert feat(body, "view", "/market")["paused"] and feat(body, "view", "/game")["paused"]
    assert feat(body, "module", "clues.ts")["paused"]
    assert not feat(body, "panel", "battery")["paused"]
    assert {t["id"]: t["status"] for t in body["paused_tasks"]} == {167: "merged", 198: "open"}


def test_orphans_are_features_nothing_links_to(hub):
    body = client.get("/debug/features").json()
    sections = debug.sections()
    listed = {i for s in sections for i in s["panels"] + s["more"]}
    assert "battery" in listed and not feat(body, "panel", "battery")["orphan"]
    for f in body["features"]:
        if f["kind"] == "panel" and f["orphan"]:
            assert f["id"] not in listed
    assert all(o.split(":")[0] in {"panel", "view", "endpoint"} for o in body["orphans"])
    assert "endpoint:GET /health" not in body["orphans"]


def test_every_kind_is_generated_from_the_repository(hub):
    kinds = {f["kind"] for f in client.get("/debug/features").json()["features"]}
    assert {"section", "view", "layer", "panel", "endpoint", "engine", "ingest", "module"} <= kinds
    ids = {s["id"] for s in debug.sections()}
    assert ids == {"now", "forecast", "hidden", "whatif", "proof", "play"}


def test_an_unreadable_hub_database_still_lists_the_features(tmp_path, monkeypatch):
    monkeypatch.setenv("LG_HUB_DB", str(tmp_path / "missing.db"))
    body = client.get("/debug/features").json()
    assert body["hub_db"]["readable"] is False and body["features"]
    assert all(f["added_by"] is None for f in body["features"] if f["kind"] == "panel")


def test_the_hub_database_is_never_written(hub):
    before = hub.read_bytes()
    client.get("/debug/features")
    assert hub.read_bytes() == before


def test_a_claim_on_a_whole_folder_of_features_credits_none_of_them():
    for broad in ("web/src/views/", "web/src/panels/", "engine/routes/", "web/src/shell/"):
        assert not debug.covers(broad, "web/src/views/debug/")
    assert debug.covers("web/src/views/debug/", "web/src/views/debug/index.jsx")
