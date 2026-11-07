"""Train the LightGBM quantile models from the cached history.

    uv run python -m pipeline.models.train                       # all targets, everything cached
    uv run python -m pipeline.models.train --trained-before 2026-10-26 --version lgbm-asof-20261026
    uv run python -m pipeline.models.train --targets price_da,load --since 2024-06-01

Writes data/models/<version>/{target}_{p10,p50,p90}.txt and meta.json. Only rows with ts before --trained-before
are used (default: now), so a model can be rebuilt as of a past date for replay. Needs the ingest caches.
"""

import argparse
import json
import logging
import sys
from pathlib import Path

import lightgbm as lgb
import pandas as pd

from pipeline import cache, schemas
from pipeline.features import build
from pipeline.models import quantile

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
    "n_jobs": 4,
}
MIN_ROWS = 200


def target_frames(inp: build.Inputs) -> dict[str, pd.DataFrame]:
    """Wide hourly actuals (ts index, zone columns) for each target."""
    out = {"price_da": inp.price, "load": inp.load, "wind": inp.wind}
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


def train(targets=None, trained_before=None, version=None, since=None, params=None, out_dir=None, inputs=None):
    """Train and save a model; returns its directory."""
    now = pd.Timestamp.now(tz="UTC")
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

    out = (out_dir or quantile.models_dir()) / version
    out.mkdir(parents=True, exist_ok=True)
    meta = {"version": version, "trained_at": now.isoformat(), "trained_before": before.isoformat(),
            "features": quantile.FEATURES, "targets": [], "zones": {}, "rows": {}, "params": params}
    for t in chosen:
        df = training_frame(hist, wides[t], before)
        if len(df) < MIN_ROWS:
            log.warning("skipping %s: only %d training rows (need %d)", t, len(df), MIN_ROWS)
            continue
        log.info("training %s on %d rows across %s", t, len(df), sorted(df["zone"].unique()))
        for q, booster in fit_target(df, params).items():
            booster.save_model(str(out / f"{t}_{q}.txt"))
        meta["targets"].append(t)
        meta["zones"][t] = sorted(df["zone"].unique())
        meta["rows"][t] = len(df)
    if not meta["targets"]:
        raise ValueError("no target had enough training rows; has the backfill finished?")
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    log.info("saved %s", out)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Train the LightGBM quantile models.")
    ap.add_argument("--targets", default="all", help="comma-separated or 'all': " + ", ".join(schemas.TARGETS))
    ap.add_argument("--trained-before", default=None, help="only use data before this UTC time (default now)")
    ap.add_argument("--since", default=None, help="first UTC day of training rows")
    ap.add_argument("--version", default=None)
    ap.add_argument("--out-dir", default=None, help="default data/models")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        path = train(args.targets.split(","), args.trained_before, args.version, args.since,
                     out_dir=Path(args.out_dir) if args.out_dir else None)
    except (ValueError, FileNotFoundError) as e:
        log.error("%s", e)
        return 1
    log.info("model ready at %s", path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
