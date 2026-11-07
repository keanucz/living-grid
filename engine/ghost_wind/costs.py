"""Assemble GET /unseen/ghost-wind: both curtailment estimates by region, NESO constraint costs and
Scottish boundary flows against their limits, plus the ghost_wind rows the publisher sends.

Constraint costs are about a week behind, so the response always carries the latest published days
up to `to` and says how old the newest one is. Boundary flows are NESO day-ahead forecasts.
"""

import pandas as pd

from engine.ghost_wind import boalf, weather_gap
from pipeline import cache, static

COSTS = "neso/constraint_costs"
FLOWS = "neso/boundary_flows"
METERED = "boalf/wind_metered"
WEATHER = ("weather/live_forecast", "weather/historical_forecast")
COST_DAYS = 14


def _read(name: str) -> pd.DataFrame | None:
    return boalf.read_live(name)


def _utc(t) -> pd.Timestamp:
    t = pd.Timestamp(t)
    return t.tz_localize("UTC") if t.tzinfo is None else t.tz_convert("UTC")


def load_weather() -> pd.DataFrame | None:
    frames = [f for f in (_read(n) for n in WEATHER) if f is not None]
    return pd.concat(frames, ignore_index=True) if frames else None


def centroids() -> dict[str, tuple[float, float]]:
    out = {}
    for region, geom in static.region_geometries().items():
        p = geom.representative_point()
        out[region] = (round(p.x, 3), round(p.y, 3))
    return out


def recent_costs(costs: pd.DataFrame | None, to) -> pd.DataFrame:
    """The last COST_DAYS published days on or before `to`."""
    if costs is None or costs.empty:
        return pd.DataFrame(columns=["date", "ts", "total_cost_gbp", "thermal_cost_gbp", "thermal_volume_mwh"])
    c = costs[pd.to_datetime(costs["ts"], utc=True) <= _utc(to)].sort_values("ts")
    return c.tail(COST_DAYS)


def cost_per_mwh(costs: pd.DataFrame) -> pd.Series:
    """Thermal constraint cost per MWh turned down, by GB day (estimated price of a curtailed MWh)."""
    vol = costs["thermal_volume_mwh"].abs()
    rate = (costs["thermal_cost_gbp"] / vol).where(vol > 0)
    return pd.Series(rate.to_numpy(), index=costs["date"].astype(str)).dropna()


def lag_days(costs: pd.DataFrame, to) -> float | None:
    if costs.empty:
        return None
    return round((_utc(to) - pd.to_datetime(costs["ts"], utc=True).max()).total_seconds() / 86400, 1)


def estimates(frm, to, bids=None, weather=None, metered=None) -> pd.DataFrame:
    """Both estimates as one long frame: ts, region, method, mwh."""
    parts = [boalf.estimate(frm, to, bids=bids)[["ts", "region", "method", "mwh"]]]
    if weather is not None and metered is not None:
        w = weather_gap.estimate(weather, metered)
        if len(w):
            ts = pd.to_datetime(w["ts"], utc=True)
            parts.append(w[(ts >= _utc(frm)) & (ts <= _utc(to))][["ts", "region", "method", "mwh"]])
    parts = [p for p in parts if len(p)]
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=["ts", "region", "method", "mwh"])


