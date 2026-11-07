"""The Committee: quantile regression averaging (QRA) of Our model, The Engineer and Yesterday, then conformal scaling.

For each quantile level a linear quantile regression of the actual price on the three components' medians is fitted
on the 14 days before the forecast, using components that were trained before those days (a held-out stack, so the
house model's in-sample fit does not win every weight). The band is then scaled with the same split-conformal rule as
pipeline.models.calibrate, fitted on the second week of the stack with QRA weights from the first.
"""

import numpy as np
import pandas as pd

from pipeline.models import calibrate

from .base import QS, Bot, Context

STACK_DAYS = 14
PURGE_H = 48
MIN_STACK_ROWS = 100


def _qra(x: np.ndarray, y: np.ndarray) -> list[tuple[np.ndarray, float]]:
    from sklearn.linear_model import QuantileRegressor

    fits = []
    for tau in QS:
        m = QuantileRegressor(quantile=tau, alpha=0.0, solver="highs").fit(x, y)
        fits.append((m.coef_.copy(), float(m.intercept_)))
    return fits


def _apply(fits, x: np.ndarray) -> np.ndarray:
    return np.sort(np.column_stack([x @ w + b for w, b in fits]), axis=1)


def _medians(components: list[Bot], df: pd.DataFrame, ctx: Context) -> np.ndarray:
    return np.column_stack([c.predict(df, ctx)[:, 1] for c in components])


class Committee(Bot):
    name = "bot_committee"
    title = "The Committee"
    method = "Quantile regression averaging of Our model, The Engineer and Yesterday over the last 14 days, then conformal."

    def __init__(self, components: list[Bot] | None = None, make_components=None):
        """components: already fitted on all training rows (used to predict).
        make_components: () -> fresh unfitted bots, fitted on rows before the stack window to build the stack."""
        super().__init__()
        self.components = components or []
        self.make_components = make_components
        self.fits = None
        self.scale = 1.0
        self.weights: dict[str, float] = {}

    def fresh(self):
        return Committee(make_components=self.make_components)

    def _fit(self, df, ctx):
        end = df["ts"].max()
        start = end - pd.Timedelta(days=STACK_DAYS)
        early = df[df["ts"] < start - pd.Timedelta(hours=PURGE_H)]
        stack = df[df["ts"] >= start]
        if self.make_components is None or len(early) < MIN_STACK_ROWS or len(stack) < MIN_STACK_ROWS:
            self.fits = None
            return self
        held = [b.fit(early, ctx) for b in self.make_components()]
        x, y = _medians(held, stack, ctx), stack["y"].to_numpy(float)
        ok = np.isfinite(x).all(axis=1) & np.isfinite(y)
        stack, x, y = stack[ok], x[ok], y[ok]
        if len(stack) < MIN_STACK_ROWS:
            self.fits = None
            return self
        mid = stack["ts"].min() + (stack["ts"].max() - stack["ts"].min()) / 2
        first, second = (stack["ts"] < mid).to_numpy(), (stack["ts"] >= mid).to_numpy()
        if first.sum() >= MIN_STACK_ROWS and second.sum() >= calibrate.MIN_ROWS:
            q = _apply(_qra(x[first], y[first]), x[second])
            self.scale = calibrate.scale(y[second], q)
        self.fits = _qra(x, y)
        names = [b.name for b in self.components] or [b.name for b in held]
        self.weights = dict(zip(names, (float(w) for w in self.fits[1][0]), strict=False))
        return self

    def predict(self, df, ctx) -> np.ndarray:
        x = _medians(self.components, df, ctx)
        if self.fits is None:
            q = np.sort(np.stack([c.predict(df, ctx) for c in self.components]).mean(axis=0), axis=1)
            return q
        return calibrate.apply(_apply(self.fits, x), self.scale)
