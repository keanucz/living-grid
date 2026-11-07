import re
import subprocess
from pathlib import Path

import pytest

from engine.ghost_wind import weather_gap as wg
from engine.interventions import passthrough as pt
from engine.reference import loader
from pipeline import static

ROOT = Path(__file__).resolve().parents[2]


def test_numbers_parse_prose():
    assert loader.numbers("1,075MW; units T_SGRWO-1 and 0.334 t (about 58%)") == [1075, 1, 0.334, 58]
    assert loader.numbers("€339.20/MWh") == [339.2]


def test_unverified_fact_raises():
    unverified = next(f for f in loader._all().values() if f.get("verified") is not True)
    with pytest.raises(loader.UnverifiedFact):
        loader.figure(unverified["id"])
    with pytest.raises(KeyError):
        loader.fact("no_such_fact")


def test_figure_by_label_and_index():
    assert loader.figure("wind_power_curve", after="CUT-OUT") == 25
    assert loader.figure("gas_gb_marginal_share", index=1) == 60
    with pytest.raises(ValueError):
        loader.figure("wind_power_curve", after="no such label")


def test_engine_constants_come_from_verified_facts():
    assert pt.CCGT_EFFICIENCY == pytest.approx(0.58)
    assert pt.CCGT_CO2_T_PER_MWH == pytest.approx(0.334)
    assert pt.TTF_2022_PEAK_EUR_MWH == pytest.approx(339.2)
    assert pt.GB_GAS_MARGINAL_SHARE == pytest.approx(0.60)
    assert (wg.CUT_IN_MS, wg.RATED_MS, wg.CUT_OUT_MS) == (3, 12, 25)
    assert wg.SHEAR_ALPHA == pytest.approx(0.11)


def test_no_todo_67_left_in_engine():
    out = subprocess.run(["grep", "-rn", "TODO(#67)", "--include=*.py", "engine"], cwd=ROOT,
                         capture_output=True, text=True)
    assert [l for l in out.stdout.splitlines() if "test_reference_loader" not in l] == []


def test_wind_farm_mapping_matches_verified_facts():
    farms = static.wind_farms().set_index("bm_unit")
    checked = 0
    for f in loader._all().values():
        if not (f["id"].startswith("wind_") and f["id"].endswith("_capacity") and f.get("verified")):
            continue
        stems = set(re.findall(r"T_([A-Z0-9]+)-\d", f["value"]))
        mapped = stems & set(farms.index)
        assert mapped, f"{f['id']}: none of {sorted(stems)} is in wind_farms.csv"
        capacity = loader.figure(f["id"])
        assert farms.loc[sorted(mapped), "capacity_mw"].sum() == pytest.approx(capacity, rel=0.01), f["id"]
        checked += 1
    assert checked >= 5


def test_interconnector_capacities_match_verified_facts():
    links = static.interconnectors().set_index("id")
    for link_id, fact_id in [("ifa", "ic_ifa_capacity"), ("ifa2", "ic_ifa2_capacity"), ("eleclink", "ic_eleclink_capacity"),
                             ("britned", "ic_britned_capacity"), ("nemo", "ic_nemo_capacity"),
                             ("nsl", "ic_nsl_capacity"), ("viking", "ic_viking_capacity")]:
        if link_id in links.index:
            assert links.loc[link_id, "capacity_mw"] == loader.figure(fact_id), link_id


def test_source_note_names_hosts():
    note = loader.source_note("gas_hormuz_lng_share", "gas_ttf_2022_peak")
    assert note and "http" not in note
