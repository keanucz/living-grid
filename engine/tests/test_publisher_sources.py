import pandas as pd
import pytest

from engine.publisher import sources
from pipeline import cache

CUTOFF = pd.Timestamp("2000-01-01", tz="UTC")


@pytest.fixture
def online_empty(tmp_path, monkeypatch):
    monkeypatch.delenv("LG_OFFLINE", raising=False)
    monkeypatch.setattr(cache, "DATA", tmp_path)
    return tmp_path


def test_online_empty_data_publishes_no_fixture_rows(online_empty, caplog):
    with caplog.at_level("INFO", logger="engine.publisher"):
        assert sources.scores() is None
        assert sources.carbon(CUTOFF) is None
        assert sources.actuals(CUTOFF) is None
        assert sources.forecasts(CUTOFF) is None
    assert "no live scores/scores" in caplog.text


def test_online_reads_only_live_files(online_empty):
    (online_empty / "actuals").mkdir()
    live = pd.DataFrame({"ts": [pd.Timestamp("2026-11-07T12:00Z")], "zone": ["GB"], "series": ["load"], "value": [31000.0], "unit": ["MW"]})
    live.to_parquet(online_empty / "actuals" / "elexon_load.parquet")
    got = sources.actuals(CUTOFF)
    assert len(got) == 1 and got["value"].iloc[0] == 31000.0, "fixture actuals must not be mixed in"


def test_offline_still_uses_fixtures(online_empty, monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    assert len(sources.scores()) > 0
    assert len(sources.carbon(CUTOFF)) > 0
    assert len(sources.actuals(CUTOFF)) > 0
