"""Write engine/contract/fixtures/*.json: plausible, deterministic sample responses for every route.

Run with `uv run python -m engine.contract.make_fixtures`. Every fixture is validated through its
schema before writing. Numbers are illustrative only, not data.
"""

import csv
import json
import math
import random
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from engine import schemas as s

ROOT = Path(__file__).resolve().parents[2]
STATIC = ROOT / "data" / "static"
OUT = Path(__file__).resolve().parent / "fixtures"

NOW = datetime(2026, 11, 7, 12, tzinfo=timezone.utc)
ZONES = ["GB", "FR", "DE-LU", "NL", "BE", "NO2"]
NAMES = {
    "GB": "Great Britain",
    "FR": "France",
    "DE-LU": "Germany and Luxembourg",
    "NL": "Netherlands",
    "BE": "Belgium",
    "NO2": "Southern Norway",
}
CENTROIDS = {
    "GB": (-2.0, 53.5),
    "FR": (2.5, 46.6),
    "DE-LU": (10.3, 51.1),
    "NL": (5.3, 52.2),
    "BE": (4.6, 50.6),
    "NO2": (7.5, 59.0),
}
CURRENCY = {z: "GBP" if z == "GB" else "EUR" for z in ZONES}
BASE_PRICE = {"GB": 82.0, "FR": 74.0, "DE-LU": 96.0, "NL": 93.0, "BE": 88.0, "NO2": 48.0}
EUR_PER_GBP = 1.15
CONTINENTAL_LINKS = [
    ("fr-be", "France to Belgium", "FR", "BE", 3400, (3.2, 50.4), (4.2, 50.7)),
    ("fr-de", "France to Germany", "FR", "DE-LU", 3000, (6.9, 48.6), (8.2, 49.0)),
    ("be-nl", "Belgium to Netherlands", "BE", "NL", 3400, (4.5, 51.0), (5.0, 51.6)),
    ("nl-de", "Netherlands to Germany", "NL", "DE-LU", 5000, (6.0, 52.0), (7.3, 52.2)),
    ("be-de", "ALEGrO", "BE", "DE-LU", 1000, (6.0, 50.6), (6.4, 50.8)),
    ("nl-no2", "NorNed", "NL", "NO2", 700, (6.8, 53.4), (6.8, 58.2)),
    ("de-no2", "NordLink", "DE-LU", "NO2", 1400, (9.3, 54.0), (7.0, 58.3)),
]

rng = random.Random(7)


def iso(t: datetime) -> str:
    return t.isoformat().replace("+00:00", "Z")


def hours(start: datetime, n: int) -> list[datetime]:
    return [start + timedelta(hours=i) for i in range(n)]


def daily_shape(t: datetime) -> float:
    h = t.hour + 0.0
    return 1 + 0.25 * math.exp(-((h - 17.5) ** 2) / 6) + 0.1 * math.exp(-((h - 8) ** 2) / 4) - 0.15 * math.exp(
        -((h - 3) ** 2) / 8
    )


def price(zone: str, t: datetime) -> float:
    return round(BASE_PRICE[zone] * daily_shape(t) + rng.uniform(-4, 4), 2)


def band(p50: float, horizon: int) -> dict:
    w = 4 + 0.9 * horizon
    return {"p10": round(p50 - w, 2), "p50": round(p50, 2), "p90": round(p50 + w * 1.2, 2)}


def unit(zone: str) -> str:
    return f"{CURRENCY[zone]}/MWh"


def zones() -> dict:
    links = []
    with open(STATIC / "interconnectors.csv") as f:
        for r in csv.DictReader(f):
            links.append(
                {
                    "id": r["id"],
                    "name": r["name"],
                    "from_zone": r["from_zone"],
                    "to_zone": r["to_zone"],
                    "capacity_mw": float(r["capacity_mw"]),
                    "from_coord": [float(r["gb_lon"]), float(r["gb_lat"])],
                    "to_coord": [float(r["far_lon"]), float(r["far_lat"])],
                    "in_v1": r["to_in_v1"] == "true",
                }
            )
    for id_, name, a, b, cap, ca, cb in CONTINENTAL_LINKS:
        links.append(
            {
                "id": id_,
                "name": name,
                "from_zone": a,
                "to_zone": b,
                "capacity_mw": cap,
                "from_coord": list(ca),
                "to_coord": list(cb),
                "in_v1": True,
            }
        )
    with open(STATIC / "gb_region_keys.csv") as f:
        regions = [
            {
                "region": r["region"],
                "name": r["name"],
                "dno": r["dno"],
                "carbon_intensity_region_id": int(r["carbon_intensity_region_id"]),
            }
            for r in csv.DictReader(f)
        ]
    zg = json.loads((STATIC / "bidding_zones.geojson").read_text())
    approx = {f["properties"]["zone"]: bool(f["properties"].get("approximate")) for f in zg["features"]}
    return {
        "zones": [
            {
                "zone": z,
                "name": NAMES[z],
                "currency": CURRENCY[z],
                "centroid": list(CENTROIDS[z]),
                "approximate_border": approx.get(z, False),
            }
            for z in ZONES
        ],
        "interconnectors": links,
        "gb_regions": regions,
        "zones_geojson": zg,
        "gb_regions_geojson": json.loads((STATIC / "gb_regions.geojson").read_text()),
    }


