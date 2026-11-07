"""Split-conformal calibration of the P10-P90 band.

The quantile boosters come out too narrow (walk-forward P10-P90 coverage 62 to 70% against a nominal 80%).
For each target we fit one scale s on a held-out recent window that the calibrating model never trained on:

    p10' = p50 - s * (p50 - p10)        p90' = p50 + s * (p90 - p50)

Each held-out row needs factor f = max((p50 - y) / (p50 - p10), (y - p50) / (p90 - p50)) to be covered, and s is
the ceil((n + 1) * 0.8) / n empirical quantile of f, which gives at least 80% coverage on exchangeable rows
(split conformal). Scaling keeps the band's shape: wide stays wide, skew stays skew. P50 never moves, so MAE
is unchanged. s can be below 1 if a model is too wide.
"""

import math

import numpy as np
import pandas as pd

TARGET_COVERAGE = 0.8
HOLDOUT_DAYS = 7
PURGE_HOURS = 48
MIN_ROWS = 50
MIN_WIDTH = 1e-6
MAX_SCALE = 10.0


def needed(y: np.ndarray, q: np.ndarray) -> np.ndarray:
    """Per row, the smallest scale that covers y. q: columns p10, p50, p90."""
    lo = np.maximum(q[:, 1] - q[:, 0], MIN_WIDTH)
    hi = np.maximum(q[:, 2] - q[:, 1], MIN_WIDTH)
    return np.maximum.reduce([(q[:, 1] - y) / lo, (y - q[:, 1]) / hi, np.zeros(len(y))])


def scale(y: np.ndarray, q: np.ndarray, coverage: float = TARGET_COVERAGE) -> float:
    """Conformal scale for the given held-out truths and quantiles."""
    f = np.sort(needed(np.asarray(y, float), np.asarray(q, float)))
    n = len(f)
    if n == 0:
        raise ValueError("no calibration rows")
    k = min(n, math.ceil((n + 1) * coverage))
    return float(min(f[k - 1], MAX_SCALE))


def apply(q: np.ndarray, s: float) -> np.ndarray:
    """Widen (or narrow) sorted quantile rows by s around p50."""
    q = np.asarray(q, float)
    out = q.copy()
    out[:, 0] = q[:, 1] - s * (q[:, 1] - q[:, 0])
    out[:, 2] = q[:, 1] + s * (q[:, 2] - q[:, 1])
    return out


def coverage(y: np.ndarray, q: np.ndarray) -> float:
    y = np.asarray(y, float)
    return float(((y >= q[:, 0]) & (y <= q[:, 2])).mean())


def split(df: pd.DataFrame, holdout_days: int = HOLDOUT_DAYS, purge_h: int = PURGE_HOURS):
    """(fit rows, held-out rows): hold out the last holdout_days, purge purge_h before them."""
    end = df["ts"].max()
    start = end - pd.Timedelta(days=holdout_days)
    return df[df["ts"] < start - pd.Timedelta(hours=purge_h)], df[df["ts"] >= start]


def fit(df: pd.DataFrame, fit_target, predict, holdout_days: int = HOLDOUT_DAYS, purge_h: int = PURGE_HOURS) -> dict | None:
    """Calibration for one target's training frame (ts, zone, features, y).

    fit_target(rows) -> boosters, predict(boosters, rows) -> sorted (n, 3) quantiles. Returns
    {"scale", "n", "coverage_before", "coverage_after", "window"} or None when there are too few rows.
    """
    fit_rows, held = split(df, holdout_days, purge_h)
    if len(held) < MIN_ROWS or len(fit_rows) < MIN_ROWS:
        return None
    q = predict(fit_target(fit_rows), held)
    y = held["y"].to_numpy(float)
    s = scale(y, q)
    return {
        "scale": s,
        "n": int(len(held)),
        "coverage_before": coverage(y, q),
        "coverage_after": coverage(y, apply(q, s)),
        "window": {"start": held["ts"].min().isoformat(), "end": held["ts"].max().isoformat()},
    }
