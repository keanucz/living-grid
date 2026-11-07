import pandas as pd

from pipeline import cache, schemas


def latest() -> pd.DataFrame:
    """One row per zone and future hour with every model input."""
    return schemas.validate(cache.read("features/latest"), "features/latest")