MIX = {
    "GB": {"wind": 9800, "gas": 11200, "nuclear": 4100, "biomass": 1900, "solar": 1400, "hydro": 300},
    "FR": {"nuclear": 41000, "hydro": 7200, "wind": 5200, "gas": 3100, "solar": 2800},
    "DE-LU": {"wind": 14800, "solar": 6200, "lignite": 9100, "hard_coal": 3800, "gas": 6900, "biomass": 4300},
    "NL": {"wind": 4100, "gas": 5200, "solar": 900, "hard_coal": 1100},
    "BE": {"nuclear": 3900, "gas": 2900, "wind": 1600, "solar": 500},
    "NO2": {"hydro": 6100, "wind": 300},
}
CARBON = {
    "GB": (182, 171, 0.14),
    "FR": (38, 52, 0.06),
    "DE-LU": (392, 371, 0.11),
    "NL": (318, 302, 0.18),
    "BE": (154, 168, 0.21),
    "NO2": (12, 41, 0.09),
}
FLOWS = {
    "ifa": 1650,
    "ifa2": 880,
    "eleclink": 940,
    "britned": -420,
    "nemo": 310,
    "nsl": -1320,
    "viking": -900,
    "greenlink": 240,
    "ewic": 310,
    "moyle": 120,
    "fr-be": 2100,
    "fr-de": 1800,
    "be-nl": -600,
    "nl-de": -1400,
    "be-de": 300,
    "nl-no2": -650,
    "de-no2": -1100,
}


def state(z: dict) -> dict:
    out = []
    for zone in ZONES:
        p = price(zone, NOW)
        pd, pc, share = CARBON[zone]
        out.append(
            {
                "zone": zone,
                "price": {
                    "value": p,
                    "unit": unit(zone),
                    "kind": "actual",
                    "source": "elexon" if zone == "GB" else "energy-charts",
                },
                "forecast": {
                    **band(p + rng.uniform(-3, 3), 1),
                    "made_at": iso(NOW - timedelta(hours=1)),
                    "horizon_h": 1,
                    "target": "gb_system_price" if zone == "GB" else "price_da",
                    "kind": "forecast",
                },
                "carbon": {
                    "production_gco2_kwh": pd,
                    "consumption_gco2_kwh": pc,
                    "imports_share": share,
                    "kind": "modelled",
                },
                "load_mw": float(sum(MIX[zone].values())),
                "mix_mw": {k: float(v) for k, v in MIX[zone].items()},
            }
        )
    flows = [
        {
            "interconnector_id": i["id"],
            "from_zone": i["from_zone"],
            "to_zone": i["to_zone"],
            "mw": float(FLOWS[i["id"]]),
            "capacity_mw": i["capacity_mw"],
            "kind": "actual",
        }
        for i in z["interconnectors"]
    ]
    return {"at": iso(NOW), "zones": out, "flows": flows}


def explanation(sentence: str, contribs: dict) -> dict:
    return {
        "sentence": sentence,
        "contributions": [{"group": g, "value": v} for g, v in contribs.items()],
        "kind": "forecast",
    }


def explain() -> dict:
    contribs = {"wind": 12.0, "imports": 5.0, "demand": 2.5, "gas": 1.0, "solar": -0.5, "carbon": 0.0, "time_of_day": -2.0}
    return {
        **explanation("GB price up £18: wind down 40% (+£12), less from Norway (+£5)", contribs),
        "zone": "GB",
        "ts": iso(NOW + timedelta(hours=6)),
        "target": "gb_system_price",
        "base": 78.0,
        "prediction": 96.0,
        "delta": 18.0,
        "unit": "GBP/MWh",
    }


GW_REGIONS = [
    ("N", "South and Central Scotland", (-3.9, 55.7), 0.35),
    ("P", "North Scotland", (-4.3, 57.6), 1.0),
]


