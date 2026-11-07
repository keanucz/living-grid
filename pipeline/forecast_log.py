"""Append-only forecast log. Rows are never rewritten or backfilled."""

import pandas as pd

from pipeline import cache, schemas

NAME = "forecasts/log"
KEY = ["made_at", "zone", "target", "ts"]


def append(df: pd.DataFrame) -> int:
    new = cache.normalise_ts(schemas.validate(df, NAME))
    if new.duplicated(KEY).any():
        raise ValueError("forecast log: duplicate rows in batch")
    if cache.exists(NAME):
        old = cache.read_file(cache.path(NAME))
        clash = new.merge(old[KEY], on=KEY)
        if len(clash):
            raise ValueError(f"forecast log is append-only: {len(clash)} rows already exist")
        new = cache.concat([old, new], ignore_index=True)
    cache.write(NAME, new)
    return len(df)


def read() -> pd.DataFrame:
    return cache.read(NAME)
