"""Data centre builder: what a GPU site costs to run, in energy, carbon and grid terms, for up to three locations.

Power: GPUs x system power per GPU x utilisation x PUE. System power per GPU is NVIDIA's published maximum
for a DGX H100 (10.2 kW for 8) or DGX B200 (14.3 kW for 8), or the RTX 4090's 450 W graphics power (card only).
Draw is taken as linear in utilisation, which understates idle draw. PUE defaults to Uptime Institute's 2025
European average. Utilisation and flexible share are our assumptions.

Prices: the trailing year of hourly day-ahead prices in our cache for the site's zone. GB day-ahead history is only
about 60 days, so GB uses the Elexon system price, which is the settlement price and spikier. If the cache holds
less than a year the figures are annualised from what there is, and the response says how many days that was.
Carbon: hourly consumption-based intensity (modelled) for the zone times the site's hourly load, and the tonnes
priced at the EU ETS allowance price. That price is a shadow cost: it is already inside the power price.
A GB region letter uses NESO's Carbon Intensity API regional figures instead: the modelled intensity of electricity
consumed in that region, from a reduced GB network power-flow model, counting generation CO2 only (NESO regional
methodology, https://www.neso.energy/data-portal/regional-carbon-intensity-forecast). We cache only recent days of
it, so the region's mean over the cached hours stands in for the rest of the year, and the response says how many.
Prices are GB-wide for every region: GB has one wholesale price, and the response says so.

Flexible load: the flexible share of each day's energy is moved to that day's cheapest hours, up to the site's full
nameplate draw. The next-24-hours view reuses /compute. No network charges, levies or taxes are included.
"""

from datetime import datetime

import numpy as np
import pandas as pd

from engine import compute, data
from engine import household as hh
from engine.ghost_wind.boalf import read_live
from engine.battery.compare import EUR_PER_GBP
from engine.reference import loader
from pipeline import cache, static

GPU_TYPES = ("h100", "b200", "consumer")
MAX_SITES = 3
MAX_GPUS = 1_000_000
HOURS_YEAR = 8760
MIN_DAY_HOURS = 20
DEFAULTS = {"gpus": 1000, "gpu_type": "h100", "utilisation": 0.6, "flexible_share": 0.2}
SYSTEM_GPUS = 8
REGIONAL_CI = "carbon_intensity/regional"
REGIONAL_CI_SOURCE = "NESO Carbon Intensity API, regional (https://www.neso.energy/data-portal/regional-carbon-intensity-forecast)"


class BadRequest(ValueError):
    pass


def gpu_kw(gpu_type: str) -> tuple[float, str]:
    """(kW per GPU at full draw, where it comes from)."""
    if gpu_type == "h100":
        return loader.figure("dc_dgx_h100_kw") / SYSTEM_GPUS, "NVIDIA DGX H100: 10.2 kW max for 8 GPUs, whole system"
    if gpu_type == "b200":
        return loader.figure("dc_dgx_b200_kw") / SYSTEM_GPUS, "NVIDIA DGX B200: 14.3 kW max for 8 GPUs, whole system"
    if gpu_type == "consumer":
        return loader.figure("dc_rtx4090_tgp_w") / 1000, "NVIDIA RTX 4090 total graphics power, card only"
    raise BadRequest(f"unknown gpu_type {gpu_type!r}; use one of {', '.join(GPU_TYPES)}")


def default_pue() -> float:
    return loader.figure("dc_pue", after="Europe")


def locate(location: str) -> tuple[str, str, str | None]:
    """(zone, display name, GB region letter or None) for a zone code or a GB region letter."""
    loc = location.strip()
    if loc.upper() in data.ZONES:
        return loc.upper(), loc.upper(), None
    regions = hh.regions()
    if loc.upper() in regions:
        return "GB", f"{regions[loc.upper()]} (GB region {loc.upper()})", loc.upper()
    raise BadRequest(f"unknown location {location!r}; use a zone ({', '.join(data.ZONES)}) or a GB region letter ({', '.join(regions)})")


