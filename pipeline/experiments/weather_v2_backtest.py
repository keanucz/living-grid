"""Does weather v2 help the price, load and wind models? A like-for-like walk-forward comparison. Nothing here goes live.

    uv run python -m pipeline.experiments.weather_v2_backtest --data-dir DIR --since 2025-01-01 --folds 6 --test-days 7

The live feature set stays as it is (schemas.FEATURE_COLUMNS). This script runs pipeline.backtest twice on exactly the
same rows and folds, with the same parameters:
  base  the current features (the recipe of the live model)
  v2    the current features plus zone-level weather v2 columns, taken from the historical-forecast kind (a forecast-like
        number, as the live features are), never from the archive
and writes the per-zone, per-target comparison. Wins and losses are both reported. The extra columns are only a candidate
until a later task adds them to the live features, the scheduler and the explanations.
"""

import argparse
import logging
import sys
from contextlib import contextmanager
from pathlib import Path

import numpy as np
import pandas as pd

from pipeline import cache, schemas

log = logging.getLogger("pipeline.weather_v2_backtest")

V2_FEATURES = ["gust_max_ms", "cloud_mean_pct", "precip_mm", "wind_100m_farm_ms", "alert_gust_share", "alert_rain_share"]
NAME = "backtest/weather_v2_comparison"


def v2_columns(zones=schemas.ZONES) -> pd.DataFrame:
    from pipeline.ingest import weather_v2 as w

    hf = w.read("historical_forecast")
    th = w.alert_thresholds(w.read("archive"))
    z = w.zone_features(hf, th)
    return z[z["zone"].isin(zones)][["ts", "zone", *[c for c in V2_FEATURES if c in z.columns]]]


@contextmanager
def variant(extra: pd.DataFrame | None, since: pd.Timestamp):
    """Patch build_history to start at `since` and, for the v2 variant, carry the extra columns and let the models use them."""
    from pipeline.features import build
    from pipeline.models import quantile

    orig_hist, orig_feat, orig_cols = build.build_history, quantile.FEATURES, schemas.FEATURE_COLUMNS

    def history(*a, **k):
        # build_history selects schemas.FEATURE_COLUMNS, so build it with the live columns and merge the v2 ones after.
        current, schemas.FEATURE_COLUMNS = schemas.FEATURE_COLUMNS, orig_cols
        try:
            h = orig_hist(*a, **k)
        finally:
            schemas.FEATURE_COLUMNS = current
        h = h[h["ts"] >= since].reset_index(drop=True)
        if extra is not None:
            h = h.merge(extra, on=["ts", "zone"], how="left")
        return h

    build.build_history = history
    if extra is not None:
        cols = [c for c in V2_FEATURES if c in extra.columns]
        schemas.FEATURE_COLUMNS = [*orig_cols, *cols]
        quantile.FEATURES = ["zone_id", *schemas.FEATURE_COLUMNS]
    try:
        yield
    finally:
        build.build_history, quantile.FEATURES, schemas.FEATURE_COLUMNS = orig_hist, orig_feat, orig_cols


def run(since="2025-01-01", folds=6, test_days=7, targets=None, n_jobs=2) -> pd.DataFrame:
    from pipeline import backtest

    extra = v2_columns()
    since = pd.Timestamp(since, tz="UTC")
    out = {}
    for name, ex in (("base", None), ("v2", extra)):
        with variant(ex, since):
            log.info("running the %s variant", name)
            wf, lg = backtest.run_with_league(n_folds=folds, test_days=test_days, targets=targets, params={"n_jobs": n_jobs}, bots=False)
            out[name] = lg[lg["model"] == backtest.MODEL]
    return compare(out["base"], out["v2"])


def compare(base: pd.DataFrame, v2: pd.DataFrame) -> pd.DataFrame:
    """Per target and zone, n-weighted over folds: MAE and pinball for both variants, and the change (negative is better)."""
    def agg(df):
        g = df.groupby(["target", "zone"])
        return g.apply(lambda d: pd.Series({"n": int(d["n"].sum()), "mae": np.average(d["mae"], weights=d["n"]),
                                            "pinball": np.average(d["pinball"], weights=d["n"]),
                                            "coverage": np.average(d["coverage_p10_p90"], weights=d["n"])}), include_groups=False)

    b, v = agg(base), agg(v2)
    out = b.join(v, lsuffix="_base", rsuffix="_v2")
    out["mae_change_pct"] = 100 * (out["mae_v2"] / out["mae_base"] - 1)
    out["pinball_change_pct"] = 100 * (out["pinball_v2"] / out["pinball_base"] - 1)
    return out.reset_index()


def report(cmp: pd.DataFrame) -> str:
    lines = ["| target | zone | n | MAE base | MAE v2 | change | pinball change | coverage base / v2 |", "|---|---|---|---|---|---|---|---|"]
    for r in cmp.itertuples():
        lines.append(f"| {r.target} | {r.zone} | {r.n_base} | {r.mae_base:.2f} | {r.mae_v2:.2f} | {r.mae_change_pct:+.1f}% | "
                     f"{r.pinball_change_pct:+.1f}% | {100 * r.coverage_base:.0f}% / {100 * r.coverage_v2:.0f}% |")
    tot = cmp.groupby("target").apply(lambda d: pd.Series({
        "mae_change_pct": 100 * (np.average(d["mae_v2"], weights=d["n_base"]) / np.average(d["mae_base"], weights=d["n_base"]) - 1),
        "pinball_change_pct": 100 * (np.average(d["pinball_v2"], weights=d["n_base"]) / np.average(d["pinball_base"], weights=d["n_base"]) - 1),
        "zones_better": int((d["pinball_change_pct"] < 0).sum()), "zones": len(d)}), include_groups=False)
    lines += ["", "| target | MAE change | pinball change | zones better (pinball) |", "|---|---|---|---|"]
    for t, r in tot.iterrows():
        lines.append(f"| {t} | {r.mae_change_pct:+.1f}% | {r.pinball_change_pct:+.1f}% | {int(r.zones_better)} of {int(r.zones)} |")
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Compare the models with and without weather v2 features.")
    ap.add_argument("--data-dir", default=None, help="a data directory holding the caches and weather_v2 (default data/)")
    ap.add_argument("--since", default="2025-01-01")
    ap.add_argument("--folds", type=int, default=6)
    ap.add_argument("--test-days", type=int, default=7)
    ap.add_argument("--targets", default="all")
    ap.add_argument("--n-jobs", type=int, default=2)
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.data_dir:
        cache.DATA = Path(args.data_dir)
    cmp = run(args.since, args.folds, args.test_days, args.targets.split(","), args.n_jobs)
    cache.write(NAME, cmp)
    print(report(cmp))
    return 0


if __name__ == "__main__":
    sys.exit(main())