def ghost_wind() -> dict:
    start = NOW - timedelta(hours=24)
    regions = []
    for code, name, c, scale in GW_REGIONS:
        series = []
        for t in hours(start, 24):
            wind = 0.5 + 0.5 * math.sin((t.hour - 4) / 24 * 2 * math.pi)
            b = round(scale * 1400 * wind + rng.uniform(0, 80), 1)
            series.append({"ts": iso(t), "boalf_mw": b, "weather_gap_mw": round(b * rng.uniform(1.05, 1.35), 1)})
        regions.append(
            {
                "region": code,
                "name": name,
                "centroid": list(c),
                "boalf_mwh": round(sum(p["boalf_mw"] for p in series), 1),
                "weather_gap_mwh": round(sum(p["weather_gap_mw"] for p in series), 1),
                "series": series,
                "kind": "estimated",
            }
        )
    costs = [
        {"date": (NOW.date() - timedelta(days=d)).isoformat(), "gbp": round(rng.uniform(2e6, 9e6), -3), "kind": "actual"}
        for d in range(13, 6, -1)
    ]
    boundaries = []
    for name, limit in [("B6", 6800), ("B4", 4100), ("B7a", 8200)]:
        for t in hours(NOW, 6):
            boundaries.append(
                {"boundary": name, "ts": iso(t), "flow_mw": round(limit * rng.uniform(0.82, 1.0)), "limit_mw": limit, "kind": "forecast"}
            )
    return {
        "from": iso(start),
        "to": iso(NOW),
        "regions": regions,
        "total_boalf_mwh": round(sum(r["boalf_mwh"] for r in regions), 1),
        "total_weather_gap_mwh": round(sum(r["weather_gap_mwh"] for r in regions), 1),
        "constraint_costs": costs,
        "constraint_cost_total_gbp": sum(c["gbp"] for c in costs),
        "boundary_flows": boundaries,
        "note": "Two estimates of wind paid to switch off: accepted bids (BOALF) for mapped units, and weather-implied "
        "output minus metered output. Constraint costs from NESO run about a week behind; boundary flows are day-ahead forecasts.",
    }


def carbon(st: dict) -> dict:
    out = []
    for zs in st["zones"]:
        zone = zs["zone"]
        imports = []
        for f in st["flows"]:
            if f["to_zone"] == zone and f["mw"] > 0:
                src, mw = f["from_zone"], f["mw"]
            elif f["from_zone"] == zone and f["mw"] < 0:
                src, mw = f["to_zone"], -f["mw"]
            else:
                continue
            ci = CARBON[src][0] if src in CARBON else 300.0
            imports.append(
                {
                    "from_zone": src,
                    "mw": mw,
                    "exporter_gco2_kwh": ci,
                    "contribution_gco2_kwh": round(ci * mw / zs["load_mw"], 1),
                }
            )
        c = zs["carbon"]
        out.append({**{k: c[k] for k in ("production_gco2_kwh", "consumption_gco2_kwh", "imports_share")}, "zone": zone, "imports": imports, "kind": "modelled"})
    return {"at": st["at"], "zones": out, "note": "Emission factors are standard estimates; consumption intensity is modelled."}


SCENARIOS = [
    ("hormuz", "Strait of Hormuz closes", "LNG supply shock lifts gas prices; gas-fired plants set the price in most hours.", "hormuz", None, 40.0, 336, {"GB": 21, "FR": 9, "DE-LU": 17, "NL": 19, "BE": 16, "NO2": 6}),
    ("norway_link", "Norway to GB link trips", "North Sea Link goes offline; GB loses about 1.3 GW of cheap hydro.", "interconnector_trip", "nsl", 1320.0, 24, {"GB": 11, "FR": 1, "DE-LU": 0.5, "NL": 0.8, "BE": 0.6, "NO2": -4}),
    ("french_nuclear", "French nuclear outage", "Several reactors trip; France imports more and neighbours' prices rise.", "nuclear_outage", "FR", 6000.0, 72, {"GB": 6, "FR": 28, "DE-LU": 7, "NL": 5, "BE": 12, "NO2": 1}),
    ("scottish_storm", "Storm over Scotland", "Much more wind in Scotland; prices fall but more wind is paid to switch off.", "scottish_storm", "GB", 50.0, 24, {"GB": -14, "FR": -2, "DE-LU": -1, "NL": -1.5, "BE": -1.5, "NO2": -1}),
]
TWH_DEMAND = {"GB": 30000, "FR": 52000, "DE-LU": 55000, "NL": 13000, "BE": 10000, "NO2": 6500}


