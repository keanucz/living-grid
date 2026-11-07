import pandas as pd

VERSION = "stub-0"


class QuantileModel:
    def __init__(self, trained_before: pd.Timestamp | None = None):
        self.trained_before = trained_before

    def predict(self, features: pd.DataFrame) -> pd.DataFrame:
        out = features.copy()
        mid = out["price_lag_24h"].astype(float)
        spread = 5.0 + 0.1 * mid.abs()
        out["p10"], out["p50"], out["p90"] = mid - spread, mid, mid + spread
        return out

    def explain(self, features: pd.DataFrame) -> pd.DataFrame:
        from .explain import grouped_zero

        return grouped_zero(features)


def predict(features: pd.DataFrame) -> pd.DataFrame:
    """Adds p10, p50, p90."""
    return QuantileModel().predict(features)
