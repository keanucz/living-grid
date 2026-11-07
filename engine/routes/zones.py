from fastapi import APIRouter

from engine import data
from engine.schemas import ZonesResponse
from pipeline import static

router = APIRouter(tags=["map"])


def build() -> dict:
    zg = static.bidding_zones()
    props = {f["properties"]["zone"]: f["properties"] for f in zg["features"]}
    geoms = static.zone_geometries()
    zones = []
    for z in data.ZONES:
        pt = geoms[z].representative_point() if z in geoms else None
        zones.append(
            {
                "zone": z,
                "name": props.get(z, {}).get("name", data.NAMES[z]),
                "currency": data.CURRENCY[z],
                "centroid": (round(pt.x, 3), round(pt.y, 3)) if pt else (0.0, 0.0),
                "approximate_border": bool(props.get(z, {}).get("approximate", False)),
            }
        )
    regions = [
        {
            "region": r.region,
            "name": r.name,
            "dno": r.dno,
            "carbon_intensity_region_id": int(r.carbon_intensity_region_id),
        }
        for r in static.gb_region_keys().itertuples()
    ]
    return {
        "zones": zones,
        "interconnectors": data.interconnectors(),
        "gb_regions": regions,
        "zones_geojson": zg,
        "gb_regions_geojson": static.gb_regions(),
    }


@router.get("/zones", response_model=ZonesResponse)
def zones() -> dict:
    return build()
