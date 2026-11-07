import pandas as pd
import pytest

from pipeline import cache, carbon, emission_factors, schemas

T = pd.Timestamp("2026-11-06 12:00", tz="UTC")


def row(zone, series, value, ts=T):
    return {"ts": ts, "zone": zone, "series": series, "value": float(value), "unit": "MW"}


def frame(*rows):
    return pd.DataFrame(rows)


def one(df, zone, ts=T):
    return df[(df.zone == zone) & (df.ts == ts)].iloc[0]


def two_zone(flow_ab=500, flow_ba=-500):
    """FR: 1000 MW wind (12 g/kWh). DE-LU: 1000 MW gas (490 g/kWh). FR exports to DE-LU."""
    rows = [row("FR", "gen_wind", 1000), row("DE-LU", "gen_fossil_gas", 1000)]
    if flow_ab is not None:
        rows.append(row("FR", "flow_FR_DE-LU", flow_ab))
    if flow_ba is not None:
        rows.append(row("DE-LU", "flow_DE-LU_FR", flow_ba))
    return frame(*rows)


def test_two_zone_hand_checked_case():
    cons, contrib, _ = carbon.trace(two_zone())
    fr, de = one(cons, "FR"), one(cons, "DE-LU")
    assert de["production_gco2_kwh"] == pytest.approx(490)
    assert de["consumption_gco2_kwh"] == pytest.approx((490_000 + 500 * 12) / 1500)  # 330.67
    assert de["imports_share"] == pytest.approx(500 / 1500)
    c = contrib[contrib.zone == "DE-LU"].set_index("from_zone")
    assert c.loc["FR", "contribution_gco2_kwh"] == pytest.approx(500 * 12 / 1500)
    assert c.loc["DE-LU", "contribution_gco2_kwh"] == pytest.approx(490_000 / 1500)
    assert c.loc["FR", "basis"] == "traced" and c.loc["DE-LU", "basis"] == "local"
    assert fr["consumption_gco2_kwh"] == pytest.approx(12)


def test_zone_without_imports_has_consumption_equal_to_production():
    cons, _, _ = carbon.trace(two_zone())
    fr = one(cons, "FR")
    assert fr["imports_share"] == 0
    assert fr["consumption_gco2_kwh"] == pytest.approx(fr["production_gco2_kwh"])


def test_no_flows_means_consumption_equals_production_everywhere():
    cons, _, _ = carbon.trace(two_zone(None, None))
    assert cons["consumption_gco2_kwh"].to_numpy() == pytest.approx(cons["production_gco2_kwh"].to_numpy())
    assert (cons["imports_share"] == 0).all()


def test_two_reporting_sides_are_averaged_and_either_side_alone_works():
    both = carbon.trace(two_zone(500, -450))[0]
    assert one(both, "DE-LU")["imports_share"] == pytest.approx(475 / 1475)
    one_side = carbon.trace(two_zone(None, -500))[0]
    assert one(one_side, "DE-LU")["imports_share"] == pytest.approx(500 / 1500)


def test_flow_direction_follows_sign():
    cons, _, _ = carbon.trace(two_zone(-500, 500))  # DE-LU exports to FR
    assert one(cons, "FR")["imports_share"] == pytest.approx(500 / 1500)
    assert one(cons, "DE-LU")["imports_share"] == 0
    assert one(cons, "FR")["consumption_gco2_kwh"] == pytest.approx((12_000 + 500 * 490) / 1500)


def test_looping_flows_conserve_emissions():
    gens = [("FR", "gen_nuclear", 3000), ("BE", "gen_gas", 800), ("NL", "gen_fossil_hard_coal", 600), ("NL", "gen_wind_offshore", 400)]
    rows = [row(z, s, v) for z, s, v in gens]
    rows += [row("FR", "flow_FR_BE", 700), row("BE", "flow_BE_NL", 500), row("NL", "flow_NL_FR", 200)]
    cons, contrib, _ = carbon.trace(frame(*rows))
    P = {"FR": 3000, "BE": 800, "NL": 1000}
    E = {"FR": 3000 * 12, "BE": 800 * 490, "NL": 600 * 820 + 400 * 12}
    imports = {"FR": 200, "BE": 700, "NL": 500}
    exports = {"FR": 700, "BE": 500, "NL": 200}
    consumed_emissions = sum(
        one(cons, z)["consumption_gco2_kwh"] * (P[z] + imports[z] - exports[z]) for z in P
    )
    assert consumed_emissions == pytest.approx(sum(E.values()))
    for z in P:
        total = contrib[contrib.zone == z]["contribution_gco2_kwh"].sum()
        assert total == pytest.approx(one(cons, z)["consumption_gco2_kwh"])


