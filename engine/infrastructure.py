"""Where the GB grid is stuck, what that costs, and what more Scotland-England capacity would have saved.

Boundaries: NESO day-ahead flows against limits. The flows are the forecast position after energy scheduling and
before expected constraint actions, so flow above the limit is volume NESO has to constrain (overload).
Counterfactual: add `extra` MW to the B6 (SCOTEX) limit. The overload that disappears is the avoided constraint
volume; it is priced at that day's NESO thermal cost per constrained MWh, and capped by the wind actually switched
off in Scotland (accepted bids, ghost wind) to give the wind that would have kept running.
It is an estimate from a short window of day-ahead forecasts, not a result of running the market again.
"""

import pandas as pd

from engine import data
from engine.ghost_wind import boalf
from engine.reference import loader
from pipeline import cache, static

FLOWS = "neso/boundary_flows"
FLOWS_ALL = "neso/boundaries_all"
COSTS = "neso/constraint_costs"
B6 = "SCOTEX"
EXTRA_MW = (2000, 4000)
INTERCONNECTOR_GROUPS = {"FR": "France", "NL": "Netherlands", "BE": "Belgium", "NO2": "Norway", "DK1": "Denmark",
                         "SEM": "Ireland and Northern Ireland"}
FLOW_SERIES = {"FR": ["GB_FR"], "NL": ["GB_NL"], "BE": ["GB_BE"], "NO2": ["GB_NO2"], "DK1": ["GB_DK1"], "SEM": ["GB_IE", "GB_NI"]}
FULL_SHARE = 0.9
NESO_FLOW_SOURCE = "NESO Data Portal, Day Ahead Constraint Flows and Limits (https://www.neso.energy/data-portal/day-ahead-constraint-flows-and-limits)"
NESO_COST_SOURCE = "NESO Data Portal, Constraint Breakdown (https://www.neso.energy/data-portal/constraint-breakdown)"
OTF_SOURCE = "NESO Operational Transparency Forum, 7 October 2026 (https://www.neso.energy/document/388476/download)"

# Each checked against the owner's or regulator's page on 7 Nov 2026.
PLANNED = [
    {"id": "egl1", "name": "Eastern Green Link 1 (Torness to Hawthorn Pit)", "capacity_mw": 2000, "operational": "2029",
     "status": "under construction (started 2025)", "source": "https://www.easterngreenlink1.co.uk/"},
    {"id": "egl2", "name": "Eastern Green Link 2 (Peterhead to Drax)", "capacity_mw": 2000, "operational": "2029",
     "status": "under construction (two years in, 6 Nov 2026)", "source": "http://www.sse.com/news-and-views/2026/11/eastern-green-link-2-marks-two-years-of-construction"},
    {"id": "egl3", "name": "Eastern Green Link 3 (Peterhead to Walpole)", "capacity_mw": 2000, "operational": None,
     "status": "proposed; Ofgem approved updated delivery dates and early funding in December 2025",
     "source": "https://www.ofgem.gov.uk/press-release/ofgem-agrees-early-investment-and-updated-dates-proposed-electricity-superhighways"},
    {"id": "egl4", "name": "Eastern Green Link 4 (Westfield to Walpole)", "capacity_mw": 2000, "operational": None,
     "status": "proposed; Ofgem approved updated delivery dates and early funding in December 2025",
     "source": "https://www.ofgem.gov.uk/press-release/ofgem-agrees-early-investment-and-updated-dates-proposed-electricity-superhighways"},
]
QUEUE = {
    "before_reform_gw": "more than 700", "new_pipeline_generation_storage_gw": 283, "new_pipeline_demand_gw": 99,
    "aligned_with_clean_power_2030_gw": 132, "as_of": "2025-12-08",
    "source": "NESO, 'NESO implements electricity grid connection reforms' (8 December 2025), https://www.neso.energy/neso-implements-electricity-grid-connection-reforms-unlock-investment-great-britain",
}
NOTE = ("Estimates. Boundary flows are NESO day-ahead forecasts, not metered flows, over a short window. The counterfactual "
        "changes one limit and prices the avoided volume at NESO's average thermal cost per MWh for that day; it ignores "
        "other boundaries that would then bind and the market response. The Scottish boundaries are nested (SSEN-S, SSE-SP and "
        "SSHARN also exceed their limits in the same window), so avoided cost and wind are upper bounds. Accepted wind bids "
        "include non-constraint actions, so avoided wind is an upper bound too.")


