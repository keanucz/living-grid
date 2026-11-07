"""World events. A module named after an InterventionType that defines `run(req, features=None)` is registered."""

import importlib
import pkgutil
from typing import get_args

from engine.schemas import InterventionType

TYPES = set(get_args(InterventionType))


def registry() -> dict:
    out = {}
    for info in pkgutil.iter_modules(__path__):
        if info.name in TYPES:
            module = importlib.import_module(f"{__name__}.{info.name}")
            if callable(getattr(module, "run", None)):
                out[info.name] = module.run
    return out
