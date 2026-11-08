"""The replay days on disk: data/replay/YYYY-MM-DD.json only, never sidecars such as YYYY-MM-DD.bots.json."""

import re
from datetime import date
from pathlib import Path

DAY_FILE = re.compile(r"^\d{4}-\d{2}-\d{2}\.json$")


def list_days(folder: Path) -> list[date]:
    if not folder.is_dir():
        return []
    return sorted(date.fromisoformat(p.name[:10]) for p in folder.iterdir() if DAY_FILE.match(p.name))
