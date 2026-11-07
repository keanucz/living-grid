"""Parquet cache under data/, with committed fixtures as the fallback.

Every datetime column crosses this boundary as datetime64[ns, UTC]. Real caches mix units (s, ms, us) and the
UTC tz object (parquet gives ZoneInfo, pandas gives datetime.timezone), and pandas turns a concat of those into
an object column and refuses to merge them, so reads, writes and concat() all normalise.
"""

import datetime
import os
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
FIXTURES = Path(__file__).resolve().parent / "fixtures"
UTC_NS = pd.DatetimeTZDtype("ns", "UTC")


def offline() -> bool:
    return os.environ.get("LG_OFFLINE", "").lower() in ("1", "true", "yes")


def path(name: str) -> Path:
    return DATA / f"{name}.parquet"


def exists(name: str) -> bool:
    return path(name).exists()


def _datetime_like_object(col: pd.Series) -> bool:
    if col.dtype != object:
        return False
    seen = col.dropna()
    return len(seen) > 0 and isinstance(seen.iloc[0], datetime.datetime)


def normalise_ts(df: pd.DataFrame) -> pd.DataFrame:
    """Every datetime column as datetime64[ns, UTC]. Naive values are taken to be UTC."""
    out = df
    for c in df.columns:
        col = df[c]
        if col.dtype == UTC_NS:
            continue
        if isinstance(col.dtype, pd.DatetimeTZDtype):
            new = col.dt.tz_convert("UTC").astype(UTC_NS)
        elif col.dtype.kind == "M":
            new = col.dt.tz_localize("UTC").astype(UTC_NS)
        elif _datetime_like_object(col):
            new = pd.to_datetime(col, utc=True).astype(UTC_NS)
        else:
            continue
        if out is df:
            out = df.copy()
        out[c] = new
    return out


def concat(frames: list[pd.DataFrame], **kwargs) -> pd.DataFrame:
    """pd.concat that cannot turn mixed datetime units or tz objects into an object column."""
    return pd.concat([normalise_ts(f) for f in frames], **kwargs)


def read_file(p: Path) -> pd.DataFrame:
    return normalise_ts(pd.read_parquet(p))


def read(name: str) -> pd.DataFrame:
    for base in (DATA, FIXTURES):
        p = base / f"{name}.parquet"
        if p.exists():
            return read_file(p)
    raise FileNotFoundError(f"{name}: not in {DATA} or {FIXTURES}")


def write(name: str, df: pd.DataFrame) -> Path:
    p = path(name)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    normalise_ts(df).to_parquet(tmp, index=False)
    tmp.replace(p)
    return p
