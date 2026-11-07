import json

import pandas as pd
import pytest

from pipeline import backfill, cache
from pipeline.backfill import Source

UNTIL = pd.Timestamp("2026-11-07T12:00Z")
SINCE = pd.Timestamp("2026-10-01T00:00Z")


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.delenv("LG_OFFLINE", raising=False)


def fake(calls, fail_on=None, **kw):
    def run(a, b):
        if fail_on is not None and a == fail_on:
            raise RuntimeError("boom")
        calls.append((a, b))

    return Source("fake", run, kw.pop("chunk_days", 10), **kw)


def use(monkeypatch, *sources):
    monkeypatch.setattr(backfill, "SOURCES", {s.name: s for s in sources})


def test_chunks_are_contiguous_and_midnight_aligned():
    cs = list(backfill.chunks(pd.Timestamp("2026-10-01T09:30Z"), pd.Timestamp("2026-10-26T00:00Z"), 10))
    assert [(a.day, b.day) for a, b in cs] == [(1, 11), (11, 21), (21, 26)]
    assert all(a.hour == 0 for a, _ in cs)


def test_runs_every_chunk_up_to_until(monkeypatch):
    calls = []
    use(monkeypatch, fake(calls))
    s = backfill.backfill(["fake"], SINCE, UNTIL, pause_s=0, sleep=lambda x: None)
    assert s["fake"] == {"done": 4, "skipped": 0, "failed": 0}
    assert calls[0][0] == SINCE and calls[-1][1] == UNTIL
    assert all(calls[i][1] == calls[i + 1][0] for i in range(len(calls) - 1))


def test_resume_skips_finished_chunks_and_never_records_the_recent_one(monkeypatch):
    calls = []
    use(monkeypatch, fake(calls))
    backfill.backfill(["fake"], SINCE, UNTIL, pause_s=0, sleep=lambda x: None)
    assert len(json.loads(backfill.state_path().read_text())["fake"]) == 3
    calls.clear()
    s = backfill.backfill(["fake"], SINCE, UNTIL, pause_s=0, sleep=lambda x: None)
    assert s["fake"] == {"done": 1, "skipped": 3, "failed": 0}
    assert len(calls) == 1 and calls[0][1] == UNTIL


def test_failed_chunk_is_retried_next_run_and_others_continue(monkeypatch):
    calls = []
    second = pd.Timestamp("2026-10-11T00:00Z")
    use(monkeypatch, fake(calls, fail_on=second))
    s = backfill.backfill(["fake"], SINCE, UNTIL, pause_s=0, sleep=lambda x: None)
    assert s["fake"]["failed"] == 1 and s["fake"]["done"] == 3
    use(monkeypatch, fake(calls := []))
    s = backfill.backfill(["fake"], SINCE, UNTIL, pause_s=0, sleep=lambda x: None)
    assert [a for a, _ in calls] == [second, pd.Timestamp("2026-10-31T00:00Z")]


def test_pause_between_chunks(monkeypatch):
    waits = []
    use(monkeypatch, fake([]))
    backfill.backfill(["fake"], SINCE, UNTIL, pause_s=3, sleep=waits.append)
    assert waits == [3, 3, 3, 3]


def test_nordpool_style_lookback_and_fixed_start(monkeypatch):
    calls = []
    use(
        monkeypatch,
        Source("short", lambda a, b: calls.append(("short", a)), 100, max_lookback_days=60),
        Source("fixed", lambda a, b: calls.append(("fixed", a)), 100000, fixed_start=pd.Timestamp("2021-01-01T00:00Z")),
    )
    backfill.backfill(["short", "fixed"], pd.Timestamp("2024-01-01T00:00Z"), UNTIL, pause_s=0, sleep=lambda x: None)
    assert calls[0] == ("short", pd.Timestamp("2026-09-08T00:00Z"))
    assert calls[-1] == ("fixed", pd.Timestamp("2021-01-01T00:00Z"))


def test_dry_run_fetches_nothing(monkeypatch):
    calls = []
    use(monkeypatch, fake(calls))
    s = backfill.backfill(["fake"], SINCE, UNTIL, dry_run=True)
    assert calls == [] and s["fake"]["done"] == 0 and not backfill.state_path().exists()


def test_registry_covers_ingest_sources():
    assert {"elexon", "energy_charts", "nordpool", "open_meteo", "markets", "boalf"} <= set(backfill.SOURCES)


def test_cli_refuses_offline_and_unknown_source(monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    assert backfill.main(["--source", "all"]) == 2
    monkeypatch.delenv("LG_OFFLINE")
    assert backfill.main(["--source", "nope"]) == 2
    assert backfill.main(["--source", "markets", "--dry-run"]) == 0
