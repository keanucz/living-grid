"""Models trained only on data strictly before a date, for replaying a past event honestly.

    uv run python -m pipeline.models.asof 2026-10-26        # train and cache, then print where it is

as_of(date) returns the cached model for that date or trains it first. Versions live in data/models-asof/
(or LG_ASOF_DIR), apart from data/models/, so a replay model can never become the live one. Every load checks
the recorded training window of each target ends before the date and refuses the model otherwise.
With no cached history at all (a fixtures-only checkout) it returns the untrained stub, labelled stub-0, so replay
still runs offline. If history exists but is too short for the date, it raises instead.
"""

import argparse
import json
import logging
import os
import sys
from pathlib import Path

import pandas as pd

from pipeline import cache

from .quantile import QuantileModel, incomplete

log = logging.getLogger("pipeline.asof")


def asof_dir() -> Path:
    return Path(os.environ["LG_ASOF_DIR"]) if os.environ.get("LG_ASOF_DIR") else cache.DATA / "models-asof"


def _utc(date) -> pd.Timestamp:
    d = pd.Timestamp(date)
    return d.tz_localize("UTC") if d.tzinfo is None else d.tz_convert("UTC")


def version_name(date) -> str:
    d = _utc(date)
    return f"asof-{d:%Y%m%d}" if d == d.normalize() else f"asof-{d:%Y%m%dT%H%M}"


def check_no_leakage(path: Path, date: pd.Timestamp) -> None:
    """Raise unless the model was trained for this date and no training row is at or after it."""
    meta = json.loads((path / "meta.json").read_text())
    if pd.Timestamp(meta["trained_before"]) != date:
        raise ValueError(f"{path} was trained before {meta['trained_before']}, not {date}")
    windows = meta.get("window") or {}
    if set(windows) != set(meta["targets"]):
        raise ValueError(f"{path} does not record a training window for every target, so it cannot be trusted")
    for target, w in windows.items():
        if pd.Timestamp(w["end"]) >= date:
            raise ValueError(f"refusing {path}: {target} was trained on data up to {w['end']}, at or after {date}")


def as_of(date, train: bool = True, targets=None, params=None) -> QuantileModel:
    """Model trained only on data before `date` (UTC; a bare date means midnight), cached under data/models-asof/."""
    d = _utc(date)
    root, name = asof_dir(), version_name(date)
    path = root / name
    if path.exists():
        missing = incomplete(path)
        if missing:
            raise ValueError(f"{path} exists but is incomplete ({missing}); remove it to retrain")
    elif not train:
        raise FileNotFoundError(f"no as-of model for {d} in {root}; run: python -m pipeline.models.asof {d:%Y-%m-%d}")
    else:
        from . import train as trainer

        log.info("training %s on data before %s", name, d)
        try:
            path = trainer.train(targets, trained_before=d, version=name, params=params, out_dir=root)
        except ValueError:
            if not trainer.build.build_history().empty:
                raise
            log.warning("no cached history at all, so as_of(%s) is the untrained stub (version stub-0)", d)
            return QuantileModel(trained_before=d)
    check_no_leakage(path, d)
    return QuantileModel.load(path)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Train and cache a model on data before a date, for replay.")
    ap.add_argument("date", help="UTC date or time; only data strictly before it is used")
    ap.add_argument("--targets", default="all")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        model = as_of(args.date, targets=args.targets.split(","))
    except (ValueError, FileNotFoundError, FileExistsError) as e:
        log.error("%s", e)
        return 1
    log.info("ready: %s (trained before %s) in %s", model.version, model.trained_before, asof_dir())
    return 0


if __name__ == "__main__":
    sys.exit(main())