def _read(name: str) -> pd.DataFrame | None:
    try:
        return cache.read(name) if cache.offline() else (cache.read_file(cache.path(name)) if cache.exists(name) else None)
    except FileNotFoundError:
        return None


def boundary_table(flows: pd.DataFrame) -> list[dict]:
    out = []
    for name, g in flows.groupby("boundary"):
        over = (g["flow_mw"] - g["limit_mw"]).clip(lower=0)
        out.append({
            "boundary": name, "hours": int(len(g)), "median_limit_mw": round(float(g["limit_mw"].median())),
            "mean_flow_mw": round(float(g["flow_mw"].mean())),
            "hours_over_limit_share": round(float((over > 0).mean()), 3),
            "overload_mwh": round(float(over.sum())), "peak_overload_mw": round(float(over.max())),
            "mean_utilisation": round(float(g["utilisation"].mean()), 3),
        })
    return sorted(out, key=lambda r: -r["overload_mwh"])


def interconnectors(actuals: pd.DataFrame, links: pd.DataFrame, days: int = 30) -> list[dict]:
    end = actuals["ts"].max()
    out = []
    for key, label in INTERCONNECTOR_GROUPS.items():
        names = ["flow_" + s for s in FLOW_SERIES[key]]
        f = actuals[actuals["series"].isin(names) & (actuals["ts"] > end - pd.Timedelta(days=days))]
        cap = float(links.loc[links["to_zone"] == key, "capacity_mw"].sum())
        if f.empty or cap <= 0:
            continue
        net = -f.groupby("ts")["value"].sum()  # positive = GB imports
        out.append({
            "zone": key, "name": label, "capacity_mw": round(cap), "hours": int(len(net)),
            "mean_import_mw": round(float(net.mean())), "import_utilisation": round(float(net.clip(lower=0).mean() / cap), 3),
            "hours_full_import_share": round(float((net >= FULL_SHARE * cap).mean()), 3),
            "hours_full_export_share": round(float((net <= -FULL_SHARE * cap).mean()), 3),
        })
    return out


def cost_summary(costs: pd.DataFrame) -> dict:
    thermal = float(costs["thermal_cost_gbp"].sum())
    vol = float(costs["thermal_volume_mwh"].abs().sum())
    return {"days": int(len(costs)), "from": costs["ts"].min().to_pydatetime(), "to": costs["ts"].max().to_pydatetime(),
            "total_cost_gbp": round(float(costs["total_cost_gbp"].sum())), "thermal_cost_gbp": round(thermal),
            "thermal_volume_mwh": round(vol), "thermal_gbp_per_mwh": round(thermal / vol, 1) if vol else None,
            "source": NESO_COST_SOURCE}