def hourly_prices(zone: str, upto: pd.Timestamp) -> tuple[pd.Series, str]:
    a = data.actuals()
    if zone == "GB":
        s = a[(a["zone"] == "GB") & (a["series"] == "system_price")]
        basis = "Elexon system price (GB day-ahead history is only about 60 days)"
    else:
        s = a[(a["zone"] == zone) & (a["series"] == compute.TARGET)]
        basis = "day-ahead price"
    if s.empty:
        return pd.Series(dtype=float), basis
    if zone != "GB":
        s = s.assign(rank=s["source"].map({x: i for i, x in enumerate(data.PRICE_SOURCES)}).fillna(9)).sort_values("rank")
    s = s.assign(ts=pd.to_datetime(s["ts"], utc=True).dt.floor("h"))
    if zone != "GB":
        s = s.drop_duplicates("ts")
    out = s.groupby("ts")["value"].mean().sort_index()
    return out[out.index <= upto].iloc[-HOURS_YEAR:], basis


def hourly_carbon(zone: str) -> pd.Series:
    c = data.carbon()
    if not len(c):
        return pd.Series(dtype=float)
    c = c[c["zone"] == zone]
    return c.assign(ts=pd.to_datetime(c["ts"], utc=True).dt.floor("h")).groupby("ts")["consumption_gco2_kwh"].mean().sort_index()


def regional_carbon(region: str) -> pd.Series:
    """Hourly modelled intensity of electricity consumed in a GB region (gCO2/kWh), empty when not cached."""
    r = read_live(REGIONAL_CI)
    if r is None or not len(r):
        return pd.Series(dtype=float)
    r = r[r["region"] == region].dropna(subset=["intensity_gco2_kwh"])
    return r.assign(ts=pd.to_datetime(r["ts"], utc=True).dt.floor("h")).groupby("ts")["intensity_gco2_kwh"].mean().sort_index()


def site_carbon(zone: str, region: str | None) -> tuple[pd.Series, str]:
    """(hourly intensity, basis sentence) for a zone, or for a GB region when its regional figures are cached."""
    if region is None:
        return hourly_carbon(zone), "modelled consumption-based intensity"
    ci = regional_carbon(region)
    if ci.empty:
        return hourly_carbon(zone), f"GB-wide modelled consumption-based intensity: no regional carbon figures cached for region {region}"
    span = f"{ci.index.min():%d %b %H:%M} to {ci.index.max():%d %b %H:%M} UTC"
    return ci, (f"Region {region}: modelled intensity of electricity consumed in the region, generation CO2 only, from {REGIONAL_CI_SOURCE}. "
                f"Mean of the {len(ci)} cached hours ({span}), which also stands in for the rest of the year, so it reflects recent weather")


def eua_price() -> float | None:
    try:
        g = cache.read("markets/gas_carbon")
    except FileNotFoundError:
        return None
    g = g[g["series"] == "eua"].sort_values("ts")
    return float(g["value"].iloc[-365:].mean()) if len(g) else None


def place_flexible(price: np.ndarray, base_kw: float, flex: float, cap_kw: float) -> np.ndarray:
    """One day's hourly kW with `flex` of the energy moved into the cheapest hours, up to cap_kw per hour."""
    n = len(price)
    fixed = np.full(n, base_kw * (1 - flex))
    energy = base_kw * flex * n
    load = fixed.copy()
    for h in np.argsort(price, kind="stable"):
        if energy <= 1e-9:
            break
        add = min(max(cap_kw - fixed[h], 0.0), energy)
        load[h] += add
        energy -= add
    if energy > 1e-6:
        load += energy / n
    return load


