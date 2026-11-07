"""Train the LightGBM quantile models from the cached history.

    uv run python -m pipeline.models.train                       # all targets, everything cached
    uv run python -m pipeline.models.train --trained-before 2026-10-26 --version lgbm-asof-20261026
    uv run python -m pipeline.models.train --targets price_da,load --since 2024-06-01

Writes data/models/<version>/ (or LG_MODELS_DIR, or --out-dir). As-of replay models (--trained-before well in the past) never become
the live model; keep them in data/models-asof via --out-dir: per target and quantile a LightGBM text file
{target}_{p10,p50,p90}.txt and a small JSON {target}_{q}.json, plus meta.json. No pickles, so a version can be trained
on any machine and copied into the runner's data/models/. The version is built in a dot-prefixed temp directory
and renamed when finished, so a half-written or half-copied version is never loaded. Only rows with ts before --trained-before
are used (default: now), so a model can be rebuilt as of a past date for replay. Needs the ingest caches.
"""

import argparse
import json
import logging
import os
import shutil
import sys
from pathlib import Path

import lightgbm as lgb
import pandas as pd

from pipeline import cache, schemas
from pipeline.features import build
from pipeline.models import calibrate, quantile

log = logging.getLogger("pipeline.train")

PARAMS = {
    "n_estimators": 400,
    "learning_rate": 0.04,
    "num_leaves": 31,
    "min_child_samples": 30,
    "subsample": 0.8,
    "subsample_freq": 1,
    "colsample_bytree": 0.8,
    "verbosity": -1,
    "n_jobs": os.cpu_count() or 1,
}
MIN_ROWS = 200


def target_frames(inp: build.Inputs) -> dict[str, pd.DataFrame]:
    """Wide hourly actuals (ts index, zone columns) for each target."""
    # Energy-Charts load and wind for Norway cover the whole country, not NO2, so they are not NO2 targets.
    country_level = ["NO2"]
    out = {"price_da": inp.price, "load": inp.load.drop(columns=country_level, errors="ignore"),
           "wind": inp.wind.drop(columns=country_level, errors="ignore")}
    try:
        sp = cache.read("actuals/elexon_system_price")
        out["gb_system_price"] = sp[sp["zone"] == "GB"].set_index("ts")["value"].sort_index().to_frame("GB")
    except FileNotFoundError:
        pass
    return {t: w for t, w in out.items() if len(w)}


def training_frame(hist: pd.DataFrame, wide: pd.DataFrame, trained_before: pd.Timestamp) -> pd.DataFrame:
    y = wide.stack().rename("y").reset_index()
    y.columns = ["ts", "zone", "y"]
    df = hist.merge(y, on=["ts", "zone"]).dropna(subset=["y"])
    return df[df["ts"] < trained_before].reset_index(drop=True)


def fit_target(df: pd.DataFrame, params: dict) -> dict[str, lgb.Booster]:
    x = quantile.design(df)
    boosters = {}
    for name, alpha in quantile.QUANTILES.items():
        m = lgb.LGBMRegressor(objective="quantile", alpha=alpha, **params)
        m.fit(x, df["y"], categorical_feature=["zone_id"])
        boosters[name] = m.booster_
    return boosters


def calibration(df: pd.DataFrame, params: dict) -> dict | None:
    """Conformal P10-P90 scale for one target, fitted on its most recent week held out from a separate fit."""
    return calibrate.fit(df, lambda rows: fit_target(rows, params), quantile.raw_quantiles)