def result(key, title, typ, target, mag, hrs, deltas) -> dict:
    zones_out, total = [], 0.0
    shown = min(hrs, 24)
    for zone in ZONES:
        d = deltas[zone]
        hourly = []
        for t in hours(NOW, shown):
            m = round(d * daily_shape(t), 2)
            spread = abs(d) * 0.35 + 1
            hourly.append({"ts": iso(t), "delta_p10": round(m - spread, 2), "delta_p50": m, "delta_p90": round(m + spread, 2)})
        cost = round(d * TWH_DEMAND[zone] * hrs, -3)
        cost_gbp = cost if zone == "GB" else round(cost / EUR_PER_GBP, -3)
        total += cost_gbp
        zones_out.append({"zone": zone, "currency": CURRENCY[zone], "avg_delta": d, "cost": cost, "cost_gbp": cost_gbp, "hourly": hourly})
    up = sorted([z for z in zones_out if z["cost_gbp"] > 0], key=lambda z: -z["cost_gbp"])
    winners = [{"who": "Gas-free generators (wind, nuclear, hydro)", "gbp": round(total * 0.6, -3)}] if total > 0 else [
        {"who": f"Consumers in {NAMES[z['zone']]}", "gbp": round(-z["cost_gbp"], -3)} for z in zones_out if z["cost_gbp"] < 0
    ]
    losers = [{"who": f"Consumers in {NAMES[z['zone']]}", "gbp": -z["cost_gbp"]} for z in up[:3]]
    contribs = {"gas": 0.0, "carbon": 0.0, "imports": 0.0, "wind": 0.0, "demand": 0.0, "solar": 0.0, "time_of_day": 0.0}
    main = {"hormuz": "gas", "interconnector_trip": "imports", "nuclear_outage": "demand", "scottish_storm": "wind"}[typ]
    contribs[main] = deltas["GB"]
    sign = "up" if deltas["GB"] >= 0 else "down"
    sentence = f"GB price {sign} £{abs(deltas['GB']):.0f}: {title.lower()} ({'+' if deltas['GB'] >= 0 else '-'}£{abs(deltas['GB']):.0f})"
    battery = [
        {
            "zone": zone,
            "profit_before": 142.0,
            "profit_after": round(142.0 + abs(deltas[zone]) * 1.6, 1),
            "currency": CURRENCY[zone],
            "note": "1 MW / 2 MWh battery re-optimised on the shifted forecast; wider spreads mean more arbitrage.",
        }
        for zone in ZONES
    ]
    return {
        "id": f"fixture-{key}",
        "triggered_at": iso(NOW),
        "request": {"type": typ, "target": target, "magnitude": mag, "hours": hrs},
        "applied_magnitude": mag,
        "applied_hours": hrs,
        "target": target or "all",
        "clamped": False,
        "title": title,
        "zones": zones_out,
        "cost_total_gbp": {"p10": round(total * 0.7, -3), "p50": round(total, -3), "p90": round(total * 1.35, -3)},
        "winners": winners,
        "losers": losers,
        "explanation": explanation(sentence, contribs),
        "battery": battery,
        "ghost_wind": {"delta_mwh": 8400.0, "delta_constraint_cost_gbp": 1_900_000.0, "kind": "estimated"}
        if typ == "scottish_storm"
        else None,
        "method_note": "Gas and carbon pass-through approximates market coupling: price change ≈ 2 × gas change + "
        "0.37 × carbon change, weighted by the share of hours gas sets the price.",
        "kind": "scenario",
    }


def scenarios() -> dict:
    return {
        "scenarios": [
            {"key": k, "title": t, "blurb": b, "result": result(k, t, typ, tg, m, h, d)}
            for k, t, b, typ, tg, m, h, d in SCENARIOS
        ]
    }


