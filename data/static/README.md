Hand-made reference data (zones, interconnectors, GB regions, wind farms). Tracked in git; everything else under data/ is a cache.

Provenance (public sources only):
- bidding_zones.geojson: Natural Earth 1:50m admin-0 (public domain), simplified. GB, FR, DE-LU (Germany plus Luxembourg), NL, BE are whole countries; FR and NL exclude overseas territories. NO2 is a rough clip of southern Norway, not the official bidding-zone border.
- gb_regions.geojson, gb_region_keys.csv: NESO "GIS Boundaries for GB DNO Licence Areas" 20240503 (NESO Open Data Licence, "Supported by National Energy SO Open Data"), reprojected from EPSG:27700 and simplified. Region letters are the Octopus Agile region codes; carbon_intensity_region_id is the Carbon Intensity API region id; mpan_distributor_id is NESO's ID.
- interconnectors.csv: hand-made. Nominal capacities and approximate landing points. Rows with to_in_v1=false end outside the v1 zones.
- wind_farms.csv: hand-mapped, approximate capacities and locations; the BM unit stems must be confirmed against Elexon reference data before use in ghost wind.