def counterfactual(flows: pd.DataFrame, costs: pd.DataFrame | None, ghost: pd.DataFrame | None, extra_mw: float) -> dict:
    """Extra MW on the B6 limit: overload before and after, per hour; priced per day; capped by Scottish wind switched off."""
    g = flows[flows["boundary"] == B6].set_index("ts").sort_index()
    before = (g["flow_mw"] - g["limit_mw"]).clip(lower=0)
    after = (g["flow_mw"] - g["limit_mw"] - extra_mw).clip(lower=0)
    avoided = before - after
    res = {"extra_mw": extra_mw, "hours": int(len(g)), "overload_mwh": round(float(before.sum())),
           "avoided_overload_mwh": round(float(avoided.sum())),
           "hours_still_over_limit": int((after > 0).sum()), "hours_over_limit_now": int((before > 0).sum()),
           "avoided_cost_gbp": None, "avoided_cost_days": 0, "avoided_wind_mwh": None, "scotland_wind_switched_off_mwh": None}
    if costs is not None and len(costs):
        c = costs.assign(day=costs["ts"].dt.tz_convert("Europe/London").dt.strftime("%Y-%m-%d"))
        c = c[c["thermal_volume_mwh"].abs() > 0].set_index("day")
        price = (c["thermal_cost_gbp"] / c["thermal_volume_mwh"].abs())
        days = avoided.index.tz_convert("Europe/London").strftime("%Y-%m-%d")
        daily = avoided.groupby(days).sum()
        common = daily.index.intersection(price.index)
        if len(common):
            res["avoided_cost_gbp"] = round(float((daily[common] * price[common]).sum()))
            res["avoided_cost_days"] = int(len(common))
            res["avoided_cost_window_overload_mwh"] = round(float(daily[common].sum()))
            res["thermal_volume_in_window_mwh"] = round(float(c.loc[common, "thermal_volume_mwh"].abs().sum()))
    if ghost is not None and len(ghost):
        sc = ghost[ghost["region"].isin(boalf.SCOTLAND)].groupby("ts")["mwh"].sum()
        both = pd.concat([avoided.rename("a"), sc.rename("w")], axis=1, join="inner")
        if len(both):
            res["avoided_wind_mwh"] = round(float(both.min(axis=1).sum()))
            res["scotland_wind_switched_off_mwh"] = round(float(both["w"].sum()))
            res["wind_window_hours"] = int(len(both))
    return res


def build(extra_mw=EXTRA_MW, flows: pd.DataFrame | None = None, costs: pd.DataFrame | None = None,
          ghost: pd.DataFrame | None = None, actuals: pd.DataFrame | None = None, links: pd.DataFrame | None = None) -> dict:
    scot = _read(FLOWS) if flows is None else flows
    allb = _read(FLOWS_ALL) if flows is None else None
    if scot is None or scot.empty:
        raise LookupError("no NESO boundary flows ingested yet")
    table_src = scot if allb is None or allb.empty else allb
    costs = _read(COSTS) if costs is None else costs
    if ghost is None:
        bids = boalf.load_bids()
        ghost = boalf.estimate(scot["ts"].min(), scot["ts"].max(), bids=bids) if bids is not None else None
    actuals = data.actuals() if actuals is None else actuals
    links = static.interconnectors() if links is None else links
    caps = {}
    for fid, b in (("con_b6_capability", "B6"), ("con_b4_capability", "B4")):
        try:
            caps[b] = {"mw": max(loader.numbers(loader.fact(fid)["value"])), "source": loader.fact(fid)["sources"][0]["url"], "label": "ETYS 2025 boundary capability"}
        except (KeyError, LookupError, IndexError):
            pass
    boundaries = boundary_table(table_src)
    for r in boundaries:
        if r["boundary"] == B6:
            r["name"] = "B6 (Scotland to England, NESO group SCOTEX)"
            r["max_capacity_mw"] = 6800
            r["max_capacity_source"] = OTF_SOURCE
    return {
        "window": {"from": scot["ts"].min().to_pydatetime(), "to": scot["ts"].max().to_pydatetime()},
        "boundaries": boundaries, "boundary_source": NESO_FLOW_SOURCE, "etys_capability": caps,
        "interconnectors": interconnectors(actuals, links),
        "interconnector_basis": "Capacities are nominal, hand-entered in data/static/interconnectors.csv; flows are Elexon metered.",
        "constraint_costs": cost_summary(costs) if costs is not None and len(costs) else None,
        "counterfactual": {"boundary": B6, "scenarios": [counterfactual(scot, costs, ghost, e) for e in extra_mw],
                           "ghost_wind_source": "Elexon accepted bids on Scottish wind units (estimate, upper bound)"},
        "planned_links": PLANNED, "connections_queue": QUEUE,
        "kind": "estimated", "note": NOTE,
    }
