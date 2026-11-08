"""Opening prices calibrated on how our as-of forecasts actually missed on earlier mystery days (#291).

The as-of models undershoot their median in the afternoon (docs/findings/qa-pm-quant.md), so a market whose line is
the median opened at 50 while "above" came true about 70% of the time. Here the opening probability is the share of
earlier misses that would have cleared the line, measured in units of each forecast's own 80% range:

    z = (actual - p50) / (p90 - p10)      for every hour within WINDOW_H of the market's hour, same zone and series

taken from replay days strictly before the mystery day. Each of those replays comes from a model trained before its
own day, so the misses are out of sample, and none of them can know anything about the mystery day. The line stays
at our median; only the price moves. The empirical share is shrunk toward the raw model's probability with a prior of
PRIOR_HOURS hours, and with fewer than MIN_HOURS earlier hours the raw model is used and the note says so.
"""

from collections.abc import Iterable

import numpy as np
import pandas as pd

from engine.market.questions import P_CEIL, P_FLOOR

WINDOW_H = 2
MIN_HOURS = 20
PRIOR_HOURS = 10


def _z_rows(replays: Iterable[dict]) -> pd.DataFrame:
    rows = []
    for r in replays:
        for s in r.get("series", []):
            for p in s.get("points", []):
                a, lo, mid, hi = p.get("actual"), p.get("p10"), p.get("p50"), p.get("p90")
                if a is None or lo is None or mid is None or hi is None or not hi > lo:
                    continue
                rows.append((s["zone"], s["target"], pd.Timestamp(p["ts"]).hour, (a - mid) / (hi - lo)))
    return pd.DataFrame(rows, columns=["zone", "target", "hour", "z"])


class Calibration:
    """Residuals from a set of earlier replay days; prob() turns a raw opening probability into a calibrated one."""

    def __init__(self, earlier: list[dict]):
        self.days = len(earlier)
        self.z = _z_rows(earlier)

    def prob(self, zone: str, target: str, hour: int, x: float, p10: float, p50: float, p90: float, raw: float) -> tuple[float, str]:
        z = self.z
        z = z[(z["zone"] == zone) & (z["target"] == target)] if len(z) else z
        z = z[((z["hour"] - hour).abs() <= WINDOW_H)]["z"].to_numpy() if len(z) else np.array([])
        n = len(z)
        if n < MIN_HOURS or not p90 > p10:
            return raw, f"Opening price is the raw model: only {n} earlier hours to check its misses against (need {MIN_HOURS})."
        line = (x - p50) / (p90 - p10)
        above = int((z > line).sum())
        p = float(np.clip((above + PRIOR_HOURS * raw) / (n + PRIOR_HOURS), P_FLOOR, P_CEIL))
        share = float((z > 0).mean())
        return p, (f"On {n} hours around {hour:02d}:00 on {self.days} earlier days, the actual came in above our median "
                   f"{share:.0%} of the time, so the opening price allows for that.")


def for_day(day, replays: Iterable[dict]) -> Calibration:
    """Calibration for a mystery day from the replays of days strictly before it (never the day itself or later)."""
    d = pd.Timestamp(day).normalize().tz_localize(None)
    return Calibration([r for r in replays if pd.Timestamp(r["event"]).normalize().tz_localize(None) < d])
