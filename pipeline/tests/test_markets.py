from pathlib import Path

import pandas as pd
import pytest

from pipeline import cache, ingest
from pipeline.ingest import markets

CSV = pd.read_csv(Path(__file__).parent / "fixtures" / "markets" / "yahoo_close.csv")


@pytest.fixture
def no_offline(monkeypatch):
    monkeypatch.delenv("LG_OFFLINE", raising=False)


def download(ticker, start, end):
    d = CSV[CSV["ticker"] == ticker]
    s = pd.Series(d["close"].to_numpy(), index=pd.to_datetime(d["date"]))
    return s[(s.index >= start.tz_localize(None)) & (s.index <= end.tz_localize(None))]


def test_fetch_recorded(no_offline):
    df = markets.fetch("2026-10-26", "2026-11-06", download=download)
    markets.validate(df)
    assert set(df["series"]) == {"gas_ttf", "eua"}
    assert set(df[df.series == "gas_ttf"]["unit"]) == {"EUR/MWh"}
    assert set(df[df.series == "eua"]["source"]) == {"CO2.L"}
    assert df["ts"].dt.hour.eq(0).all()
    assert not df.duplicated(["ts", "series"]).any()
    want = CSV[(CSV.ticker == "TTE=F") & (CSV.date == "2026-11-04")]["close"].iloc[0]
    assert df[(df.series == "gas_ttf") & (df.ts == pd.Timestamp("2026-11-04", tz="UTC"))]["value"].iloc[0] == pytest.approx(want)


def test_range_is_respected_and_empty_ok(no_offline):
    df = markets.fetch("2026-11-02", "2026-11-03", download=download)
    assert df["ts"].min() >= pd.Timestamp("2026-11-02", tz="UTC") and df["ts"].max() <= pd.Timestamp("2026-11-03", tz="UTC")
    empty = markets.fetch("2020-01-01", "2020-01-05", download=download)
    assert empty.empty and list(empty.columns) == markets.COLUMNS


def test_default_history_reaches_2021():
    assert markets.HISTORY_START == pd.Timestamp("2021-01-01", tz="UTC")


def test_validate_rejects_bad_rows(no_offline):
    df = markets.fetch("2026-11-02", "2026-11-03", download=download)
    with pytest.raises(ValueError):
        markets.validate(df.assign(value=-1.0))
    with pytest.raises(ValueError):
        markets.validate(df.assign(series="bogus"))
    with pytest.raises(ValueError):
        markets.validate(df.assign(ts=df["ts"].dt.tz_localize(None)))


def test_offline_refuses_network(monkeypatch):
    monkeypatch.setenv("LG_OFFLINE", "1")
    with pytest.raises(RuntimeError):
        markets.fetch("2026-11-02", "2026-11-03", download=download)


def test_write_merges_and_dedupes(tmp_path, monkeypatch, no_offline):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    df = markets.fetch("2026-10-26", "2026-11-06", download=download)
    assert markets.write(df) == ["markets/gas_carbon"]
    markets.write(df.assign(value=df["value"] + 1))
    out = cache.read("markets/gas_carbon")
    assert len(out) == len(df)
    assert out["value"].sum() == pytest.approx(df["value"].sum() + len(df))
    assert markets.write(df.iloc[0:0]) == []


def test_autodiscovered():
    assert "markets" in ingest.sources()
