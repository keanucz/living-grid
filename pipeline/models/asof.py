import pandas as pd

from .quantile import QuantileModel


def as_of(date) -> QuantileModel:
    """Model trained only on data before `date`, for replay."""
    d = pd.Timestamp(date)
    d = d.tz_localize("UTC") if d.tzinfo is None else d.tz_convert("UTC")
    return QuantileModel(trained_before=d)
