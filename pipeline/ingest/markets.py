"""Daily gas (TTF front month) and carbon (CO2.L) prices.

Yahoo's TTE=F is the TTF front month quoted in USD/MMBtu, not EUR/MWh (TTF=F, the EUR/MWh listing, has no
usable history on Yahoo). gas_ttf is therefore TTE=F x 3.412142 MMBtu/MWh / EURUSD=X on the same day, which
matches ICE Endex EUR/MWh settlements to about 1% (26 Aug 2022: 341 vs 339; 6 Nov 2026: 85.2 vs 85.6).
Rows cached before this conversion (source "TTE=F") are dropped on write, and the next run refetches history.

Not zonal, so these do not fit the actuals contract (zone must be a bidding zone). They live in
data/markets/gas_carbon.parquet instead: ts (UTC midnight of the trading day), series, value, unit,
source. Series gas_ttf is EUR/MWh. Series eua is the CO2.L price in EUR, a carbon ETC used as a proxy
for the EUA futures price (history starts October 2021). Forward-fill to hourly at feature time.
"""

import pandas as pd

from pipeline import cache

NAME = "markets/gas_carbon"
COLUMNS = ["ts", "series", "value", "unit", "source"]
TICKERS = {"TTE=F": ("gas_ttf", "EUR/MWh"), "CO2.L": ("eua", "EUR/t")}
FX_TICKER = "EURUSD=X"
MWH_IN_MMBTU = 3.412142
GAS_SOURCE = "TTE=F USD/MMBtu / EURUSD=X"
SOURCES = {"gas_ttf": GAS_SOURCE, "eua": "CO2.L"}
HISTORY_START = pd.Timestamp("2021-01-01", tz="UTC")


def _yahoo(ticker: str, start: pd.Timestamp, end: pd.Timestamp) -> pd.Series:
    import yfinance as yf

    d = yf.download(
        ticker,
        start=f"{start:%Y-%m-%d}",
        end=f"{end + pd.Timedelta(days=1):%Y-%m-%d}",
        progress=False,
        auto_adjust=False,
    )
    if d.empty:
        return pd.Series(dtype=float)
    c = d["Close"]
    return (c[ticker] if hasattr(c, "columns") else c).dropna()


def validate(df: pd.DataFrame) -> pd.DataFrame:
    df = cache.normalise_ts(df)
    missing = [c for c in COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"{NAME}: missing columns {missing}")
    if not isinstance(df["ts"].dtype, pd.DatetimeTZDtype) or str(df["ts"].dt.tz) != "UTC":
        raise ValueError(f"{NAME}: ts must be timezone-aware UTC")
    if df[COLUMNS].isna().any().any():
        raise ValueError(f"{NAME}: nulls")
    if not df["series"].isin([s for s, _ in TICKERS.values()]).all():
        raise ValueError(f"{NAME}: unknown series")
    if (df["value"] <= 0).any():
        raise ValueError(f"{NAME}: non-positive price")
    return df[COLUMNS].astype({"value": float})


def usd_mmbtu_to_eur_mwh(usd_mmbtu: pd.Series, eurusd: pd.Series) -> pd.Series:
    """Daily USD/MMBtu closes to EUR/MWh with the latest EURUSD close on or before each day (none: dropped)."""
    s = usd_mmbtu.copy()
    s.index = pd.to_datetime(s.index, utc=True).normalize()
    if eurusd.empty:
        return s.iloc[:0]
    rate = eurusd.sort_index().reindex(eurusd.index.union(s.index)).ffill().reindex(s.index)
    return (s * MWH_IN_MMBTU / rate).dropna()


def fetch(start=HISTORY_START, end=None, download=_yahoo) -> pd.DataFrame:
    """Daily closes for start <= day <= end. `download(ticker, start, end)` returns a Series by date."""
    if cache.offline():
        raise RuntimeError("LG_OFFLINE is set: market price ingest needs the network")
    start = pd.Timestamp(start)
    start = start.tz_localize("UTC") if start.tzinfo is None else start.tz_convert("UTC")
    end = pd.Timestamp.now(tz="UTC") if end is None else pd.Timestamp(end)
    end = end.tz_localize("UTC") if end.tzinfo is None else end.tz_convert("UTC")
    parts = []
    fx = download(FX_TICKER, start.normalize() - pd.Timedelta(days=7), end.normalize())
    fx.index = pd.to_datetime(fx.index, utc=True).normalize()
    for ticker, (series, unit) in TICKERS.items():
        s = download(ticker, start.normalize(), end.normalize())
        if series == "gas_ttf" and len(s):
            s = usd_mmbtu_to_eur_mwh(s, fx)
        if len(s):
            ts = pd.to_datetime(s.index, utc=True).normalize()
            parts.append(pd.DataFrame({"ts": ts, "series": series, "value": s.to_numpy(float), "unit": unit, "source": SOURCES[series]}))
    if not parts:
        return pd.DataFrame(columns=COLUMNS).astype({"value": float})
    df = pd.concat(parts, ignore_index=True)
    return validate(df[(df["ts"] >= start.normalize()) & (df["ts"] <= end.normalize())])


def _current(df: pd.DataFrame) -> pd.DataFrame:
    return df[df["source"] == df["series"].map(SOURCES)]


def needs_history() -> bool:
    """True when the cache is missing or still holds gas rows from before the USD/MMBtu conversion."""
    if not cache.exists(NAME):
        return True
    old = cache.read_file(cache.path(NAME))
    return len(_current(old)) < len(old)


def write(df: pd.DataFrame) -> list[str]:
    if df.empty:
        return []
    if cache.exists(NAME):
        df = cache.concat([_current(cache.read_file(cache.path(NAME))), df], ignore_index=True)
    df = df.drop_duplicates(["ts", "series"], keep="last").sort_values(["series", "ts"])
    cache.write(NAME, validate(df))
    return [NAME]


def run(start=HISTORY_START, end=None) -> list[str]:
    if needs_history():
        start = HISTORY_START
    return write(fetch(start, end))
