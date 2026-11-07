"""Purged walk-forward backtest of the quantile models against two naive baselines.

    uv run python -m pipeline.backtest [--folds 6] [--test-days 7] [--purge-hours 48] [--targets all]

Expanding-window folds. Fold k tests on a block of --test-days and trains only on rows with ts earlier than the
test start minus the purge gap, so no fold trains on data at or after its test start. Features are the same
no-leakage ones as live (each row is a forecast made LEAD hours ahead).
The model (lgbm_q) and both baselines are scored on exactly the same rows, so a baseline gap never flatters either:
  persistence  the last completed hour before the forecast was made
  yesterday    the same hour a whole number of days earlier
Writes data/backtest/walk_forward.parquet: fold, zone, target, model, mae, coverage_p10_p90, n. Baselines have no
band, so their coverage is null. Prices are GBP/MWh for GB and EUR/MWh elsewhere, so compare within a zone.
Losses to a baseline are printed as plainly as wins.
"""

import argparse
import logging
import sys

import numpy as np
import pandas as pd
import pyarrow as pa

from pipeline import cache, schemas
from pipeline.features import build
from pipeline.models import quantile, train

log = logging.getLogger("pipeline.backtest")

NAME = "backtest/walk_forward"
MODEL = "lgbm_q"
BASELINES = ("persistence", "yesterday")
MIN_TRAIN_ROWS = 500


def make_folds(first: pd.Timestamp, last: pd.Timestamp, n_folds: int, test_days: int, purge_h: int):
    """(train_end, test_start, test_end) per fold: train on ts < train_end, test on test_start <= ts < test_end."""
    end = last.floor("h") + pd.Timedelta(hours=1)
    folds = []
    for k in range(n_folds):
        test_start = end - pd.Timedelta(days=(n_folds - k) * test_days)
        folds.append((test_start - pd.Timedelta(hours=purge_h), test_start, test_start + pd.Timedelta(days=test_days)))
    return folds


def baselines(wide: pd.DataFrame, zone: str, ts: pd.DatetimeIndex, lead_h: int) -> pd.DataFrame:
    """Persistence and yesterday values for each ts, using only data complete at the forecast origin."""
    origin = ts - pd.Timedelta(hours=lead_h)
    k = np.maximum(1, np.ceil((lead_h + 1) / 24)).astype(int)
    series = wide.get(zone)
    return pd.DataFrame(
        {
            "persistence": build._at(series, origin - pd.Timedelta(hours=1), "3h"),
            "yesterday": build._at(series, ts - pd.Timedelta(hours=24 * int(k)), "3h"),
        },
        index=ts,
    )


def _fold_rows(fold, target, test, boosters, wide, lead_h) -> list[dict]:
    x = quantile.design(test)
    q = np.sort(np.column_stack([boosters[n].predict(x, num_threads=1) for n in quantile.QUANTILES]), axis=1)
    rows = []
    for zone, g in test.reset_index(drop=True).groupby("zone"):
        base = baselines(wide, zone, pd.DatetimeIndex(g["ts"]), lead_h)
        y = g["y"].to_numpy()
        ok = base.notna().all(axis=1).to_numpy()
        if not ok.any():
            continue
        qz = q[g.index.to_numpy()][ok]
        n = int(ok.sum())
        covered = float(((y[ok] >= qz[:, 0]) & (y[ok] <= qz[:, 2])).mean())
        rows.append({"fold": fold, "zone": zone, "target": target, "model": MODEL,
                     "mae": float(np.abs(y[ok] - qz[:, 1]).mean()), "coverage_p10_p90": covered, "n": n})
        for b in BASELINES:
            rows.append({"fold": fold, "zone": zone, "target": target, "model": b,
                         "mae": float(np.abs(y[ok] - base[b].to_numpy()[ok]).mean()), "coverage_p10_p90": np.nan, "n": n})
    return rows