def scores() -> dict:
    live, backtest, battery = [], [], []
    for zone in ZONES:
        target = "gb_system_price" if zone == "GB" else "price_da"
        m = round(rng.uniform(6, 14), 2)
        live.append({"zone": zone, "target": target, "model": "lgbm_q", "mae": m, "coverage_p10_p90": round(rng.uniform(0.72, 0.86), 2), "n": 24})
        live.append({"zone": zone, "target": target, "model": "persistence", "mae": round(m * rng.uniform(1.1, 1.6), 2), "coverage_p10_p90": None, "n": 24})
        for fold in range(4):
            mm = round(rng.uniform(7, 15), 2)
            backtest.append({"fold": fold, "zone": zone, "target": target, "model": "lgbm_q", "mae": mm, "coverage_p10_p90": round(rng.uniform(0.74, 0.84), 2), "n": 720})
            backtest.append({"fold": fold, "zone": zone, "target": target, "model": "persistence", "mae": round(mm * rng.uniform(0.95, 1.5), 2), "coverage_p10_p90": None, "n": 720})
        perfect = round(rng.uniform(180, 260), 1)
        for strat, share, worst in [("perfect_foresight", 1.0, 0.0), ("risk_aware", 0.71, -4.2), ("median_only", 0.68, -11.8), ("naive", 0.49, -9.5)]:
            battery.append({"strategy": strat, "zone": zone, "profit": round(perfect * share, 1), "currency": CURRENCY[zone], "share_of_perfect": share, "worst_hour_loss": worst})
    since = datetime(2026, 11, 7, 12, tzinfo=timezone.utc) - timedelta(hours=0)
    return {
        "as_of": iso(NOW),
        "headline": {
            "mae_model": 9.4,
            "mae_persistence": 13.1,
            "coverage_p10_p90": 0.79,
            "forecasts_scored": 142,
            "since": iso(since),
            "battery_share_of_perfect": 0.71,
            "sentence": "142 forecasts since Saturday noon, all logged before the outcome",
        },
        "live": live,
        "backtest": backtest,
        "battery": battery,
    }


def datacentre() -> dict:
    def site(loc, zone, name, cur, fx, cost, flex_cost, ci, tonnes):
        return {
            "location": loc, "zone": zone, "name": name, "currency": cur, "peak_it_kw": 1275.0, "facility_kw_avg": 1147.5, "annual_mwh": 10052.1,
            "price_basis": "day-ahead price", "price_days": 365,
            "energy": {"mean_price_local_mwh": round(cost / 10052.1, 2), "cost_local": cost, "cost_eur": round(cost * fx), "cost_flex_local": flex_cost,
                       "cost_flex_eur": round(flex_cost * fx), "saving_flex_local": cost - flex_cost, "saving_flex_eur": round((cost - flex_cost) * fx),
                       "saving_flex_pct": round(100 * (cost - flex_cost) / cost, 2)},
            "carbon": {"intensity_g_kwh": ci, "tonnes": tonnes, "tonnes_flex": round(tonnes * 1.01), "eua_eur_t": 72.0, "cost_eur": round(tonnes * 72.0),
                       "basis": "modelled consumption-based intensity"},
            "next_job": {"start": iso(NOW.replace(hour=2)), "end": iso(NOW.replace(hour=8)), "hours": 6, "kw": 229.5,
                         "saving_eur": {"p10": 4.0, "p50": 9.0, "p90": 15.0}, "kind": "forecast"},
            "grid_notes": [{"topic": "Interconnector access", "text": "Illustrative fixture note.", "source": "data/static/interconnectors.csv"},
                           {"topic": "Connection queue and boundary limits", "text": "Not in our data yet.", "source": "none"}],
            "kind": "estimated",
        }

    return {
        "generated_at": iso(NOW), "gpus": 1000, "gpu_type": "h100", "kw_per_gpu": 1.275, "pue": 1.5, "utilisation": 0.6, "flexible_share": 0.2,
        "eur_per_gbp": 1.15,
        "sites": [site("FR", "FR", "FR", "EUR", 1.0, 640_000.0, 600_000.0, 55.0, 553),
                  site("N", "GB", "South and Central Scotland (GB region N)", "GBP", 1.15, 790_000.0, 745_000.0, 180.0, 1809)],
        "cheapest_site": "FR",
        "note": "Illustrative fixture values; see the live endpoint for the real method and caveats.",
    }


def household() -> dict:
    start = NOW.replace(hour=16)
    prices = []
    for i in range(32):
        t = start + timedelta(minutes=30 * i)
        p = round(14 + 18 * math.exp(-((t.hour + t.minute / 60 - 17.5) ** 2) / 2) - 6 * math.exp(-((t.hour - 3) ** 2 if t.hour < 12 else 99) / 4), 2)
        published = t < NOW.replace(hour=23)
        prices.append({"ts": iso(t), "p_kwh": p, "p10": None if published else round(p - 3, 2), "p90": None if published else round(p + 4, 2), "kind": "actual" if published else "forecast"})
    return {
        "region": "N",
        "name": "South and Central Scotland",
        "generated_at": iso(NOW),
        "windows": [
            {"task": "ev", "label": "Charge your car", "start": iso(NOW.replace(hour=23) + timedelta(hours=1)), "end": iso(NOW.replace(hour=23) + timedelta(hours=5)), "avg_p_kwh": 9.8, "saving_gbp": {"p10": 2.1, "p50": 3.4, "p90": 4.2}, "kind": "forecast"},
            {"task": "dishwasher", "label": "Run the dishwasher", "start": iso(NOW.replace(hour=21)), "end": iso(NOW.replace(hour=22)), "avg_p_kwh": 13.2, "saving_gbp": {"p10": 0.18, "p50": 0.24, "p90": 0.29}, "kind": "actual"},
        ],
        "prices": prices,
        "note": "Octopus Agile prices where published (retail, include network charges); our forecast beyond them.",
    }


