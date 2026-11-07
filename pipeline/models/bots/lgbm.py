"""Our model as a league member: the LightGBM quantile models behind the same Bot interface."""

import numpy as np
import pandas as pd

from pipeline.models import calibrate, quantile, train

from .base import Bot, Context


class OurModel(Bot):
    name = "lgbm_q"
    title = "Our model"
    method = "LightGBM quantile regression on 18 features, conformally calibrated."

    def __init__(self, boosters=None, scale: float | None = None, calibrate_bands: bool = True):
        super().__init__()
        self.boosters = boosters
        self.scale = scale
        self.calibrate_bands = calibrate_bands

    def fresh(self):
        return OurModel(calibrate_bands=False)

    def _fit(self, df: pd.DataFrame, ctx: Context):
        params = {**train.PARAMS, **ctx.params}
        self.boosters = train.fit_target(df, params)
        cal = train.calibration(df, params) if self.calibrate_bands else None
        self.scale = cal["scale"] if cal else None
        return self

    def predict(self, df: pd.DataFrame, ctx: Context) -> np.ndarray:
        q = quantile.raw_quantiles(self.boosters, df)
        return calibrate.apply(q, self.scale) if self.scale else q
