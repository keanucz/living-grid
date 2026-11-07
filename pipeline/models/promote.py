"""Move a finished model from data/models-incoming/<version>/ into data/models/ in a single rename.

    uv run python -m pipeline.models.promote <version> [--incoming DIR] [--models DIR]

Upload models trained elsewhere (for example on a Mac) into data/models-incoming/ first, then promote them. The
rename means a version is either wholly present in data/models/ or not there at all. Incomplete uploads are refused.
"""

import argparse
import logging
import sys
from pathlib import Path

from pipeline import cache
from pipeline.models import quantile

log = logging.getLogger("pipeline.promote")


def incoming_dir() -> Path:
    return cache.DATA / "models-incoming"


def promote(version: str, incoming: Path | None = None, models: Path | None = None) -> Path:
    src = (incoming or incoming_dir()) / version
    dst = (models or quantile.models_dir()) / version
    if not src.is_dir():
        raise FileNotFoundError(f"{src} does not exist")
    missing = quantile.incomplete(src)
    if missing:
        raise ValueError(f"{src} is incomplete, not promoting: {missing}")
    if dst.exists():
        raise FileExistsError(f"{dst} already exists")
    dst.parent.mkdir(parents=True, exist_ok=True)
    src.rename(dst)
    return dst


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Promote an uploaded model version into data/models.")
    ap.add_argument("version")
    ap.add_argument("--incoming", default=None, help="default data/models-incoming")
    ap.add_argument("--models", default=None, help="default data/models, or LG_MODELS_DIR")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        dst = promote(args.version, Path(args.incoming) if args.incoming else None, Path(args.models) if args.models else None)
    except (ValueError, FileNotFoundError, FileExistsError) as e:
        log.error("%s", e)
        return 1
    log.info("promoted to %s", dst)
    return 0


if __name__ == "__main__":
    sys.exit(main())
