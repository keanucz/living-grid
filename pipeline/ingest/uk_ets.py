"""UK ETS allowance price: the monthly average of the UKA December futures settlement price.

Source: DESNZ, "Cost Containment Mechanism (CCM) trigger prices and average monthly prices: full tables", gov.uk,
Open Government Licence v3.0 (updated monthly, around the 10th). It is a monthly average of a futures contract, not
a daily spot price; the newest month lags by about six weeks.

fetch() parses that page; write() caches data/markets/uk_ets.parquet (ts = first of the month, series
uka_monthly_avg, GBP/t). load() returns the cache, or the committed data/static/uk_ets_monthly.csv when nothing
has been fetched, so the app works offline.
"""

import re
from io import StringIO

import httpx
import pandas as pd

from pipeline import cache

URL = ("https://www.gov.uk/government/publications/taking-part-in-the-uk-emissions-trading-scheme-markets/"
       "cost-containment-mechanism-ccm-trigger-prices-and-average-monthly-prices-full-table")
NAME = "markets/uk_ets"
STATIC = cache.ROOT / "data" / "static" / "uk_ets_monthly.csv"
SERIES = "uka_monthly_avg"
SOURCE = "DESNZ UK ETS Cost Containment Mechanism monthly average prices (gov.uk, OGL v3.0)"


def _price(cell) -> float | None:
    m = re.search(r"([\d.]+)", str(cell).replace(",", ""))
    return float(m.group(1)) if m and str(cell).strip().startswith("£") else None


def parse(html: str) -> pd.DataFrame:
    """Monthly averages from the 6-month tables. A row labelled Jun-26 monitors the six months before it."""
    out: dict[pd.Timestamp, float] = {}
    for t in pd.read_html(StringIO(html)):
        cols = [str(c) for c in t.columns]
        if "Month" not in cols or not all(f"Month {k} average price" in cols for k in range(1, 7)):
            continue
        for _, row in t.iterrows():
            label = pd.to_datetime(str(row["Month"]), format="%b-%y", errors="coerce")
            if pd.isna(label):
                continue
            for k in range(1, 7):
                p = _price(row[f"Month {k} average price"])
                if p is not None:
                    out[label - pd.DateOffset(months=7 - k)] = p
    if not out:
        raise ValueError("no UK ETS monthly average prices found on the gov.uk page")
    s = pd.Series(out).sort_index()
    return pd.DataFrame({"ts": pd.DatetimeIndex(s.index).tz_localize("UTC"), "series": SERIES, "value": s.to_numpy(),
                         "unit": "GBP/t", "source": SOURCE})


def fetch(client: httpx.Client | None = None) -> pd.DataFrame:
    if cache.offline():
        raise RuntimeError("LG_OFFLINE is set: UK ETS ingest needs the network")
    own = client is None
    client = client or httpx.Client(timeout=60, follow_redirects=True)
    try:
        r = client.get(URL)
        r.raise_for_status()
    finally:
        if own:
            client.close()
    return parse(r.text)


def write(df: pd.DataFrame) -> str:
    if cache.exists(NAME):
        df = cache.concat([cache.read_file(cache.path(NAME)), df], ignore_index=True)
    df = df.drop_duplicates(["ts", "series"], keep="last").sort_values("ts")
    cache.write(NAME, df)
    return NAME


def run(start=None, end=None) -> list[str]:
    return [write(fetch())]


def load() -> pd.DataFrame:
    """ts, value (GBP/t), source: cached fetch merged over the committed static months."""
    s = pd.read_csv(STATIC)
    static = pd.DataFrame({"ts": pd.to_datetime(s["month"], utc=True), "value": s["gbp_per_t"],
                           "source": SOURCE + " (committed copy)"})
    if cache.exists(NAME):
        c = cache.read_file(cache.path(NAME))[["ts", "value", "source"]]
        static = pd.concat([static, c]).drop_duplicates("ts", keep="last")
    return static.sort_values("ts").reset_index(drop=True)
