"""Loaders for the hand-made reference data in data/static/."""
import json
from functools import lru_cache
from pathlib import Path

import pandas as pd
from shapely.geometry import shape

STATIC_DIR = Path(__file__).resolve().parent.parent / "data" / "static"

V1_ZONES = ("GB", "FR", "DE-LU", "NL", "BE", "NO2")
EXTERNAL_ZONES = ("DK1", "SEM")


def _geojson(name: str) -> dict:
    return json.loads((STATIC_DIR / name).read_text())


@lru_cache(maxsize=None)
def bidding_zones() -> dict:
    return _geojson("bidding_zones.geojson")


@lru_cache(maxsize=None)
def gb_regions() -> dict:
    return _geojson("gb_regions.geojson")


@lru_cache(maxsize=None)
def interconnector_lines() -> dict:
    return _geojson("interconnectors.geojson")


def zone_geometries() -> dict:
    return {f["properties"]["zone"]: shape(f["geometry"]) for f in bidding_zones()["features"]}


def region_geometries() -> dict:
    return {f["properties"]["region"]: shape(f["geometry"]) for f in gb_regions()["features"]}


def interconnectors() -> pd.DataFrame:
    df = pd.read_csv(STATIC_DIR / "interconnectors.csv")
    df["to_in_v1"] = df["to_in_v1"].astype(bool)
    return df


def gb_region_keys() -> pd.DataFrame:
    return pd.read_csv(STATIC_DIR / "gb_region_keys.csv")


def wind_farms() -> pd.DataFrame:
    return pd.read_csv(STATIC_DIR / "wind_farms.csv")