def test_untraced_partner_uses_placeholder_intensity_and_is_marked_estimated():
    rows = [row("BE", "gen_nuclear", 1000), row("BE", "flow_DK_BE", 250)]
    cons, contrib, _ = carbon.trace(frame(*rows))
    want = (1000 * 12 + 250 * emission_factors.EXTERNAL_INTENSITY["DK"]) / 1250
    assert one(cons, "BE")["consumption_gco2_kwh"] == pytest.approx(want)
    assert contrib[contrib.from_zone == "DK"].iloc[0]["basis"] == "estimated"


def test_zone_without_generation_is_left_out_and_neighbours_use_its_placeholder():
    rows = [row("NL", "gen_wind_onshore", 1000), row("NL", "flow_BE_NL", 200)]
    cons, _, _ = carbon.trace(frame(*rows))
    assert set(cons["zone"]) == {"NL"}
    want = (1000 * 11 + 200 * emission_factors.EXTERNAL_INTENSITY["BE"]) / 1200
    assert one(cons, "NL")["consumption_gco2_kwh"] == pytest.approx(want)


def test_ignores_consumption_series_net_flows_and_reports_unrecognised_fuels():
    rows = [
        row("FR", "gen_nuclear", 1000),
        row("FR", "gen_hydro_pumped_storage_consumption", 900),
        row("FR", "flow_net_FR", -300),
        row("FR", "gen_mystery_fuel", 100),
        row("FR", "gen_hydro_pumped_storage", 100),
    ]
    cons, _, unmapped = carbon.trace(frame(*rows))
    assert unmapped == {"gen_mystery_fuel"}
    want = (1000 * 12 + 100 * emission_factors.FACTORS["other"] + 0) / 1200
    assert one(cons, "FR")["production_gco2_kwh"] == pytest.approx(want)


def test_hours_are_independent():
    t2 = T + pd.Timedelta(hours=1)
    a, b = two_zone(500, -500), two_zone(0, 0)
    b["ts"] = t2
    cons, _, _ = carbon.trace(pd.concat([a, b]))
    assert one(cons, "DE-LU", T)["imports_share"] > 0 and one(cons, "DE-LU", t2)["imports_share"] == 0


def test_output_matches_the_shared_contract():
    cons, _, _ = carbon.trace(two_zone())
    schemas.validate(cons, "carbon/consumption_intensity")
    assert list(cons.columns) == schemas.CARBON.names


def test_gb_style_generation_names_are_recognised():
    for s in ("gen_wind", "gen_gas", "gen_nuclear", "gen_biomass", "gen_coal", "gen_oil", "gen_hydro", "gen_pumped_storage", "gen_other"):
        ok = emission_factors.classify(s)[1]
        assert ok or s == "gen_other"
    assert emission_factors.classify("gen_fossil_brown_coal_lignite")[0] == "lignite"
    assert emission_factors.classify("load") is None


def test_no_data_gives_empty_frames():
    cons, contrib, unmapped = carbon.trace(pd.DataFrame(columns=schemas.ACTUALS.names))
    assert cons.empty and contrib.empty and not unmapped
    assert list(cons.columns) == schemas.CARBON.names


def test_run_writes_files_from_cached_actuals(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    df = two_zone()
    cache.write("actuals/energy_charts_generation", df[df.series.str.startswith("gen_")])
    cache.write("actuals/energy_charts_flows", df[df.series.str.startswith("flow_")])
    counts = carbon.run()
    assert counts[carbon.CONSUMPTION] == 2
    schemas.validate(cache.read("carbon/consumption_intensity"), "carbon/consumption_intensity")
    assert set(cache.read("carbon/import_contributions")["basis"]) == {"local", "traced"}


def test_runs_on_fixtures_when_nothing_is_cached(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    carbon.run()
    schemas.validate(cache.read("carbon/consumption_intensity"), "carbon/consumption_intensity")


def test_since_traces_only_recent_hours_and_merges(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DATA", tmp_path)
    t2 = T + pd.Timedelta(hours=1)
    later = two_zone()
    later["ts"] = t2
    df = pd.concat([two_zone(), later])
    cache.write("actuals/energy_charts_generation", df[df.series.str.startswith("gen_")])
    cache.write("actuals/energy_charts_flows", df[df.series.str.startswith("flow_")])
    carbon.run()
    assert carbon.run(since=t2)[carbon.CONSUMPTION] == 2
    out = cache.read("carbon/consumption_intensity")
    assert len(out) == 4 and set(out["ts"]) == {T, t2}
