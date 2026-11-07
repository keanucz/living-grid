"""Calendar features. All UTC, as everywhere else in the project."""

import pandas as pd


def calendar_features(ts: pd.DatetimeIndex) -> pd.DataFrame:
    ts = pd.DatetimeIndex(ts)
    return pd.DataFrame(
        {"hour_of_day": ts.hour, "day_of_week": ts.day_of_week, "month": ts.month}, index=ts
    ).astype("int32")
