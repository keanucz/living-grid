"""Yesterday and Last week: the naive forecasters with a band from their own past errors."""

import numpy as np

from .base import Bot, Context, banded, error_band, lag_hours, lagged


class _Lagged(Bot):
    days: int | None = None

    def __init__(self):
        super().__init__()
        self.band: dict = {}

    def _lag(self, ctx: Context) -> int:
        return lag_hours(ctx.lead_h, self.days)

    def _fit(self, df, ctx):
        self.band = error_band(df, lagged(ctx, df, self._lag(ctx)))
        return self

    def predict(self, df, ctx) -> np.ndarray:
        return banded(df, lagged(ctx, df, self._lag(ctx)), self.band)


class Yesterday(_Lagged):
    name = "bot_yesterday"
    title = "Yesterday"
    method = "Same hour yesterday, with a band from its own errors over the last 30 days."
    days = None


class LastWeek(_Lagged):
    name = "bot_last_week"
    title = "Last week"
    method = "Same hour seven days ago, with a band from its own errors over the last 30 days."
    days = 7
