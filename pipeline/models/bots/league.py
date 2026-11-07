"""Assemble the league, score it in the walk-forward backtest, and fit it as of a date for the market.

fit_league(tr, ctx) fits every bot on one training frame; the Committee stacks the other three. In the backtest the
house model's boosters are passed in, so it is trained once per fold, as before.
"""

import logging

import numpy as np
import pandas as pd

from pipeline.features import build
from pipeline.models import train

from .base import Bot, Context, assert_no_leakage, pinball
from .committee import Committee
from .engineer import Engineer
from .lgbm import OurModel
from .naive import LastWeek, Yesterday

log = logging.getLogger("pipeline.bots")

BOT_CLASSES = (Yesterday, LastWeek, Engineer, Committee)
NAMES = tuple(c.name for c in BOT_CLASSES)
TARGETS = ("price_da", "gb_system_price")


def specs() -> list[dict]:
    """Name, title and one-line method of every league member, our model first."""
    return [OurModel().spec(), *(c().spec() for c in BOT_CLASSES)]


def fit_league(tr: pd.DataFrame, ctx: Context, ours: OurModel | None = None) -> dict[str, Bot]:
    """Fit all four bots (and our model unless given) on tr; returns them by name."""
    ours = ours or OurModel().fit(tr, ctx)
    ours.trained_through = ours.trained_through or tr["ts"].max()
    yday, week = Yesterday().fit(tr, ctx), LastWeek().fit(tr, ctx)
    eng = Engineer().fit(tr, ctx)
    make = lambda: [OurModel(calibrate_bands=False), Engineer(), Yesterday()]  # noqa: E731
    committee = Committee([ours, eng, yday], make).fit(tr, ctx)
    return {b.name: b for b in (ours, yday, week, eng, committee)}


def predict_league(bots: dict[str, Bot], rows: pd.DataFrame, ctx: Context) -> dict[str, np.ndarray]:
    return {name: b.predict(rows, ctx) for name, b in bots.items()}


def fold_metrics(fold: int, target: str, te: pd.DataFrame, preds: dict[str, np.ndarray], ok_by_zone: dict) -> list[dict]:
    """One row per zone and bot for a test block: MAE of the median, pinball loss, P10-P90 coverage, n."""
    rows = []
    for zone, (idx, ok) in ok_by_zone.items():
        y = te["y"].to_numpy(float)[idx][ok]
        for name, q in preds.items():
            qz = q[idx][ok]
            rows.append({"fold": fold, "zone": zone, "target": target, "model": name,
                         "mae": float(np.abs(y - qz[:, 1]).mean()), "pinball": pinball(y, qz),
                         "coverage_p10_p90": float(((y >= qz[:, 0]) & (y <= qz[:, 2])).mean()), "n": int(ok.sum())})
    return rows


def fit_asof(date, target: str = "price_da", inputs: build.Inputs | None = None, params: dict | None = None) -> tuple[dict[str, Bot], Context]:
    """Every bot fitted only on rows strictly before `date` (UTC; a bare date means midnight), for the market.

    Predict with predict_league(bots, rows, ctx) on feature rows for the day. The no-leakage check is run before returning.
    """
    d = pd.Timestamp(date)
    d = d.tz_localize("UTC") if d.tzinfo is None else d.tz_convert("UTC")
    inp = inputs or build.Inputs()
    wides = train.target_frames(inp)
    if target not in wides:
        raise ValueError(f"no cached actuals for {target}")
    hist = build.build_history(end=d - pd.Timedelta(hours=1), inputs=inp)
    tr = train.training_frame(hist, wides[target], d)
    if len(tr) < train.MIN_ROWS:
        raise ValueError(f"only {len(tr)} training rows before {d}")
    ctx = Context(wide=wides[target], params=params or {})
    bots = fit_league(tr, ctx)
    for b in bots.values():
        assert_no_leakage(b, d)
    return bots, ctx
