"""GET /generation: hourly generation by fuel for one UTC day, from the same actuals caches as /state."""
from datetime import date as Date, datetime, timedelta, timezone

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from engine import data

router = APIRouter(tags=["unseen"], include_in_schema=False)

ZONES = ("GB", "FR", "DE-LU", "NL", "BE", "NO2")
FUELS = ("nuclear", "wind", "solar", "hydro", "biomass", "gas", "coal", "oil", "other")
GROUPS = {
    "nuclear": ("nuclear",), "wind": ("wind", "wind_onshore", "wind_offshore"), "solar": ("solar",),
    "hydro": ("hydro", "hydro_run_of_river", "hydro_water_reservoir"), "biomass": ("biomass",),
    "gas": ("gas", "fossil_gas", "fossil_coal_derived_gas"),
    "coal": ("coal", "fossil_hard_coal", "fossil_brown_coal_lignite"), "oil": ("oil", "fossil_oil"),
    "other": ("other", "others", "waste", "geothermal", "other_renewables", "thermal"),
}
FUEL_OF = {f"gen_{s}": fuel for fuel, names in GROUPS.items() for s in names}
PUMPED = {"gen_pumped_storage": 1, "gen_hydro_pumped_storage": 1, "gen_hydro_pumped_storage_consumption": 1}
# Energy-Charts public_power for Norway covers the whole country, so NO2 comes from Elhub (a day or two late).
SOURCES = {"GB": ("elexon", "Elexon (FUELHH)"), "NO2": ("elhub", "Elhub"),
           "FR": ("energycharts", "Energy-Charts"), "DE-LU": ("energycharts", "Energy-Charts"),
           "NL": ("energycharts", "Energy-Charts"), "BE": ("energycharts", "Energy-Charts")}
PLACE = {"GB": "Britain", "FR": "France", "DE-LU": "Germany", "NL": "the Netherlands", "BE": "Belgium", "NO2": "southern Norway"}
POSSESSIVE = {"NL": "the Netherlands'"}
NOTES = {"GB": "Elexon metered output only: solar and wind embedded in local networks are not in this feed.",
         "NO2": "Elhub metered data lands a day or two late, so the newest hours are missing."}


def _day(value: str | None) -> pd.Timestamp:
    today = datetime.now(timezone.utc).date()
    try:
        d = Date.fromisoformat(value) if value else today
    except ValueError:
        raise HTTPException(422, "date must be YYYY-MM-DD") from None
    return pd.Timestamp(d, tz="UTC")


def _when(day: pd.Timestamp) -> str:
    today = pd.Timestamp(datetime.now(timezone.utc).date(), tz="UTC")
    return {0: "today so far", 1: "yesterday"}.get((today - day).days, f"on {day:%-d %b}")


def sentence(zone: str, day: pd.Timestamp, share: dict[str, float]) -> str:
    place = POSSESSIVE.get(zone, f"{PLACE[zone]}'s")
    if not share:
        late = " (Elhub lands a day or two late)" if zone == "NO2" else ""
        return f"No metered generation for {PLACE[zone]} {_when(day).replace(' so far', '')} yet{late}."
    ranked = sorted(share, key=share.get, reverse=True)
    lead = ranked[0]
    second = "wind" if lead != "wind" and "wind" in share else next((f for f in ranked[1:]), None)
    text = f"{lead.capitalize()} made {share[lead] * 100:.0f}% of {place} power {_when(day)}"
    return text + (f"; {second} {share[second] * 100:.0f}%." if second else ".")


def zone_day(zone: str, day: pd.Timestamp) -> dict:
    source, label = SOURCES[zone]
    a = data.actuals()
    a = a[(a["zone"] == zone) & (a["source"] == source) & (a["ts"] >= day) & (a["ts"] < day + timedelta(days=1))]
    out = {"zone": zone, "date": f"{day:%Y-%m-%d}", "unit": "MW", "source": label, "as_of": None,
           "fuels": [], "hours": [], "share": {}, "note": NOTES.get(zone)}
    gen = a[a["series"].str.startswith("gen_")]
    if gen.empty:
        out["sentence"] = sentence(zone, day, {})
        return out
    hours = gen["ts"].dt.floor("h")
    rows = {}
    for (h, series), v in gen.groupby([hours, gen["series"]])["value"].mean().items():
        slot = rows.setdefault(h, {"mw": dict.fromkeys(FUELS, 0.0), "pumped": 0.0, "seen": False})
        if series in PUMPED:
            slot["pumped"] += v
        elif series in FUEL_OF:
            slot["mw"][FUEL_OF[series]] += max(float(v), 0.0)
            slot["seen"] = True
    load = a[a["series"] == "load"].groupby(a["ts"].dt.floor("h"))["value"].mean()
    totals = dict.fromkeys(FUELS, 0.0)
    for h in sorted(rows):
        if not rows[h]["seen"]:
            continue
        mw = {k: round(v, 1) for k, v in rows[h]["mw"].items()}
        for k, v in mw.items():
            totals[k] += v
        out["hours"].append({"t": f"{h:%Y-%m-%dT%H:00:00Z}", "mw": mw, "pumped_mw": round(rows[h]["pumped"], 1),
                             "load_mw": round(float(load[h]), 1) if h in load.index else None})
    whole = sum(totals.values())
    out["fuels"] = [f for f in FUELS if totals[f] > 0]
    out["share"] = {f: round(totals[f] / whole, 4) for f in out["fuels"]} if whole else {}
    out["as_of"] = out["hours"][-1]["t"] if out["hours"] else None
    out["sentence"] = sentence(zone, day, out["share"])
    return out


@router.get("/generation")
def generation(zone: str | None = Query(None), date: str | None = Query(None)) -> dict:
    day = _day(date)
    if zone is not None:
        if zone not in SOURCES:
            raise HTTPException(422, f"zone must be one of {', '.join(ZONES)}")
        return zone_day(zone, day)
    zones = [zone_day(z, day) for z in ZONES]
    peak = max((sum(h["mw"].values()) for z in zones for h in z["hours"]), default=0.0)
    return {"date": f"{day:%Y-%m-%d}", "unit": "MW", "scale_max_mw": round(peak, 1), "fuels": list(FUELS), "zones": zones}
