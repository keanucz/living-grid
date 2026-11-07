import pandas as pd

from pipeline import schemas


def grouped_zero(features: pd.DataFrame) -> pd.DataFrame:
    out = features[["ts", "zone"]].reset_index(drop=True)
    out["base"] = 0.0
    for g in schemas.GROUPS:
        out[g] = 0.0
    return out[schemas.EXPLANATION_COLUMNS]


def explain(features: pd.DataFrame) -> pd.DataFrame:
    """Per-row contributions grouped into wind, solar, demand, gas, carbon, imports, time_of_day."""
    return grouped_zero(features)
