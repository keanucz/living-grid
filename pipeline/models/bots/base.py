"""Shared pieces of the bot league: the Bot interface, empirical error bands, pinball loss and prob_above.

A bot turns a frame of zone-hours into sorted (p10, p50, p90) rows. fit() sees only rows with ts before the
forecast period (the caller passes the training frame), predict() reads only features and actuals that were known
at each row's forecast origin, the same rule as the live features (pipeline.features.build).
"""

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from pipeline.features import build

QS = (0.1, 0.5, 0.9)
BAND_DAYS = 30
MIN_BAND_ROWS = 48


@dataclass
class Context:
    """What a bot may read besides the feature rows: hourly target actuals (ts index, zone columns) and the lead."""

    wide: pd.DataFrame
    lead_h: int = build.HISTORY_LEAD_H
    params: dict = field(default_factory=dict)


class Bot:
    name = "bot"
    title = "Bot"
    method = ""
    targets = ("price_da", "gb_system_price")

    def __init__(self):
        self.trained_through: pd.Timestamp | None = None

    def fit(self, df: pd.DataFrame, ctx: Context) -> "Bot":
        self.trained_through = df["ts"].max()
        return self._fit(df, ctx)

    def _fit(self, df: pd.DataFrame, ctx: Context) -> "Bot":
        return self

    def predict(self, df: pd.DataFrame, ctx: Context) -> np.ndarray:
        raise NotImplementedError

    def fresh(self) -> "Bot":
        return type(self)()

    def spec(self) -> dict:
        return {"name": self.name, "title": self.title, "method": self.method}


def assert_no_leakage(bot: Bot, date) -> None:
    """Raise unless the bot was fitted and saw only data strictly before `date` (UTC; a bare date means midnight)."""
    d = pd.Timestamp(date)
    d = d.tz_localize("UTC") if d.tzinfo is None else d.tz_convert("UTC")
    if bot.trained_through is None:
        raise ValueError(f"{bot.name} has not been fitted")
    if bot.trained_through >= d:
        raise ValueError(f"refusing {bot.name}: fitted on data up to {bot.trained_through}, at or after {d}")


def lag_hours(lead_h: int, days: int | None = None) -> int:
    """Whole-day lag whose value is complete at the forecast origin (24 h for leads up to 23 h, 48 h up to 47 h...)."""
    if days is not None:
        return 24 * days
    return 24 * int(max(1, np.ceil((lead_h + 1) / 24)))


def lagged(ctx: Context, df: pd.DataFrame, hours: int) -> np.ndarray:
    """Target actual `hours` before each row's ts, zone by zone (NaN where there is none within 3 h)."""
    out = np.full(len(df), np.nan)
    zones = df["zone"].to_numpy()
    for zone in pd.unique(zones):
        idx = np.flatnonzero(zones == zone)
        series = ctx.wide.get(zone)
        out[idx] = build._at(series, pd.DatetimeIndex(df["ts"].iloc[idx]) - pd.Timedelta(hours=hours), "3h")
    return out


def error_band(df: pd.DataFrame, point: np.ndarray, days: int = BAND_DAYS) -> dict[str, tuple[float, float]]:
    """Per zone, the 10th and 90th percentile of (actual - point) over the last `days` of df: the bot's own past errors.

    The offsets are capped to straddle zero so p10 <= point <= p90. Zones with too few rows use all zones pooled.
    """
    err = pd.DataFrame({"zone": df["zone"].to_numpy(), "ts": df["ts"].to_numpy(), "e": df["y"].to_numpy() - point}).dropna()
    err = err[err["ts"] >= err["ts"].max() - pd.Timedelta(days=days)]
    pooled = _offsets(err["e"].to_numpy())
    out = {}
    for zone, g in err.groupby("zone"):
        out[zone] = _offsets(g["e"].to_numpy()) if len(g) >= MIN_BAND_ROWS else pooled
    out["*"] = pooled
    return out


def _offsets(e: np.ndarray) -> tuple[float, float]:
    if len(e) == 0:
        return 0.0, 0.0
    lo, hi = np.quantile(e, [QS[0], QS[2]])
    return float(min(lo, 0.0)), float(max(hi, 0.0))


def banded(df: pd.DataFrame, point: np.ndarray, band: dict[str, tuple[float, float]]) -> np.ndarray:
    """(n, 3) p10, p50, p90 = point plus the zone's error offsets."""
    lo = df["zone"].map(lambda z: band.get(z, band["*"])[0]).to_numpy(float)
    hi = df["zone"].map(lambda z: band.get(z, band["*"])[1]).to_numpy(float)
    return np.column_stack([point + lo, point, point + hi])


def pinball(y: np.ndarray, q: np.ndarray) -> float:
    """Mean pinball loss over rows and the three quantile levels (lower is better)."""
    y = np.asarray(y, float)[:, None]
    tau = np.array(QS)[None, :]
    d = y - np.asarray(q, float)
    return float(np.mean(np.maximum(tau * d, (tau - 1) * d)))


def prob_above(x: float, p10: float, p50: float, p90: float, floor: float = 0.02, ceil: float = 0.98) -> float:
    """P(value > x) from three quantiles: piecewise-linear CDF through them, tails extended at the same slopes.

    Same rule as engine.market.questions.prob_above, so a bot's probability and the market's agree.
    """
    if not p10 < p50 < p90:
        return 0.5 if x == p50 else (floor if x > p50 else ceil)
    cdf = 0.5 - 0.4 * (p50 - x) / (p50 - p10) if x <= p50 else 0.5 + 0.4 * (x - p50) / (p90 - p50)
    return float(np.clip(1 - cdf, floor, ceil))