def build(frm, to, bids=None, weather=None, metered=None, costs=None, flows=None) -> dict:
    """The GhostWindResponse body. Inputs default to the cache; pass frames to override (tests, replay)."""
    frm, to = _utc(frm), _utc(to)
    bids = boalf.load_bids() if bids is None else bids
    weather = load_weather() if weather is None else weather
    metered = _read(METERED) if metered is None else metered
    costs = _read(COSTS) if costs is None else costs
    flows = _read(FLOWS) if flows is None else flows

    est = estimates(frm, to, bids, weather, metered)
    names = dict(zip(static.gb_region_keys()["region"], static.gb_region_keys()["name"], strict=True))
    cents = centroids()
    regions = []
    for region in sorted(set(est["region"]) | set(boalf.mapped_regions())):
        e = est[est["region"] == region]
        wide = e.pivot_table(index="ts", columns="method", values="mwh", aggfunc="sum").reindex(
            columns=[boalf.METHOD, weather_gap.METHOD]
        )
        series = [
            {"ts": ts, "boalf_mw": float(r[boalf.METHOD]) if pd.notna(r[boalf.METHOD]) else 0.0,
             "weather_gap_mw": float(r[weather_gap.METHOD]) if pd.notna(r[weather_gap.METHOD]) else 0.0}
            for ts, r in wide.sort_index().iterrows()
        ]
        regions.append({
            "region": region,
            "name": names.get(region, region),
            "centroid": cents.get(region, (0.0, 0.0)),
            "boalf_mwh": float(e.loc[e["method"] == boalf.METHOD, "mwh"].sum()),
            "weather_gap_mwh": float(e.loc[e["method"] == weather_gap.METHOD, "mwh"].sum()),
            "series": series,
            "kind": "estimated",
        })

    rc = recent_costs(costs, to)
    fl = pd.DataFrame(columns=["ts", "boundary", "flow_mw", "limit_mw"]) if flows is None else flows
    fts = pd.to_datetime(fl["ts"], utc=True)
    fl = fl[(fts >= frm) & (fts <= to)].sort_values(["ts", "boundary"])
    lag = lag_days(rc, to)

    has_gap = (est["method"] == weather_gap.METHOD).any()
    notes = ["Ghost wind is estimated from accepted bids on mapped Scottish wind units (an upper bound on "
             "constraint curtailment)" + (" and from weather-implied minus metered output (modelled, generic power curve)."
                                          if has_gap else ". The weather-gap estimate needs metered unit output, not yet available.")]
    if lag is not None:
        notes.append(f"Constraint costs are NESO actuals, newest {lag:g} days old.")
    if len(fl):
        notes.append("Boundary flows are NESO day-ahead forecasts.")
    return {
        "from": frm,
        "to": to,
        "regions": regions,
        "total_boalf_mwh": float(sum(r["boalf_mwh"] for r in regions)),
        "total_weather_gap_mwh": float(sum(r["weather_gap_mwh"] for r in regions)),
        "constraint_costs": [{"date": d, "gbp": float(g), "kind": "actual"} for d, g in zip(rc["date"], rc["total_cost_gbp"])],
        "constraint_cost_total_gbp": float(rc["total_cost_gbp"].sum()) if len(rc) else 0.0,
        "boundary_flows": [
            {"boundary": r.boundary, "ts": r.ts, "flow_mw": float(r.flow_mw), "limit_mw": float(r.limit_mw), "kind": "forecast"}
            for r in fl.itertuples()
        ],
        "note": " ".join(notes),
    }


def has_data(bids=None, costs=None, flows=None) -> bool:
    bids = boalf.load_bids() if bids is None else bids
    costs = _read(COSTS) if costs is None else costs
    flows = _read(FLOWS) if flows is None else flows
    return any(x is not None and len(x) for x in (bids, costs, flows))


def publish_rows(frm, to, bids=None, weather=None, metered=None, costs=None) -> pd.DataFrame:
    """ghost_wind rows for engine.publisher.publish_ghost_wind: ts, region, method, mwh, cost_gbp.

    cost_gbp prices each curtailed MWh at that GB day's thermal constraint cost per MWh, falling back
    to the latest published day, so it is an estimate.
    """
    est = estimates(frm, to, bids, weather, metered)
    costs = _read(COSTS) if costs is None else costs
    rates = cost_per_mwh(costs) if costs is not None and len(costs) else pd.Series(dtype=float)
    fallback = float(rates.iloc[-1]) if len(rates) else 0.0
    day = pd.to_datetime(est["ts"], utc=True).dt.tz_convert("Europe/London").dt.strftime("%Y-%m-%d")
    est = est.assign(cost_gbp=est["mwh"] * day.map(rates).fillna(fallback).to_numpy())
    return est[["ts", "region", "method", "mwh", "cost_gbp"]]
