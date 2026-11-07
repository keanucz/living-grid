"""Every module in this package exposing `router` is mounted by engine.app; add a module, not an import."""

import importlib
import pkgutil

from fastapi import APIRouter


def discover() -> list[APIRouter]:
    routers = []
    for info in sorted(pkgutil.iter_modules(__path__), key=lambda m: m.name):
        if info.name.startswith("_"):
            continue
        module = importlib.import_module(f"{__name__}.{info.name}")
        router = getattr(module, "router", None)
        if isinstance(router, APIRouter):
            routers.append(router)
    return routers
