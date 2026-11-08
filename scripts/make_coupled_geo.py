"""One-off: approximate bidding-zone shapes for the "Coupled market" map layer (#347).

Clips the country shapes in web/public/geo/europe.json by latitude and longitude. The borders are rough boxes,
not the official zone borders; every feature is marked approximate. NO2 is not drawn here: it is already a
zone of its own in europe.json (#343), so the rest of Norway is split around it.

    uv run python scripts/make_coupled_geo.py
"""

import json
from pathlib import Path

from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "web/public/geo/europe.json"
OUT = ROOT / "web/public/geo/coupled.json"

W, E, S, N = -40.0, 60.0, 30.0, 75.0


def band(lat0=S, lat1=N, lon0=W, lon1=E):
    return box(lon0, lat0, lon1, lat1)


# (zone, country, area within the country)
SPLITS = [
    ("SE1", "Sweden", band(65.5)),
    ("SE2", "Sweden", band(61.5, 65.5)),
    ("SE3", "Sweden", band(57.5, 61.5)),
    ("SE4", "Sweden", band(lat1=57.5)),
    ("DK1", "Denmark", band(lon1=11.0)),
    ("DK2", "Denmark", band(lon0=11.0)),
    ("NO5", "Norway", band(lat1=62.0, lon1=8.0)),
    ("NO1", "Norway", band(lat1=62.0, lon0=8.0)),
    ("NO3", "Norway", band(62.0, 65.0)),
    ("NO4", "Norway", band(65.0, 72.0)),
    ("FI", "Finland", band()),
    ("FI", "Åland", band()),
    ("EE", "Estonia", band()),
    ("LV", "Latvia", band()),
    ("LT", "Lithuania", band()),
    ("AT", "Austria", band()),
    ("PL", "Poland", band()),
]
# Label points moved by hand where the automatic ones collide at the overview zoom (Norway's narrow middle,
# Norway east under the S. Norway label, Sweden's middle bands).
LABEL_AT = {"NO1": [11.4, 61.4], "NO3": [9.6, 63.0], "SE2": [16.4, 63.9], "SE3": [15.3, 59.3]}


def main():
    feats = json.loads(SRC.read_text())["features"]
    by_name = {}
    for f in feats:
        by_name.setdefault(f["properties"]["name"], []).append(shape(f["geometry"]))
    no2 = unary_union([shape(f["geometry"]) for f in feats if f["properties"].get("zone") == "NO2"])
    parts = {}
    for zone, country, area in SPLITS:
        g = unary_union(by_name[country]).intersection(area)
        if country == "Norway":
            # NO2 is clipped from a different simplification of the coast: drop its whole box, not only its polygon,
            # or slivers of coast inside the box are left behind.
            lon0, lat0, lon1, lat1 = no2.bounds
            g = g.difference(no2.buffer(0.001)).difference(band(S, lat1, W, lon1))
        parts.setdefault(zone, []).append(g)
    out = []
    for zone, gs in parts.items():
        g = unary_union(gs).simplify(0.01, preserve_topology=True)
        g = unary_union([p for p in getattr(g, "geoms", [g]) if p.geom_type == "Polygon" and p.area > 0.005])
        # Label on the biggest piece, so Denmark's and Norway's islands do not pull it out to sea.
        big = max(getattr(g, "geoms", [g]), key=lambda p: p.area)
        at = big.representative_point()
        geom = mapping(g)
        if geom["type"] == "Polygon":
            geom = {"type": "MultiPolygon", "coordinates": [geom["coordinates"]]}
        out.append({
            "type": "Feature",
            "properties": {"zone": zone, "approximate": True, "label_at": LABEL_AT.get(zone, [round(at.x, 2), round(at.y, 2)])},
            "geometry": json.loads(json.dumps(geom), parse_float=lambda s: round(float(s), 3)),
        })
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": out}, separators=(",", ":")))
    print(OUT, len(out), "zones", OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
