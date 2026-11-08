import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from engine import compute, data
from engine import datacentre as dc
from engine.app import app
from engine.schemas import DataCentreResponse
from pipeline import cache

client = TestClient(app)
NOW = pd.Timestamp("2026-11-07T12:00Z")
HOURS = pd.date_range("2026-10-01", "2026-11-07T11:00", freq="h", tz="UTC")


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    monkeypatch.delenv("LG_OFFLINE", raising=False)  # offline mode would merge committed fixtures into the synthetic prices
    monkeypatch.setattr(compute, "clock", lambda: NOW)
    data.actuals.cache_clear() if hasattr(data.actuals, "cache_clear") else None
    data._concat_actuals.cache_clear()


def price_of(ts):
    return 20.0 if 2 <= ts.hour < 6 else 80.0


def write(zone="FR", series="price_da", src="energycharts", fn=price_of):
    df = pd.DataFrame({"ts": HOURS, "zone": zone, "series": series, "value": [fn(t) for t in HOURS], "unit": "EUR/MWh"})
    cache.write(f"actuals/{src}_{series}_{zone}", df)
    cache.write("carbon/consumption_intensity", pd.DataFrame({"ts": HOURS, "zone": zone, "production_gco2_kwh": 100.0,
                                                              "consumption_gco2_kwh": 100.0, "imports_share": 0.1}))
    cache.write("markets/gas_carbon", pd.DataFrame({"ts": pd.date_range("2026-01-01", periods=300, tz="UTC"), "series": "eua",
                                                    "value": 70.0, "unit": "EUR/t", "source": "t"}))
    data._concat_actuals.cache_clear()


def test_gpu_power_comes_from_the_verified_facts():
    assert dc.gpu_kw("h100")[0] == pytest.approx(10.2 / 8) and dc.gpu_kw("b200")[0] == pytest.approx(14.3 / 8)
    assert dc.gpu_kw("consumer")[0] == pytest.approx(0.45) and dc.default_pue() == 1.5
    with pytest.raises(dc.BadRequest):
        dc.gpu_kw("tpu")


def test_flexible_load_fills_cheapest_hours_within_the_cap_and_keeps_energy():
    price = np.array([50.0, 10.0, 30.0, 90.0])
    load = dc.place_flexible(price, base_kw=100.0, flex=0.5, cap_kw=150.0)
    assert load.sum() == pytest.approx(400.0)
    assert load[1] == 150.0 and load[2] == 150.0 and load[0] == 50.0 and load[3] == 50.0
    assert dc.place_flexible(price, 100.0, 0.5, 100.0).tolist() == [100.0] * 4  # no headroom: nothing moves


def test_annual_energy_cost_and_flexible_saving_on_a_known_price_shape():
    write()
    body = dc.build(["FR"], gpus=800, gpu_type="h100", pue=1.5, utilisation=0.5, flexible_share=0.25, now=NOW)
    s = body["sites"][0]
    base_kw = 800 * 1.275 * 0.5 * 1.5
    assert s["facility_kw_avg"] == pytest.approx(base_kw) and s["annual_mwh"] == pytest.approx(base_kw * 8760 / 1000)
    mean_price = (4 * 20 + 20 * 80) / 24
    assert s["energy"]["mean_price_local_mwh"] == pytest.approx(mean_price)
    assert s["energy"]["cost_eur"] == pytest.approx(base_kw * 8760 / 1000 * mean_price)
    # utilisation 0.5 leaves 1.25 base-hours of spare in each cheap hour: 5 of the 6 flexible base-hours fit there, one spills to 80
    expect = base_kw * 8760 / 1000 * (0.75 * 1680 + 5 * 20 + 80) / 24
    assert s["energy"]["cost_flex_eur"] == pytest.approx(expect, rel=1e-6)
    assert s["energy"]["saving_flex_pct"] == pytest.approx(100 * (1680 - 1440) / 1680)
    assert s["carbon"]["tonnes"] == pytest.approx(base_kw * 8760 * 100 / 1e6) and s["carbon"]["cost_eur"] == pytest.approx(s["carbon"]["tonnes"] * 70)
    assert s["price_days"] == 37 and s["kind"] == "estimated"


def test_gb_uses_system_price_and_region_letters_map_to_gb():
    write("GB", "system_price", "elexon", lambda t: 100.0)
    s = dc.build(["N", "gb"], now=NOW)["sites"]
    assert [x["zone"] for x in s] == ["GB", "GB"] and s[0]["name"].startswith("South and Central Scotland") and s[0]["currency"] == "GBP"
    assert "system price" in s[0]["price_basis"].lower()
    assert s[0]["energy"]["cost_eur"] == pytest.approx(s[0]["energy"]["cost_local"] * 1.15)
    assert any(n["topic"] == "Scottish wind constraints" for n in s[0]["grid_notes"])
    assert not any(n["topic"] == "Scottish wind constraints" for n in s[1]["grid_notes"])
    assert any(n["topic"] == "Interconnector access" for n in s[1]["grid_notes"])