def annual(prices: pd.Series, carbon: pd.Series, base_kw: float, flex: float, cap_kw: float) -> dict:
    """Totals over the days we have complete prices for, then scaled to a year."""
    df = pd.DataFrame({"p": prices})
    df["ci"] = carbon.reindex(df.index)
    df["ci"] = df["ci"].fillna(df["ci"].mean() if df["ci"].notna().any() else carbon.mean())
    df["day"] = df.index.floor("D")
    flat_cost = flex_cost = flat_t = flex_t = hours = price_sum = 0.0
    days = 0
    for _, g in df.groupby("day"):
        if len(g) < MIN_DAY_HOURS or g["p"].isna().any():
            continue
        p, ci = g["p"].to_numpy(), g["ci"].to_numpy()
        load = place_flexible(p, base_kw, flex, cap_kw)
        flat_cost += float((p * base_kw / 1000).sum())
        flex_cost += float((p * load / 1000).sum())
        flat_t += float((ci * base_kw / 1e6).sum())
        flex_t += float((ci * load / 1e6).sum())
        hours += len(g)
        price_sum += float(p.sum())
        days += 1
    if not hours:
        return {}
    k = HOURS_YEAR / hours
    return {"days": days, "mwh": base_kw * HOURS_YEAR / 1000, "cost": flat_cost * k, "cost_flex": flex_cost * k,
            "tonnes": flat_t * k, "tonnes_flex": flex_t * k, "mean_price": price_sum / hours, "mean_ci": float(df["ci"].mean())}


def grid_notes(zone: str, location: str) -> list[dict]:
    ic = static.interconnectors()
    ic = ic[(ic["from_zone"] == zone) | (ic["to_zone"] == zone)]
    notes = []
    if len(ic):
        far = [r.to_zone if r.from_zone == zone else r.from_zone for r in ic.itertuples()]
        notes.append({"topic": "Interconnector access", "text": f"{len(ic)} link{'s' if len(ic) != 1 else ''}, nominal {int(ic['capacity_mw'].sum()):,} MW in total, "
                      f"to {', '.join(dict.fromkeys(far))}. Nominal capacities are hand-entered from operator pages.",
                      "source": "data/static/interconnectors.csv"})
    if zone == "GB" and location.upper() != "GB":
        notes.append({"topic": "GB-wide prices", "text": "GB has one wholesale electricity price, so energy costs and the flexible saving are "
                      "GB-wide and the same in every GB region. Carbon is regional where NESO's regional figures are cached.",
                      "source": "Elexon system price; " + REGIONAL_CI_SOURCE})
    if zone == "GB" and location.upper() in ("N", "P"):
        notes.append({"topic": "Scottish wind constraints", "text": "Scotland often has more wind than the grid can carry south, so wind is paid to switch off. "
                      "A site here can soak up that power but may face the same boundary limits; see /unseen/ghost-wind for recent costs.",
                      "source": "engine/ghost_wind (modelled)"})
    notes.append({"topic": "Connection queue and boundary limits", "text": "Not in our data yet: connection queue position, local network capacity and "
                  "transmission boundary limits need NESO and DNO sources that we have not loaded.", "source": "none"})
    return notes


def next_job(zone: str, flex_kw: float, now: datetime | None) -> dict | None:
    if flex_kw <= 0:
        return None
    try:
        r = compute.build(min(flex_kw, compute.MAX_KW), compute.DEFAULT_HOURS, zone, None, now)
    except compute.BadRequest:
        return None
    if not r["zones"]:
        return None
    z = r["zones"][0]
    return {"start": z["start"], "end": z["end"], "hours": r["hours"], "kw": r["kw"], "saving_eur": z["saving_eur"], "kind": z["kind"]}