def run(n_folds=6, test_days=7, purge_h=48, targets=None, lead_h=build.HISTORY_LEAD_H, params=None, inputs=None,
        min_train_rows=MIN_TRAIN_ROWS) -> pd.DataFrame:
    inp = inputs or build.Inputs()
    hist = build.build_history(lead_h=lead_h, inputs=inp)
    if hist.empty:
        raise ValueError("no feature history; has the backfill finished?")
    wides = train.target_frames(inp)
    chosen = list(wides) if not targets or targets == ["all"] else list(targets)
    unknown = [t for t in chosen if t not in wides]
    if unknown:
        raise ValueError(f"no cached actuals for target(s) {unknown}; have {list(wides)}")
    folds = make_folds(hist["ts"].min(), hist["ts"].max(), n_folds, test_days, purge_h)
    params = {**train.PARAMS, **(params or {})}
    rows = []
    for t in chosen:
        df = train.training_frame(hist, wides[t], pd.Timestamp.max.tz_localize("UTC"))
        for k, (train_end, test_start, test_end) in enumerate(folds):
            tr = df[df["ts"] < train_end]
            te = df[(df["ts"] >= test_start) & (df["ts"] < test_end)]
            if len(tr) < min_train_rows or te.empty:
                log.warning("fold %d of %s skipped: %d training rows, %d test rows", k, t, len(tr), len(te))
                continue
            log.info("fold %d %s: train %d rows to %s, test %d rows from %s", k, t, len(tr), train_end, len(te), test_start)
            rows += _fold_rows(k, t, te, train.fit_target(tr, params), wides[t], lead_h)
    out = pd.DataFrame(rows, columns=schemas.WALK_FORWARD.names)
    if out.empty:
        raise ValueError("no fold had enough data; run the backfill or lower --folds / --test-days")
    return out.astype({"fold": "int32", "n": "int64"})


def check(df: pd.DataFrame) -> pd.DataFrame:
    """Cast to the contract schema (baseline coverage stays null, which schemas.validate would reject)."""
    pa.Table.from_pandas(df[schemas.WALK_FORWARD.names], schema=schemas.WALK_FORWARD, preserve_index=False, safe=True)
    return df


def summary(df: pd.DataFrame) -> pd.DataFrame:
    """Per zone and target over all folds: n-weighted MAE of each model, the model's ratio to each baseline, coverage."""
    def agg(g):
        mae = {m: np.average(g[g.model == m]["mae"], weights=g[g.model == m]["n"]) for m in g.model.unique()}
        cov = g[g.model == MODEL]
        return pd.Series({
            "n": int(cov["n"].sum()),
            "mae_model": mae[MODEL],
            "mae_persistence": mae["persistence"],
            "mae_yesterday": mae["yesterday"],
            "ratio_vs_persistence": mae[MODEL] / mae["persistence"],
            "ratio_vs_yesterday": mae[MODEL] / mae["yesterday"],
            "coverage_p10_p90": np.average(cov["coverage_p10_p90"], weights=cov["n"]),
        })

    with np.errstate(divide="ignore", invalid="ignore"):
        return df.groupby(["target", "zone"]).apply(agg, include_groups=False).reset_index()


def losses(summ: pd.DataFrame) -> pd.DataFrame:
    """Zone and target pairs where the model is worse than a baseline."""
    return summ[(summ["ratio_vs_persistence"] > 1) | (summ["ratio_vs_yesterday"] > 1)]


def report(df: pd.DataFrame) -> str:
    s = summary(df)
    lines = ["target zone n mae_model ratio_vs_persistence ratio_vs_yesterday coverage_p10_p90"]
    for r in s.itertuples():
        lines.append(f"{r.target} {r.zone} {r.n} {r.mae_model:.2f} {r.ratio_vs_persistence:.2f} {r.ratio_vs_yesterday:.2f} "
                     f"{r.coverage_p10_p90:.2f}")
    lost = losses(s)
    lines.append(f"model beats both baselines in {len(s) - len(lost)} of {len(s)} zone-target pairs "
                 "(ratio below 1 is a win, nominal band coverage is 0.80)")
    for r in lost.itertuples():
        which = [n for n, v in (("persistence", r.ratio_vs_persistence), ("yesterday", r.ratio_vs_yesterday)) if v > 1]
        lines.append(f"LOSS {r.target} {r.zone}: worse than {' and '.join(which)}")
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Purged walk-forward backtest against persistence.")
    ap.add_argument("--folds", type=int, default=6)
    ap.add_argument("--test-days", type=int, default=7)
    ap.add_argument("--purge-hours", type=int, default=48)
    ap.add_argument("--targets", default="all", help="comma-separated or 'all': " + ", ".join(schemas.TARGETS))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        df = check(run(args.folds, args.test_days, args.purge_hours, args.targets.split(",")))
    except (ValueError, FileNotFoundError) as e:
        log.error("%s", e)
        return 1
    cache.write(NAME, df)
    log.info("wrote %s\n%s", cache.path(NAME), report(df))
    return 0


if __name__ == "__main__":
    sys.exit(main())
