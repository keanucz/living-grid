"""Bot league: rival forecasters that produce as-of P10/P50/P90 per zone-hour.

Yesterday and Last week (naive), The Engineer (merit order), The Committee (QRA ensemble), plus Our model
(LightGBM, pipeline.models.quantile). All obey the same no-leakage rule as the live features.
"""

from .base import Bot, Context, assert_no_leakage, pinball, prob_above
from .league import BOT_CLASSES, NAMES, TARGETS, fit_asof, fit_league, predict_league, specs

__all__ = ["BOT_CLASSES", "NAMES", "TARGETS", "Bot", "Context", "assert_no_leakage", "fit_asof", "fit_league",
           "pinball", "predict_league", "prob_above", "specs"]
