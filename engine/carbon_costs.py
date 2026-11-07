"""What carbon adds to each MWh, who pays, and the gap to the UK government's carbon value.

Per zone: carbon cost per MWh = grid carbon intensity (tCO2/MWh) x the carbon price of the zone's scheme (UK ETS
monthly average UKA for GB, EU ETS allowance for the continent). Intensity is the consumption-based figure from
pipeline.carbon (modelled, average not marginal; imports are valued at the importer's own carbon price, a simplification).
The government's appraisal value of carbon (DESNZ, 2026, 2025 prices) is what society is told a tonne is worth;
the difference to the market-priced carbon is the unpriced gap.

Roll-ups: a typical household (Ofgem 2026 medium single-rate electricity use) and a flat data-centre load.
All of it is an estimate at the intensity and price shown, not a bill.
"""

import pandas as pd

from engine import data
from engine.interventions.base import EUR_PER_GBP
from pipeline import cache
from pipeline.ingest import uk_ets

APPRAISAL_GBP_PER_T = 316.9
APPRAISAL_SOURCE = ("DESNZ, Valuation of energy use and greenhouse gas emissions for appraisal (updated 2 Nov 2026): "
                    "carbon value for appraisal, 2026, £316.9/tCO2e in 2025 prices (Data Table 3 central series)")
HOUSEHOLD_KWH = 2500
HOUSEHOLD_SOURCE = "Ofgem, Review of typical domestic consumption values: decision (27 May 2026): medium electricity, single-rate, 2,500 kWh a year from 1 July 2026"
HOURS_PER_YEAR = 8760
DEFAULT_DC_MW = 10.0
INTENSITY = "carbon/consumption_intensity"
MARKETS = "markets/gas_carbon"
EUA_SOURCE = "EU ETS allowance (yfinance CO2.L, daily, EUR/t)"
AS_OF_TOLERANCE = pd.Timedelta(hours=6)
NOTE = ("Estimates. Carbon intensity is modelled (standard emission factors, average not marginal). Carbon cost is "
        "intensity x the zone's carbon price; imports are valued at the importer's own price. The appraisal value is "
        "the UK government's social value of a tonne, not a market price; continental figures use a fixed £/€ rate.")


def _read(name: str) -> pd.DataFrame | None:
    try:
        return cache.read(name) if cache.offline() else (cache.read_file(cache.path(name)) if cache.exists(name) else None)
    except FileNotFoundError:
        return None


def eua() -> pd.Series | None:
    m = _read(MARKETS)
    if m is None:
        return None
    m = m[m["series"] == "eua"]
    return None if m.empty else m.set_index("ts")["value"].sort_index()


def price_for(zone: str, at: pd.Timestamp, uka: pd.DataFrame | None = None, eua_series: pd.Series | None = None) -> dict | None:
    """The carbon price in the zone's currency at `at` (newest observation at or before it), with source and date."""
    if zone == "GB":
        u = uk_ets.load() if uka is None else uka
        u = u[u["ts"] <= at]
        if u.empty:
            return None
        r = u.iloc[-1]
        return {"value": float(r["value"]), "currency": "GBP", "scheme": "UK ETS", "as_of": r["ts"].to_pydatetime(),
                "basis": "monthly average of the UKA December futures", "source": uk_ets.SOURCE}
    e = eua() if eua_series is None else eua_series
    if e is None or e.empty:
        return None
    e = e[e.index <= at]
    if e.empty:
        return None
    return {"value": float(e.iloc[-1]), "currency": "EUR", "scheme": "EU ETS", "as_of": e.index[-1].to_pydatetime(),
            "basis": "daily settlement-style price", "source": EUA_SOURCE}


def _latest(ci: pd.DataFrame, at: pd.Timestamp) -> pd.DataFrame:
    ci = ci[(ci["ts"] <= at) & (ci["ts"] > at - AS_OF_TOLERANCE)]
    return ci.sort_values("ts").groupby("zone").tail(1).set_index("zone")


def build(at=None, data_centre_mw: float = DEFAULT_DC_MW, ci: pd.DataFrame | None = None, uka: pd.DataFrame | None = None,
          eua_series: pd.Series | None = None) -> dict:
    if ci is None:
        ci = _read(INTENSITY)
    if ci is None or ci.empty:
        raise LookupError("no carbon intensity data yet")
    at = data.as_utc(at) if at is not None else ci["ts"].max()
    rows = _latest(ci, at)
    if rows.empty:
        raise LookupError(f"no carbon intensity at or before {at}")
    zones = []
    for zone in data.ZONES:
        if zone not in rows.index:
            continue
        r = rows.loc[zone]
        t_mwh = float(r["consumption_gco2_kwh"]) / 1000
        price = price_for(zone, r["ts"], uka, eua_series)
        cur = "GBP" if zone == "GB" else "EUR"
        fx = 1.0 if cur == "GBP" else EUR_PER_GBP
        appraisal = APPRAISAL_GBP_PER_T * fx
        item = {"zone": zone, "name": data.NAMES.get(zone, zone), "ts": r["ts"].to_pydatetime(), "currency": cur,
                "consumption_gco2_kwh": round(float(r["consumption_gco2_kwh"]), 1),
                "production_gco2_kwh": round(float(r["production_gco2_kwh"]), 1),
                "carbon_price_per_t": None, "carbon_price": price, "carbon_cost_per_mwh": None,
                "appraisal_value_per_t": round(appraisal, 1), "appraisal_cost_per_mwh": round(t_mwh * appraisal, 2),
                "unpriced_gap_per_mwh": None, "household_per_year": None, "data_centre_per_year": None,
                "household_unpriced_per_year": None, "data_centre_unpriced_per_year": None}
        if price is not None:
            cost = t_mwh * price["value"]
            gap = t_mwh * appraisal - cost
            item.update({
                "carbon_price_per_t": round(price["value"], 2), "carbon_cost_per_mwh": round(cost, 2),
                "unpriced_gap_per_mwh": round(gap, 2),
                "household_per_year": round(cost * HOUSEHOLD_KWH / 1000, 2),
                "household_unpriced_per_year": round(gap * HOUSEHOLD_KWH / 1000, 2),
                "data_centre_per_year": round(cost * data_centre_mw * HOURS_PER_YEAR),
                "data_centre_unpriced_per_year": round(gap * data_centre_mw * HOURS_PER_YEAR),
            })
        zones.append(item)
    return {
        "at": at.to_pydatetime(), "zones": zones,
        "household": {"kwh_per_year": HOUSEHOLD_KWH, "source": HOUSEHOLD_SOURCE},
        "data_centre": {"mw": data_centre_mw, "hours_per_year": HOURS_PER_YEAR, "note": "flat load all year, an assumption you can change"},
        "appraisal": {"gbp_per_t": APPRAISAL_GBP_PER_T, "price_base": "2025 prices", "source": APPRAISAL_SOURCE},
        "eur_per_gbp": EUR_PER_GBP,
        "kind": "estimated", "note": NOTE,
    }