def site(location: str, gpus: int, gpu_type: str, pue: float, util: float, flex: float, now: datetime | None) -> dict:
    zone, name, region = locate(location)
    per_gpu, _ = gpu_kw(gpu_type)
    peak_it = gpus * per_gpu
    base_kw = peak_it * util * pue
    cap_kw = peak_it * pue
    prices, basis = hourly_prices(zone, data.as_utc(now) if now is not None else compute.clock())
    if region:
        basis = f"GB-wide {basis}: GB has one wholesale price, the same in every region"
    carbon, carbon_basis = site_carbon(zone, region)
    cur = data.CURRENCY[zone]
    fx = EUR_PER_GBP if cur == "GBP" else 1.0
    a = annual(prices, carbon, base_kw, flex, cap_kw) if len(prices) else {}
    eua = eua_price()
    out = {"location": location.upper(), "zone": zone, "name": name, "currency": cur, "peak_it_kw": peak_it, "facility_kw_avg": base_kw,
           "annual_mwh": base_kw * HOURS_YEAR / 1000, "price_basis": basis, "price_days": a.get("days", 0), "energy": None, "carbon": None,
           "next_job": next_job(zone, base_kw * flex, now), "grid_notes": grid_notes(zone, location), "kind": "estimated"}
    if a:
        out["energy"] = {"mean_price_local_mwh": a["mean_price"], "cost_local": a["cost"], "cost_eur": a["cost"] * fx,
                         "cost_flex_local": a["cost_flex"], "cost_flex_eur": a["cost_flex"] * fx,
                         "saving_flex_local": a["cost"] - a["cost_flex"], "saving_flex_eur": (a["cost"] - a["cost_flex"]) * fx,
                         "saving_flex_pct": 100 * (a["cost"] - a["cost_flex"]) / a["cost"] if a["cost"] else 0.0}
        out["carbon"] = {"intensity_g_kwh": a["mean_ci"], "tonnes": a["tonnes"], "tonnes_flex": a["tonnes_flex"], "eua_eur_t": eua,
                         "cost_eur": None if eua is None else a["tonnes"] * eua, "basis": carbon_basis}
    return out


def build(locations: list[str], gpus: int = DEFAULTS["gpus"], gpu_type: str = DEFAULTS["gpu_type"], pue: float | None = None,
          utilisation: float = DEFAULTS["utilisation"], flexible_share: float = DEFAULTS["flexible_share"],
          now: datetime | None = None) -> dict:
    if not 1 <= len(locations) <= MAX_SITES:
        raise BadRequest(f"give between 1 and {MAX_SITES} locations")
    if not 1 <= gpus <= MAX_GPUS:
        raise BadRequest(f"gpus must be between 1 and {MAX_GPUS:,}")
    pue = default_pue() if pue is None else pue
    if not 1.0 <= pue <= 3.0:
        raise BadRequest("pue must be between 1.0 and 3.0")
    if not 0.0 < utilisation <= 1.0:
        raise BadRequest("utilisation must be above 0 and at most 1")
    if not 0.0 <= flexible_share <= 1.0:
        raise BadRequest("flexible_share must be between 0 and 1")
    per_gpu, gpu_src = gpu_kw(gpu_type)
    sites = [site(loc, gpus, gpu_type, pue, utilisation, flexible_share, now) for loc in locations]
    costed = [s for s in sites if s["energy"]]
    cheapest = min(costed, key=lambda s: s["energy"]["cost_flex_eur"])["location"] if costed else None
    t = data.as_utc(now) if now is not None else compute.clock()
    note = (
        f"Estimate for {gpus:,} {gpu_type.upper()} GPUs at {utilisation:.0%} utilisation, PUE {pue:g}, {flexible_share:.0%} of work movable within the day. "
        f"{gpu_src}; power is taken as linear in utilisation, which understates idle draw. Default PUE is Uptime Institute's 2025 European average "
        "(1.50); utilisation and flexible share are our assumptions. Costs are wholesale energy at the trailing year's prices (modelled, not a quote): "
        "no network charges, levies, taxes or power-purchase terms. Carbon uses modelled consumption-based intensity; its cost prices the tonnes at the "
        "EU ETS allowance price and is already part of the power price, so do not add it to the energy cost. Moving flexible work to cheap hours can "
        "raise or lower carbon; both are shown."
    )
    return {"generated_at": t.to_pydatetime(), "gpus": gpus, "gpu_type": gpu_type, "kw_per_gpu": per_gpu, "pue": pue, "utilisation": utilisation,
            "flexible_share": flexible_share, "eur_per_gbp": EUR_PER_GBP, "sites": sites, "cheapest_site": cheapest, "note": note}
