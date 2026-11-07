"""Map contract DataFrames to the reducer row shapes in spacetime/README.md. Pure functions."""

import json
import math

import pandas as pd

EPOCH = pd.Timestamp(0, tz="UTC")


def micros(s: pd.Series) -> pd.Series:
    s = pd.to_datetime(s, utc=True)
    return ((s - EPOCH) // pd.Timedelta(microseconds=1)).astype("int64")


def _records(df: pd.DataFrame, float_cols: list[str]) -> list[dict]:
    """Drop rows with non-finite floats (SpacetimeDB rejects NaN) and return plain-Python dicts."""
    if float_cols:
        ok = df[float_cols].apply(lambda c: c.map(lambda v: v is not None and math.isfinite(v))).all(axis=1)
        df = df[ok]
    return json.loads(df.to_json(orient="records"))


def zones(df: pd.DataFrame) -> list[dict]:
    """df: code, name, currency, lat, lon."""
    return _records(df[["code", "name", "currency", "lat", "lon"]].astype({"lat": float, "lon": float}), ["lat", "lon"])


def actuals(df: pd.DataFrame) -> list[dict]:
    out = pd.DataFrame({
        "ts_us": micros(df["ts"]), "zone": df["zone"], "series": df["series"],
        "value": df["value"].astype(float), "unit": df["unit"],
    })
    return _records(out, ["value"])


def forecasts(df: pd.DataFrame) -> list[dict]:
    out = pd.DataFrame({
        "made_at_us": micros(df["made_at"]), "zone": df["zone"], "target": df["target"],
        "ts_us": micros(df["ts"]), "horizon_h": df["horizon_h"].astype(int),
        "p10": df["p10"].astype(float), "p50": df["p50"].astype(float), "p90": df["p90"].astype(float),
        "model_version": df["model_version"],
    })
    return _records(out, ["p10", "p50", "p90"])


def scores(df: pd.DataFrame) -> list[dict]:
    out = pd.DataFrame({
        "window_start_us": micros(df["window_start"]), "window_end_us": micros(df["window_end"]),
        "zone": df["zone"], "target": df["target"], "metric": df["metric"], "model": df["model"],
        "value": df["value"].astype(float), "n": df["n"].astype(int),
    })
    return _records(out, ["value"])


def carbon(df: pd.DataFrame) -> list[dict]:
    cols = ["production_gco2_kwh", "consumption_gco2_kwh", "imports_share"]
    out = pd.DataFrame({"ts_us": micros(df["ts"]), "zone": df["zone"], **{c: df[c].astype(float) for c in cols}})
    return _records(out, cols)


def ghost_wind(df: pd.DataFrame) -> list[dict]:
    """df: ts, region, method ('boalf' | 'weather_gap'), mwh, cost_gbp."""
    out = pd.DataFrame({
        "ts_us": micros(df["ts"]), "region": df["region"], "method": df["method"],
        "mwh": df["mwh"].astype(float), "cost_gbp": df["cost_gbp"].astype(float),
    })
    return _records(out, ["mwh", "cost_gbp"])


def batteries(df: pd.DataFrame) -> list[dict]:
    """df: zone, strategy, soc_mwh, profit, currency, share_of_perfect."""
    cols = ["soc_mwh", "profit", "share_of_perfect"]
    out = df[["zone", "strategy", "currency"]].assign(**{c: df[c].astype(float) for c in cols})
    return _records(out, cols)


def battery_actions(df: pd.DataFrame) -> list[dict]:
    """df: ts, zone, strategy, action ('charge' | 'hold' | 'discharge'), mw, soc_mwh, price."""
    cols = ["mw", "soc_mwh", "price"]
    out = pd.DataFrame({
        "ts_us": micros(df["ts"]), "zone": df["zone"], "strategy": df["strategy"], "action": df["action"],
        **{c: df[c].astype(float) for c in cols},
    })
    return _records(out, cols)


def intervention_args(result: dict, slot: str = "main", triggered_by: str = "engine") -> list:
    """Positional args for set_intervention from a POST /intervene result (engine.schemas.InterventionResult)."""
    req = result.get("request") or {}
    return [
        slot,
        str(req.get("type", "")),
        str(result.get("target") or req.get("target") or ""),
        float(result.get("applied_magnitude") if result.get("applied_magnitude") is not None else req.get("magnitude") or 0),
        int(result.get("applied_hours") if result.get("applied_hours") is not None else req.get("hours") or 0),
        triggered_by,
        float((result.get("cost_total_gbp") or {}).get("p50", 0.0)),
        "GBP",
        str((result.get("explanation") or {}).get("sentence", "")),
        json.dumps(result, default=str, separators=(",", ":")),
    ]


# Primary keys exactly as the publish reducers build them (spacetime/module/src/reducers/publish.ts),
# by publisher kind: (table, key column, key of one mapped row).
KEYS = {
    "zones": ("zone", "code", lambda r: r["code"]),
    "actuals": ("actual", "key", lambda r: f"{r['zone']}|{r['series']}|{r['ts_us']}"),
    "forecasts": ("forecast", "key", lambda r: f"{r['zone']}|{r['target']}|{r['ts_us']}|{r['made_at_us']}"),
    "scores": ("score", "key", lambda r: f"{r['zone']}|{r['target']}|{r['metric']}|{r['model']}"),
    "carbon": ("carbon", "key", lambda r: f"{r['zone']}|{r['ts_us']}"),
    "ghost_wind": ("ghost_wind", "key", lambda r: f"{r['region']}|{r['method']}|{r['ts_us']}"),
    "batteries": ("battery", "key", lambda r: f"{r['zone']}|{r['strategy']}"),
    "battery_actions": ("battery_action", "key", lambda r: f"{r['zone']}|{r['strategy']}|{r['ts_us']}"),
}
