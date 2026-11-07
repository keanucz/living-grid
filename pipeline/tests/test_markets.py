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
    usd = CSV[(CSV.ticker == "TTE=F") & (CSV.date == "2026-11-04")]["close"].iloc[0]
    fx = CSV[(CSV.ticker == "EURUSD=X") & (CSV.date == "2026-11-04")]["close"].iloc[0]
    got = df[(df.series == "gas_ttf") & (df.ts == pd.Timestamp("2026-11-04", tz="UTC"))]["value"].iloc[0]
    assert got == pytest.approx(usd * markets.MWH_IN_MMBTU / fx)
    assert set(df[df.series == "gas_ttf"]["source"]) == {markets.GAS_SOURCE}


def test_gas_is_eur_per_mwh_matching_ice_endex(no_offline):
    df = markets.fetch("2026-11-06", "2026-11-06", download=download)
    gas = df[df.series == "gas_ttf"]["value"].iloc[0]
    assert gas == pytest.approx(85.59, rel=0.02), "ICE Endex TTF front month settled at 85.59 EUR/MWh on 6 Nov 2026"


def test_conversion_uses_latest_rate_on_or_before_the_day():
    usd = pd.Series([10.0, 10.0], index=pd.to_datetime(["2026-11-06", "2026-11-09"]))
    fx = pd.Series([1.25], index=pd.to_datetime(["2026-11-05"], utc=True))
    out = markets.usd_mmbtu_to_eur_mwh(usd, fx)
    assert out.tolist() == pytest.approx([10 * markets.MWH_IN_MMBTU / 1.25] * 2)
    assert markets.usd_mmbtu_to_eur_mwh(usd, pd.Series(dtype=float)).empty


def test_legacy_unconverted_rows_are_dropped_and_history_refetched(no_offline, tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    assert markets.needs_history()
    legacy = pd.DataFrame({"ts": pd.to_datetime(["2021-03-01", "2026-11-05"], utc=True), "series": "gas_ttf",
                           "value": [5.0, 29.9], "unit": "EUR/MWh", "source": "TTE=F"})
    cache.write(markets.NAME, legacy)
    assert markets.needs_history()
    starts = []
    real = markets.fetch

    def fetch(start, end):
        starts.append(pd.Timestamp(start))
        return real("2026-11-05", "2026-11-06", download=download)

    monkeypatch.setattr(markets, "fetch", fetch)
    markets.run(pd.Timestamp("2026-11-05", tz="UTC"))
    assert starts == [markets.HISTORY_START]
    out = cache.read_file(cache.path(markets.NAME))
    assert "TTE=F" not in set(out["source"]) and out[out.series == "gas_ttf"]["value"].min() > 50
    assert not markets.needs_history()
    markets.run(pd.Timestamp("2026-11-05", tz="UTC"))
    assert starts[-1] == pd.Timestamp("2026-11-05", tz="UTC")


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
    naive = markets.validate(df.assign(ts=df["ts"].dt.tz_localize(None)))
    assert str(naive["ts"].dt.tz) == "UTC" and (naive["ts"].to_numpy() == df["ts"].to_numpy()).all()


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
