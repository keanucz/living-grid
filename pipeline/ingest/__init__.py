"""Autodiscovers pipeline/ingest/<source>.py modules that expose fetch(start, end)."""

import importlib
import pkgutil

import pandas as pd


def sources() -> dict:
    found = {}
    for m in pkgutil.iter_modules(__path__):
        mod = importlib.import_module(f"{__name__}.{m.name}")
        if callable(getattr(mod, "fetch", None)):
            found[m.name] = mod
    return found


def fetch(source: str, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    return sources()[source].fetch(start, end)
