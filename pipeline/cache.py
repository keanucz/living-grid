"""Parquet cache under data/, with committed fixtures as the fallback."""

import os
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
FIXTURES = Path(__file__).resolve().parent / "fixtures"


def offline() -> bool:
    return os.environ.get("LG_OFFLINE", "").lower() in ("1", "true", "yes")


def path(name: str) -> Path:
    return DATA / f"{name}.parquet"


def exists(name: str) -> bool:
    return path(name).exists()


def read(name: str) -> pd.DataFrame:
    for base in (DATA, FIXTURES):
        p = base / f"{name}.parquet"
        if p.exists():
            return pd.read_parquet(p)
    raise FileNotFoundError(f"{name}: not in {DATA} or {FIXTURES}")


def write(name: str, df: pd.DataFrame) -> Path:
    p = path(name)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    df.to_parquet(tmp, index=False)
    tmp.replace(p)
    return p
