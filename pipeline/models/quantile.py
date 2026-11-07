"""LightGBM quantile models (alpha 0.1, 0.5, 0.9) per target, with a stub fallback when none are trained.

Models live in data/models/<version>/ (see pipeline.models.train). One pooled booster per target and quantile,
with the zone as a categorical feature. Quantiles are sorted per row so p10 <= p50 <= p90, then the P10-P90 band
is scaled by the per-target conformal factor in meta.json["calibration"] when present (pipeline.models.calibrate).
"""

import functools
import json
import os
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

from pipeline import cache, schemas
from pipeline.models import calibrate

VERSION = "stub-0"
QUANTILES = {"p10": 0.1, "p50": 0.5, "p90": 0.9}
TARGET_ZONES = {"gb_system_price": ["GB"]}
FEATURES = ["zone_id", *schemas.FEATURE_COLUMNS]
STUB_TARGETS = ("price_da", "gb_system_price")
AS_OF_TOLERANCE = pd.Timedelta(days=1)


def models_dir() -> Path:
    """data/models, or LG_MODELS_DIR when set (for models trained elsewhere and copied in)."""
    return Path(os.environ["LG_MODELS_DIR"]) if os.environ.get("LG_MODELS_DIR") else cache.DATA / "models"


def zone_id(zones: pd.Series) -> np.ndarray:
    return zones.map({z: i for i, z in enumerate(schemas.ZONES)}).to_numpy(dtype="int32")


def design(features: pd.DataFrame) -> pd.DataFrame:
    x = features[schemas.FEATURE_COLUMNS].astype("float64").copy()
    x.insert(0, "zone_id", zone_id(features["zone"]))
    return x[FEATURES]


def raw_quantiles(boosters: dict, features: pd.DataFrame) -> np.ndarray:
    """(n, 3) sorted p10, p50, p90 straight from the boosters, before calibration."""
    x = design(features)
    return np.sort(np.column_stack([boosters[q].predict(x, num_threads=1) for q in QUANTILES]), axis=1)


class QuantileModel:
    def __init__(self, trained_before: pd.Timestamp | None = None, boosters=None, meta: dict | None = None):
        self.trained_before = trained_before
        self.boosters: dict[str, dict[str, lgb.Booster]] = boosters or {}
        self.meta = meta or {}

    @property
    def version(self) -> str:
        return self.meta.get("version", VERSION)

    @property
    def targets(self) -> list[str]:
        return list(self.boosters) if self.boosters else list(STUB_TARGETS)

    @classmethod
    def load(cls, path: Path) -> "QuantileModel":
        path = Path(path)
        missing = incomplete(path)
        if missing:
            raise ValueError(f"{path} is not a complete model version: {missing}")
        meta = json.loads((path / "meta.json").read_text())
        boosters = {
            t: {q: lgb.Booster(model_file=str(path / f"{t}_{q}.txt")) for q in QUANTILES} for t in meta["targets"]
        }
        before = pd.Timestamp(meta["trained_before"]) if meta.get("trained_before") else None
        return cls(before, boosters, meta)

    def _quantiles(self, target: str, features: pd.DataFrame) -> pd.DataFrame:
        if self.boosters:
            p = raw_quantiles(self.boosters[target], features)
            s = self.meta.get("calibration", {}).get(target, {}).get("scale")
            if s:
                p = calibrate.apply(p, s)
            return pd.DataFrame(p, columns=list(QUANTILES), index=features.index)
        mid = features["price_lag_24h"].astype(float)
        spread = 5.0 + 0.1 * mid.abs()
        return pd.DataFrame({"p10": mid - spread, "p50": mid, "p90": mid + spread}, index=features.index)

    def predict(self, features: pd.DataFrame) -> pd.DataFrame:
        """Adds p10, p50, p90 for the day-ahead price (the contract's single-target form)."""
        out = features.copy()
        out[list(QUANTILES)] = self._quantiles("price_da", features)
        return out

    def predict_all(self, features: pd.DataFrame) -> pd.DataFrame:
        """Long frame of ts, zone, target, p10, p50, p90 for every target this model covers."""
        parts = []
        for target in self.targets:
            rows = features
            allowed = self.meta.get("zones", {}).get(target) or TARGET_ZONES.get(target)
            if allowed:
                rows = features[features["zone"].isin(allowed)]
            if rows.empty:
                continue
            q = self._quantiles(target, rows)
            parts.append(pd.concat([rows[["ts", "zone"]], q], axis=1).assign(target=target))
        cols = ["ts", "zone", "target", *QUANTILES]
        return pd.concat(parts, ignore_index=True)[cols] if parts else pd.DataFrame(columns=cols)

    def explain(self, features: pd.DataFrame) -> pd.DataFrame:
        from .explain import contributions

        return contributions(self, features)


def incomplete(path: Path) -> list[str]:
    """Why a version directory cannot be loaded; empty when meta.json and every listed file are present and full-size."""
    meta_path = Path(path) / "meta.json"
    if not meta_path.exists():
        return ["meta.json"]
    try:
        files = json.loads(meta_path.read_text())["files"]
    except (ValueError, KeyError):
        return ["meta.json unreadable"]
    return [
        name
        for name, size in files.items()
        if not (Path(path) / name).exists() or (Path(path) / name).stat().st_size != size
    ]


def is_as_of(meta: dict) -> bool:
    """True for a replay model: trained on data from well before the day it was trained."""
    if not meta.get("trained_before") or not meta.get("trained_at"):
        return False
    return pd.Timestamp(meta["trained_at"]) - pd.Timestamp(meta["trained_before"]) > AS_OF_TOLERANCE


def _versions(root: Path) -> list[Path]:
    """Live version directories, oldest first. Skips temp dirs (dot prefix), partial copies and as-of replay models."""
    found = []
    for meta_path in root.glob("*/meta.json"):
        d = meta_path.parent
        if d.name.startswith(".") or incomplete(d):
            continue
        meta = json.loads(meta_path.read_text())
        if is_as_of(meta):
            continue
        found.append((meta.get("trained_at", ""), d.name, d))
    return [d for *_, d in sorted(found)]


@functools.lru_cache(maxsize=4)
def _load_cached(path: str, mtime_ns: int) -> QuantileModel:
    return QuantileModel.load(Path(path))


def current() -> QuantileModel | None:
    """The newest complete live model under models_dir(), or None. As-of replay models are never current."""
    root = models_dir()
    versions = _versions(root) if root.exists() else []
    if not versions:
        return None
    p = versions[-1]
    return _load_cached(str(p), (p / "meta.json").stat().st_mtime_ns)


def active() -> QuantileModel:
    """Trained model when present, stub otherwise."""
    return current() or QuantileModel()


def predict(features: pd.DataFrame) -> pd.DataFrame:
    """Adds p10, p50, p90."""
    return active().predict(features)
