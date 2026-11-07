"""Standard emission factors, gCO2eq/kWh, for tracing carbon through generation and imports.

These are STANDARD ESTIMATES, not measurements, and must be labelled as such on screen. Basis: lifecycle
medians from the IPCC Fifth Assessment Report (2014, WGIII Annex III), the set Electricity Maps also uses by
default: coal 820, gas 490, biomass 230, geothermal 38, hydro 24, nuclear 12, wind onshore 11 and offshore
12, utility solar PV 48. Looser estimates, not IPCC medians: oil 720 (Our World in Data average), lignite
1100 (IPCC has a single coal figure; lignite runs about 1000 to 1200), waste 500, and 650 for anything
unrecognised (about the mean of the thermal factors). Stored-energy generation (pumped storage, batteries)
is counted as 0: where the stored energy came from is not traced.
"""

import re

FACTORS = {
    "coal": 820.0,
    "lignite": 1100.0,
    "gas": 490.0,
    "oil": 720.0,
    "biomass": 230.0,
    "geothermal": 38.0,
    "hydro": 24.0,
    "nuclear": 12.0,
    "wind_onshore": 11.0,
    "wind_offshore": 12.0,
    "wind": 12.0,
    "solar": 48.0,
    "waste": 500.0,
    "storage": 0.0,
    "other": 650.0,
}

# Zones outside the six traced: rough annual-average lifecycle intensities, placeholders used only for
# imports from them (and for a v1 zone with no generation data that hour). Replace with traced values if
# those zones are ever added.
EXTERNAL_INTENSITY = {
    "GB": 200.0,
    "FR": 60.0,
    "DE-LU": 380.0,
    "NL": 330.0,
    "BE": 170.0,
    "NO2": 25.0,
    "DK": 150.0,
    "SE": 30.0,
    "FI": 90.0,
    "CH": 40.0,
    "IT": 330.0,
    "ES": 160.0,
    "AT": 110.0,
    "PL": 700.0,
    "CZ": 450.0,
    "IE": 380.0,
}
EXTERNAL_DEFAULT = 400.0
ALIASES = {"DK1": "DK", "NI": "IE", "SEM": "IE"}

_NOT_GENERATION = re.compile(r"consumption|share|residual|load")
_RULES = [
    ("storage", re.compile(r"pumped|battery|storage")),
    ("other", re.compile(r"coal_derived_gas")),
    ("lignite", re.compile(r"lignite|brown")),
    ("coal", re.compile(r"coal")),
    ("gas", re.compile(r"gas")),
    ("oil", re.compile(r"oil")),
    ("wind_offshore", re.compile(r"wind_offshore")),
    ("wind_onshore", re.compile(r"wind_onshore")),
    ("wind", re.compile(r"wind")),
    ("solar", re.compile(r"solar")),
    ("nuclear", re.compile(r"nuclear")),
    ("biomass", re.compile(r"biomass")),
    ("geothermal", re.compile(r"geothermal")),
    ("hydro", re.compile(r"hydro")),
    ("waste", re.compile(r"waste")),
]


def classify(series: str) -> tuple[str, bool] | None:
    """(factor key, recognised) for a gen_<fuel> series; None if it is not generation."""
    name = series.removeprefix("gen_").lower()
    if not series.startswith("gen_") or _NOT_GENERATION.search(name):
        return None
    for key, pattern in _RULES:
        if pattern.search(name):
            return key, True
    return "other", False


def external_intensity(zone: str) -> float:
    zone = ALIASES.get(zone, zone)
    return EXTERNAL_INTENSITY.get(zone, EXTERNAL_DEFAULT)
