"""The Engineer: a merit-order forecaster. Price = f(residual load) + the cost of the gas and carbon that set it.

Per zone it fits a monotone piecewise-linear curve of (price minus marginal fuel cost) against residual load
(demand minus wind and solar), then adds the current fuel cost back. Fuel cost is a gas plant's: gas price times a
heat rate of 2 (efficiency near 50%) plus the carbon price times 0.37 t/MWh, in EUR/MWh (GB in GBP at 1.15).
Interpretable by construction: the curve is a short table of knots. Its band comes from errors on 30 days it was
not fitted on.
"""

import numpy as np
import pandas as pd

from .base import BAND_DAYS, MIN_BAND_ROWS, Bot, Context, banded, error_band

HEAT_RATE = 2.0
EMISSION_T_PER_MWH = 0.37
EUR_PER_GBP = 1.15
KNOTS = 24
MIN_ZONE_ROWS = 100


def fuel_cost(df: pd.DataFrame) -> np.ndarray:
    eur = HEAT_RATE * df["gas_ttf_eur_mwh"].to_numpy(float) + EMISSION_T_PER_MWH * df["eua_eur_t"].to_numpy(float)
    return np.where(df["zone"].to_numpy() == "GB", eur / EUR_PER_GBP, eur)


def monotone_curve(x: np.ndarray, y: np.ndarray, knots: int = KNOTS) -> tuple[np.ndarray, np.ndarray]:
    """Median of y in `knots` equal-count bins of x, made non-decreasing by pool-adjacent-violators."""
    from sklearn.isotonic import IsotonicRegression

    order = np.argsort(x)
    chunks = np.array_split(order, min(knots, max(2, len(x) // 20)))
    kx = np.array([np.median(x[c]) for c in chunks])
    ky = np.array([np.median(y[c]) for c in chunks])
    ky = IsotonicRegression(increasing=True).fit_transform(kx, ky)
    return kx, ky


class Engineer(Bot):
    name = "bot_engineer"
    title = "The Engineer"
    method = "Merit order: price from residual load, shifted by gas and carbon costs."

    def __init__(self):
        super().__init__()
        self.curves: dict[str, tuple[np.ndarray, np.ndarray]] = {}
        self.band: dict = {}

    def _curves(self, df: pd.DataFrame) -> dict:
        adj = df["y"].to_numpy(float) - fuel_cost(df)
        out = {}
        for zone, g in df.assign(adj=adj).groupby("zone"):
            if len(g) >= MIN_ZONE_ROWS:
                out[zone] = monotone_curve(g["residual_load_mw"].to_numpy(float), g["adj"].to_numpy(float))
        if out:
            kx, ky = monotone_curve(df["residual_load_mw"].to_numpy(float), adj)
            out["*"] = (kx, ky)
        return out

    def _point(self, df: pd.DataFrame, curves: dict) -> np.ndarray:
        base = np.full(len(df), np.nan)
        zones = df["zone"].to_numpy()
        rl = df["residual_load_mw"].to_numpy(float)
        for zone in pd.unique(zones):
            kx, ky = curves.get(zone, curves.get("*", (None, None)))
            if kx is None:
                continue
            idx = zones == zone
            base[idx] = np.interp(rl[idx], kx, ky)
        return base + fuel_cost(df)

    def _fit(self, df, ctx):
        cut = df["ts"].max() - pd.Timedelta(days=BAND_DAYS)
        early, late = df[df["ts"] < cut], df[df["ts"] >= cut]
        if len(early) >= MIN_ZONE_ROWS and len(late) >= MIN_BAND_ROWS:
            self.band = error_band(late, self._point(late, self._curves(early)))
        self.curves = self._curves(df)
        if not self.band:
            self.band = error_band(df, self._point(df, self.curves))
        return self

    def predict(self, df, ctx) -> np.ndarray:
        return banded(df, self._point(df, self.curves), self.band)

    def knots(self, zone: str) -> list[dict]:
        """The fitted curve for a zone as rows of residual load and the price excluding fuel cost, for display."""
        kx, ky = self.curves.get(zone, self.curves.get("*", ([], [])))
        return [{"residual_load_mw": float(a), "price_ex_fuel": float(b)} for a, b in zip(kx, ky, strict=True)]