def household_savings() -> dict:
    start = NOW.replace(hour=22, minute=0)
    q = lambda a, b, c: {"p10": a, "p50": b, "p90": c}
    months = [("2026-08", 31, False, 9.8, None, 14.1), ("2026-09", 30, False, 10.6, None, 15.0), ("2026-10", 31, False, 12.4, 6.9, 17.3)]
    return {
        "region": "N", "name": "South Scotland", "generated_at": iso(NOW),
        "cap": {"p_kwh": 26.11, "period": "1 October to 31 December 2026, Direct Debit, single-rate meter, no VAT on electricity",
                "source": "Ofgem energy price cap tables, period 17a: https://www.ofgem.gov.uk/sites/default/files/2026-08/17a-PDF-Cap-Tables.pdf"},
        "fixed_p_kwh": None,
        "devices": [
            {"device": "ev", "label": "Charge your car", "kwh_per_use": 21.0, "uses_per_week": 3.0, "hours": 3.0,
             "basis": "assumption: 7 kW home charger for 3 hours, 3 charges a week", "assumption": True},
            {"device": "dishwasher", "label": "Run the dishwasher", "kwh_per_use": 0.9, "uses_per_week": 5.0, "hours": 1.0,
             "basis": "Energy Saving Trust winter guide, November 2022: 0.9 kWh a cycle; 5 cycles a week and 1 hour are assumptions",
             "assumption": False},
        ],
        "tonight": [
            {"device": "ev", "label": "Charge your car", "start": iso(start), "end": iso(start + timedelta(hours=3)), "kind": "forecast",
             "cost_gbp": q(1.6, 2.1, 2.9), "saving_vs_cap_gbp": q(2.6, 3.4, 3.9), "saving_vs_6pm_gbp": q(1.8, 2.5, 3.1), "saving_vs_fixed_gbp": None},
            {"device": "dishwasher", "label": "Run the dishwasher", "start": iso(start), "end": iso(start + timedelta(hours=1)), "kind": "forecast",
             "cost_gbp": q(0.07, 0.09, 0.12), "saving_vs_cap_gbp": q(0.11, 0.14, 0.16), "saving_vs_6pm_gbp": q(0.06, 0.1, 0.13), "saving_vs_fixed_gbp": None},
        ],
        "months": [{"month": m, "days": d, "partial": part, "saving_vs_6pm_gbp": a, "saving_vs_cap_gbp": c, "agile_cost_gbp": g}
                   for m, d, part, a, c, g in months],
        "annual": {"months_used": 3, "saving_vs_6pm_gbp": {"low": 117.6, "mean": 133.6, "high": 148.8},
                   "saving_vs_cap_today_gbp": {"low": 70.0, "mean": 84.0, "high": 96.0}},
        "history_from": iso(NOW.replace(month=8, day=1, hour=0, minute=0)), "history_to": iso(NOW.replace(hour=23)),
        "note": "Unit rates only: standing charges are the same however you use the energy. Illustrative fixture values.",
    }