def write_gb_with_carbon():
    write("GB", "system_price", "elexon", lambda t: 100.0)
    cache.write("carbon/consumption_intensity", pd.DataFrame({"ts": HOURS, "zone": "GB", "production_gco2_kwh": 190.0,
                                                              "consumption_gco2_kwh": 190.0, "imports_share": 0.1}))


def write_regional(hours, values):
    rows = [{"ts": t, "region": r, "region_id": 0, "intensity_gco2_kwh": v, "index": "low"} for t in hours for r, v in values.items()]
    cache.write(dc.REGIONAL_CI, pd.DataFrame(rows))


def test_scottish_region_uses_its_own_carbon_and_says_prices_are_gb_wide():
    write_gb_with_carbon()
    write_regional(HOURS[-72:], {"N": 10.0, "C": 250.0})
    gb, n, c = dc.build(["GB", "N", "C"], flexible_share=0, now=NOW)["sites"]
    assert gb["carbon"]["intensity_g_kwh"] == pytest.approx(190.0)
    assert n["carbon"]["intensity_g_kwh"] == pytest.approx(10.0) and c["carbon"]["intensity_g_kwh"] == pytest.approx(250.0)
    assert n["carbon"]["tonnes"] == pytest.approx(gb["carbon"]["tonnes"] * 10 / 190)
    assert "Region N" in n["carbon"]["basis"] and "72 cached hours" in n["carbon"]["basis"] and "NESO" in n["carbon"]["basis"]
    assert gb["carbon"]["basis"] == "modelled consumption-based intensity"
    # one GB price: same cost everywhere, and the response says so
    assert n["energy"] == gb["energy"]
    assert n["price_basis"].startswith("GB-wide") and not gb["price_basis"].startswith("GB-wide")
    assert any(x["topic"] == "GB-wide prices" for x in n["grid_notes"])
    assert not any(x["topic"] == "GB-wide prices" for x in gb["grid_notes"])


def test_regional_carbon_outside_the_price_window_still_applies():
    write_gb_with_carbon()
    write_regional(pd.date_range(NOW + pd.Timedelta(hours=1), periods=24, freq="h"), {"N": 5.0})
    n = dc.build(["N"], now=NOW)["sites"][0]
    assert n["carbon"]["intensity_g_kwh"] == pytest.approx(5.0)


def test_region_without_regional_figures_falls_back_to_gb_and_says_so():
    write_gb_with_carbon()
    write_regional(HOURS[-24:], {"C": 250.0})
    n = dc.build(["N"], now=NOW)["sites"][0]
    assert n["carbon"]["intensity_g_kwh"] == pytest.approx(190.0)
    assert n["carbon"]["basis"].startswith("GB-wide") and "region N" in n["carbon"]["basis"]


def test_compare_three_sites_and_pick_the_cheapest():
    write("FR", fn=lambda t: 60.0)
    write("GB", "system_price", "elexon", lambda t: 40.0)
    cache.write("carbon/consumption_intensity", pd.DataFrame({"ts": HOURS.tolist() * 2, "zone": ["FR"] * len(HOURS) + ["GB"] * len(HOURS),
                                                              "production_gco2_kwh": 100.0, "consumption_gco2_kwh": 100.0, "imports_share": 0.1}))
    body = dc.build(["FR", "GB", "NL"], flexible_share=0, now=NOW)
    assert [s["location"] for s in body["sites"]] == ["FR", "GB", "NL"]
    assert body["sites"][2]["energy"] is None  # no prices cached for NL
    assert body["cheapest_site"] == "GB"


def test_endpoint_get_and_post_agree_and_validate():
    write()
    g = client.get("/datacentre?locations=FR&gpus=100&gpu_type=b200&pue=1.2&utilisation=0.8&flexible_share=0.1")
    assert g.status_code == 200, g.text
    DataCentreResponse.model_validate(g.json())
    p = client.post("/datacentre", json={"locations": ["FR"], "gpus": 100, "gpu_type": "b200", "pue": 1.2, "utilisation": 0.8, "flexible_share": 0.1})
    assert p.status_code == 200
    a, b = g.json(), p.json()
    assert a["sites"][0]["annual_mwh"] == pytest.approx(b["sites"][0]["annual_mwh"]) == pytest.approx(100 * 14.3 / 8 * 0.8 * 1.2 * 8760 / 1000)
    assert client.get("/datacentre?locations=A,B,C,D").status_code == 422
    assert client.get("/datacentre?locations=XX").status_code == 422
    assert client.get("/datacentre?locations=FR&gpu_type=tpu").status_code == 422
    assert client.get("/datacentre?locations=FR&utilisation=0").status_code == 422
    assert client.post("/datacentre", json={"locations": []}).status_code == 422


def test_no_data_still_answers_with_notes_and_no_costs():
    body = DataCentreResponse.model_validate(client.get("/datacentre?locations=NL").json())
    s = body.sites[0]
    assert s.energy is None and s.carbon is None and body.cheapest_site is None and s.grid_notes
    assert "not a quote" in body.note