def train(targets=None, trained_before=None, version=None, since=None, params=None, out_dir=None, inputs=None,
          trained_at=None, calibrate_bands=True):
    """Train and save a model; returns its directory."""
    now = pd.Timestamp.now(tz="UTC") if trained_at is None else pd.Timestamp(trained_at)
    before = now if trained_before is None else pd.Timestamp(trained_before)
    before = before.tz_localize("UTC") if before.tzinfo is None else before.tz_convert("UTC")
    version = version or f"lgbm-{now:%Y%m%dT%H%M}"
    params = {**PARAMS, **(params or {})}
    inp = inputs or build.Inputs()
    hist = build.build_history(start=since, end=before - pd.Timedelta(hours=1), inputs=inp)
    wides = target_frames(inp)
    chosen = list(wides) if not targets or targets == ["all"] else list(targets)
    unknown = [t for t in chosen if t not in wides]
    if unknown:
        raise ValueError(f"no cached actuals for target(s) {unknown}; have {list(wides)}")

    root = out_dir or quantile.models_dir()
    if before < now - quantile.AS_OF_TOLERANCE and out_dir is None:
        log.warning("--trained-before is a day or more in the past: this is an as-of replay model and the live "
                    "scheduler will ignore it. Keep replay models apart with --out-dir data/models-asof")
    final, tmp = root / version, root / f".tmp-{version}-{os.getpid()}"
    if final.exists():
        raise FileExistsError(f"{final} already exists; pass a different --version")
    tmp.mkdir(parents=True)
    try:
        meta = {"version": version, "trained_at": now.isoformat(), "trained_before": before.isoformat(),
                "features": quantile.FEATURES, "targets": [], "zones": {}, "rows": {}, "window": {}, "params": params,
                "calibration": {}}
        for t in chosen:
            df = training_frame(hist, wides[t], before)
            if len(df) < MIN_ROWS:
                log.warning("skipping %s: only %d training rows (need %d)", t, len(df), MIN_ROWS)
                continue
            log.info("training %s on %d rows across %s", t, len(df), sorted(df["zone"].unique()))
            window = {"start": df["ts"].min().isoformat(), "end": df["ts"].max().isoformat()}
            for q, booster in fit_target(df, params).items():
                booster.save_model(str(tmp / f"{t}_{q}.txt"))
                info = {"model_version": version, "target": t, "quantile": quantile.QUANTILES[q], "name": q,
                        "features": quantile.FEATURES, "train_window": window, "rows": len(df)}
                (tmp / f"{t}_{q}.json").write_text(json.dumps(info, indent=1))
            cal = calibration(df, params) if calibrate_bands else None
            if cal:
                log.info("%s: P10-P90 scale %.2f (held-out coverage %.0f%% -> %.0f%% on %d rows)", t, cal["scale"],
                         100 * cal["coverage_before"], 100 * cal["coverage_after"], cal["n"])
                meta["calibration"][t] = cal
            meta["targets"].append(t)
            meta["zones"][t] = sorted(df["zone"].unique())
            meta["rows"][t] = len(df)
            meta["window"][t] = window
        if not meta["targets"]:
            raise ValueError("no target had enough training rows; has the backfill finished?")
        files = {p.name: p.stat().st_size for p in sorted(tmp.iterdir())}
        meta["files"] = files
        (tmp / "meta.json").write_text(json.dumps(meta, indent=1))
        tmp.rename(final)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    out = final
    log.info("saved %s", out)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Train the LightGBM quantile models.")
    ap.add_argument("--targets", default="all", help="comma-separated or 'all': " + ", ".join(schemas.TARGETS))
    ap.add_argument("--trained-before", default=None, help="only use data before this UTC time (default now)")
    ap.add_argument("--since", default=None, help="first UTC day of training rows")
    ap.add_argument("--version", default=None)
    ap.add_argument("--out-dir", default=None, help="default data/models, or LG_MODELS_DIR")
    ap.add_argument("--no-calibrate", action="store_true", help="skip the conformal P10-P90 calibration")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        path = train(args.targets.split(","), args.trained_before, args.version, args.since,
                     out_dir=Path(args.out_dir) if args.out_dir else None, calibrate_bands=not args.no_calibrate)
    except (ValueError, FileNotFoundError, FileExistsError) as e:
        log.error("%s", e)
        return 1
    log.info("model ready at %s", path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