def compute() -> dict:
    """A 1 MW job for 6 hours: cheapest start per zone over the next 24 hours."""
    start = NOW + timedelta(hours=1)
    kw, n = 1000.0, 6
    rows = []
    for zone in ZONES:
        prices = []
        for t in hours(start, 24):
            b = band(price(zone, t), max(0, (t - NOW).seconds // 3600))
            cleared = t < NOW.replace(hour=23)
            prices.append({"ts": iso(t), **({q: b["p50"] for q in b} if cleared else b), "kind": "actual" if cleared else "forecast"})
        def cost(i: int, q: str) -> float:
            return sum(p[q] for p in prices[i : i + n]) * kw / 1000
        i = min(range(24 - n + 1), key=lambda i: cost(i, "p50"))
        fx = EUR_PER_GBP if CURRENCY[zone] == "GBP" else 1.0
        c = {q: round(cost(i, q), 2) for q in ("p10", "p50", "p90")}
        now_ = {q: round(cost(0, q), 2) for q in ("p10", "p50", "p90")}
        sv = dict(zip(("p10", "p50", "p90"), sorted(round(now_[q] - c[q], 2) for q in c)))
        rows.append({
            "zone": zone, "currency": CURRENCY[zone], "unit": unit(zone),
            "start": iso(start + timedelta(hours=i)), "end": iso(start + timedelta(hours=i + n)),
            "avg_price": {q: round(v / n, 2) for q, v in c.items()}, "cost": c, "cost_now": now_, "saving": sv,
            "cost_eur": {q: round(v * fx, 2) for q, v in c.items()}, "saving_eur": {q: round(v * fx, 2) for q, v in sv.items()},
            "kind": "forecast" if i + n > 10 else "actual", "prices": prices,
        })
    rows.sort(key=lambda r: r["cost_eur"]["p50"])
    return {
        "generated_at": iso(NOW), "kw": kw, "hours": n, "deadline": iso(start + timedelta(hours=24)),
        "eur_per_gbp": EUR_PER_GBP, "zones": rows, "cheapest_zone": rows[0]["zone"],
        "note": "Sample data. Wholesale day-ahead energy only: no network charges, levies or taxes.",
    }


def replay() -> dict:
    start = datetime(2026, 10, 26, tzinfo=timezone.utc)
    series = []
    for zone in ["GB", "DE-LU"]:
        pts = []
        for t in hours(start, 24):
            a = round(price(zone, t) - (35 if zone == "GB" and 2 <= t.hour <= 14 else 0), 2)
            p50 = a + rng.uniform(-8, 8)
            pts.append({"ts": iso(t), "actual": a, **band(p50, 12), "made_at": iso(t - timedelta(hours=12)), "explanation": "Wind up sharply (-£31)" if zone == "GB" and t.hour == 6 else None})
        series.append({"zone": zone, "target": "gb_system_price" if zone == "GB" else "price_da", "unit": unit(zone), "points": pts})
    return {
        "event": "2026-10-26",
        "title": "The 26 October storm",
        "trained_before": "2026-10-26",
        "series": series,
        "constraint_cost_gbp": 36_000_000.0,
        "summary": "Models trained only on data before 26 October saw the overnight price collapse coming 12 hours ahead.",
    }


def reveal() -> dict:
    day = date(2026, 11, 9)
    start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    zs = []
    for zone in ZONES:
        published = zone == "GB"
        hrs = []
        for t in hours(start, 24):
            p50 = price(zone, t)
            b = band(p50, 36)
            hrs.append({"ts": iso(t), **b, "actual": round(p50 + rng.uniform(-9, 9), 2) if published else None})
        mae = round(sum(abs(h["actual"] - h["p50"]) for h in hrs) / 24, 2) if published else None
        inside = round(sum(h["p10"] <= h["actual"] <= h["p90"] for h in hrs) / 24, 2) if published else None
        zs.append({"zone": zone, "currency": CURRENCY[zone], "published": published, "hours": hrs, "mae": mae, "inside_band_share": inside})
    pub = [z for z in zs if z["published"]]
    return {
        "delivery_date": day.isoformat(),
        "frozen_at": "2026-11-07T23:59:00Z",
        "zones": zs,
        "zones_published": len(pub),
        "mean_abs_error": round(sum(z["mae"] for z in pub) / len(pub), 2) if pub else None,
        "zones_inside_band": sum(z["inside_band_share"] >= 0.8 for z in pub) if pub else None,
    }


# The four v3 endpoints: built by the engine's own builders from fixed synthetic inputs, so the fixtures keep the
# exact shape the code returns. Numbers are illustrative only.
def weather_grid() -> dict:
    lats = [54.0, 54.0, 54.0, 56.0, 56.0, 56.0, 58.0, 58.0, 58.0]
    lons = [-4.0, -2.0, 0.0] * 3
    return {
        "ts": iso(NOW), "available_from": iso(NOW - timedelta(hours=48)), "available_to": iso(NOW + timedelta(hours=48)),
        "step_deg": 2.0, "lats": lats, "lons": lons,
        "wind_speed_dms": [92, 104, 118, 121, 136, 150, 143, 158, 171],
        "wind_dir_deg": [245, 250, 255, 240, 248, 252, 236, 244, 250],
        "shortwave_wm2": [212, 220, 231, 168, 175, 183, 120, 126, 131],
        "units": {"wind_speed_dms": "tenths of m/s at 100 m", "wind_dir_deg": "degrees the wind blows from", "shortwave_wm2": "W/m2"},
        "kind": "modelled", "source": "Open-Meteo (model analysis and forecast), sample", "note": "Sample grid for the contract, not data.",
        "sample": True,
    }


def impact_renewables() -> dict:
    import numpy as np
    import pandas as pd

    from engine import impact

    g = np.random.default_rng(11)
    idx = pd.date_range("2026-10-01", periods=24 * 40, freq="h", tz="UTC")
    n = len(idx)
    wind = g.uniform(1500, 16000, n)
    load = g.uniform(24000, 38000, n)
    price = 95 - 6.5 * wind / 1000 + 1.2 * load / 1000 + g.normal(0, 2, n)
    a = pd.concat([pd.DataFrame({"ts": idx, "zone": "GB", "series": k, "value": v, "unit": "x"})
                   for k, v in [("price_da", price), ("gen_wind", wind), ("load", load)]], ignore_index=True)
    out = impact.renewables("GB", NOW - timedelta(hours=6), NOW - timedelta(hours=1), a=a, gas=pd.Series(dtype=float))
    return {**out, "model_check": None, "sample": True}


def carbon_costs() -> dict:
    import pandas as pd

    from engine import carbon_costs as cc

    at = pd.Timestamp(NOW)
    ci = pd.DataFrame([{"ts": at, "zone": z, "production_gco2_kwh": float(p), "consumption_gco2_kwh": float(c)}
                       for z, (p, c, _) in CARBON.items()])
    uka = pd.DataFrame({"ts": [pd.Timestamp("2026-09-01", tz="UTC")], "value": [60.17]})
    eua = pd.Series([78.4], index=[pd.Timestamp("2026-11-06", tz="UTC")])
    return {**cc.build(at, ci=ci, uka=uka, eua_series=eua), "sample": True}


def infrastructure() -> dict:
    import pandas as pd

    from engine import infrastructure as inf

    t0 = pd.Timestamp("2026-10-25", tz="UTC")
    ts = pd.date_range(t0, periods=72, freq="h")
    rows = []
    for t in ts:
        b6 = 4300.0 + 1400 * math.sin(t.hour / 24 * 2 * math.pi)
        rows.append({"ts": t, "boundary": "SCOTEX", "flow_mw": b6, "limit_mw": 4200.0, "utilisation": b6 / 4200})
        rows.append({"ts": t, "boundary": "SSEN-S", "flow_mw": 1500.0, "limit_mw": 2000.0, "utilisation": 0.75})
    flows = pd.DataFrame(rows)
    days = [t0 + pd.Timedelta(days=d) for d in range(3)]
    costs = pd.DataFrame({"ts": days, "thermal_cost_gbp": [9.1e6, 36.5e6, 4.2e6], "thermal_volume_mwh": [-61000.0, -240000.0, -30000.0],
                          "total_cost_gbp": [11.0e6, 41.0e6, 5.5e6]})
    ghost = pd.DataFrame({"ts": ts, "region": "P", "mwh": [max(0.0, f - 4200.0) * 0.8 for f in flows[flows.boundary == "SCOTEX"]["flow_mw"]]})
    actuals = pd.DataFrame({"ts": ts, "zone": "GB", "series": "flow_GB_NO2", "value": [-1300.0] * len(ts), "unit": "MW"})
    links = pd.DataFrame({"to_zone": ["NO2"], "capacity_mw": [1400]})
    return {**inf.build(flows=flows, costs=costs, ghost=ghost, actuals=actuals, links=links), "sample": True}


def build() -> dict[str, tuple[type, dict]]:
    z = zones()
    st = state(z)
    sc = scenarios()
    return {
        "zones": (s.ZonesResponse, z),
        "state": (s.StateResponse, st),
        "explain": (s.ExplainResponse, explain()),
        "ghost_wind": (s.GhostWindResponse, ghost_wind()),
        "carbon": (s.CarbonResponse, carbon(st)),
        "intervene": (s.InterventionResult, sc["scenarios"][0]["result"]),
        "scenarios": (s.ScenariosResponse, sc),
        "scores": (s.ScoresResponse, scores()),
        "household": (s.HouseholdResponse, household()),
        "datacentre": (s.DataCentreResponse, datacentre()),
        "household_savings": (s.HouseholdSavingsResponse, household_savings()),
        "replay": (s.ReplayResponse, replay()),
        "reveal": (s.RevealResponse, reveal()),
        "compute": (s.ComputeResponse, compute()),  # last of the shared-rng users
        "weather_grid": (s.WeatherGridResponse, weather_grid()),
        "impact_renewables": (s.ImpactResponse, impact_renewables()),
        "carbon_costs": (s.CarbonCostsResponse, carbon_costs()),
        "infrastructure": (s.InfrastructureResponse, infrastructure()),
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (model, data) in build().items():
        clean = model.model_validate(data).model_dump(mode="json", by_alias=True)
        (OUT / f"{name}.json").write_text(json.dumps(clean, indent=1, ensure_ascii=False) + "\n")
        print(f"wrote {name}.json")


if __name__ == "__main__":
    main()
