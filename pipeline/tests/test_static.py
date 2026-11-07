import os

import pytest

from pipeline import static

os.environ.setdefault("LG_OFFLINE", "1")


def test_six_valid_zones():
    geoms = static.zone_geometries()
    assert set(geoms) == set(static.V1_ZONES)
    for z, g in geoms.items():
        assert g.is_valid and not g.is_empty, z
        minx, miny, maxx, maxy = g.bounds
        assert -11 < minx and maxx < 16 and 41 < miny and maxy < 62, z


def test_no2_flagged_approximate():
    props = {f["properties"]["zone"]: f["properties"] for f in static.bidding_zones()["features"]}
    assert props["NO2"]["approximate"] is True


def test_interconnector_endpoints_known():
    ic = static.interconnectors()
    known = set(static.V1_ZONES) | set(static.EXTERNAL_ZONES)
    assert set(ic.from_zone) | set(ic.to_zone) <= known
    assert ic.elexon_code.is_unique and ic.id.is_unique
    assert (ic.capacity_mw > 0).all()
    inside = ic[ic.to_zone.isin(static.V1_ZONES)]
    assert (inside.to_in_v1).all() and not ic[~ic.to_zone.isin(static.V1_ZONES)].to_in_v1.any()
    assert {"INTFR", "INTNSL", "INTNED", "INTNEM"} <= set(ic.elexon_code)


def test_interconnector_geojson_matches_csv():
    feats = static.interconnector_lines()["features"]
    ic = static.interconnectors().set_index("id")
    assert {f["properties"]["id"] for f in feats} == set(ic.index)
    for f in feats:
        assert f["properties"]["capacity_mw"] == ic.loc[f["properties"]["id"], "capacity_mw"]


def test_fourteen_valid_gb_regions():
    geoms = static.region_geometries()
    keys = static.gb_region_keys()
    assert len(geoms) == len(keys) == 14
    assert set(geoms) == set(keys.region)
    assert keys.carbon_intensity_region_id.tolist().count(1) == 1
    assert sorted(keys.carbon_intensity_region_id) == list(range(1, 15))
    for r, g in geoms.items():
        assert g.is_valid and not g.is_empty, r
        minx, miny, maxx, maxy = g.bounds
        assert -9 < minx and maxx < 2.2 and 49.5 < miny and maxy < 61, r


def test_wind_farms_in_scotland_and_regions_known():
    wf = static.wind_farms()
    assert {"VKNGW", "SGRWO", "MOWWO"} <= set(wf.bm_unit)
    assert wf.bm_unit.is_unique
    assert set(wf.region) <= set(static.gb_region_keys().region)
    assert (wf.capacity_mw > 0).all()
    assert wf.lat.between(54.5, 61).all() and wf.lon.between(-8, 0).all()
