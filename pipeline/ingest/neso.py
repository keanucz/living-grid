"""NESO data portal: daily constraint costs and day-ahead boundary flows against limits.

Constraint costs (dataset constraint-breakdown) are published about a week late: the newest day is
roughly 7 to 10 days old. Every row carries fetched_at so the lag is on record and
latest_lag_days() reports it. Boundary flows (day-ahead-constraint-flows-and-limits) are NESO's
day-ahead forecasts, not metered values.

Outputs (local schemas, since neither is zonal):
  data/neso/constraint_costs.parquet  date (GB local day), ts (that day's start, UTC), cost and volume per
                                      category, total_cost_gbp, fetched_at
  data/neso/boundary_flows.parquet    ts (hour, UTC), boundary, flow_mw (hour mean), limit_mw (hour minimum),
                                      utilisation, fetched_at
  data/actuals/neso_constraint_cost_gbp  GB daily total as the shared series constraint_cost_gbp
"""

import re
import time

import httpx
import pandas as pd

from pipeline import cache, schemas

API = "https://api.neso.energy/api/3/action"
COSTS = "neso/constraint_costs"
FLOWS = "neso/boundary_flows"
FLOW_RESOURCE = "38a18ec1-9e40-465d-93fb-301e80fd1352"

COST_COLUMNS = {
    "Thermal constraints cost": "thermal_cost_gbp",
    "Voltage constraints cost": "voltage_cost_gbp",
    "Increasing system inertia cost": "inertia_cost_gbp",
    "Reducing largest loss cost": "largest_loss_cost_gbp",
    "Thermal constraints volume": "thermal_volume_mwh",
    "Voltage constraints volume": "voltage_volume_mwh",
    "Increasing system inertia volume": "inertia_volume_mwh",
    "Reducing largest loss volume": "largest_loss_volume_mwh",
}
COST_ONLY = [c for c in COST_COLUMNS.values() if c.endswith("_gbp")]
# NESO renames boundary groups over time; map them to stable labels. The Scottish boundaries only.
BOUNDARIES = {
    "SSEN_S": "SSEN-S",
    "SSE_SP": "SSE-SP",
    "SSE_SP2": "SSE-SP",
    "SSHARN": "SSHARN",
    "SSHARN3": "SSHARN",
    "SSHARN7": "SSHARN",
    "SCOTEX": "SCOTEX",
}
LOCAL = "Europe/London"


def _call(client: httpx.Client, action: str, params: dict) -> dict:
    for attempt in range(4):
        r = client.get(f"{API}/{action}", params=params)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(float(r.headers.get("Retry-After", 2**attempt)))
            continue
        r.raise_for_status()
        body = r.json()
        if not body.get("success"):
            raise RuntimeError(f"NESO {action} failed: {body.get('error')}")
        return body["result"]
    r.raise_for_status()


def _sql(client: httpx.Client, sql: str) -> list[dict]:
    return _call(client, "datastore_search_sql", {"sql": sql})["records"]


def _cost_resources(client: httpx.Client, start: pd.Timestamp, end: pd.Timestamp) -> list[str]:
    """Resources are financial years named 'Constraint Breakdown 2026-2027' (April to March)."""
    ids = []
    for res in _call(client, "package_show", {"id": "constraint-breakdown"})["resources"]:
        m = re.search(r"(\d{4})-(\d{4})$", res["name"])
        if m and pd.Timestamp(f"{m[1]}-04-01") <= end.tz_localize(None) and pd.Timestamp(f"{m[2]}-04-01") > start.tz_localize(None):
            ids.append(res["id"])
    return ids


def _utc(x) -> pd.Timestamp:
    x = pd.Timestamp(x)
    return x.tz_localize("UTC") if x.tzinfo is None else x.tz_convert("UTC")


def fetch_costs(start, end, client: httpx.Client, now=None) -> pd.DataFrame:
    start, end = _utc(start), _utc(end)
    fetched = pd.Timestamp.now(tz="UTC") if now is None else _utc(now)
    rows = []
    for rid in _cost_resources(client, start, end):
        rows += _sql(
            client,
            f'SELECT * FROM "{rid}" WHERE "Date" >= \'{start:%Y-%m-%d}\' AND "Date" <= \'{end:%Y-%m-%d}\' ORDER BY "Date"',
        )
    cols = ["date", "ts", *COST_COLUMNS.values(), "total_cost_gbp", "fetched_at"]
    if not rows:
        return pd.DataFrame(columns=cols)
    df = pd.DataFrame(rows).rename(columns=COST_COLUMNS)
    day = pd.to_datetime(df["Date"].astype(str).str[:10])
    df["date"] = day.dt.strftime("%Y-%m-%d")
    df["ts"] = day.dt.tz_localize(LOCAL).dt.tz_convert("UTC")
    for c in COST_COLUMNS.values():
        df[c] = df[c].astype(float)
    df["total_cost_gbp"] = df[COST_ONLY].sum(axis=1)
    df["fetched_at"] = fetched
    return df.drop_duplicates("date", keep="last")[cols].sort_values("ts").reset_index(drop=True)


def fetch_boundaries(start, end, client: httpx.Client, now=None) -> pd.DataFrame:
    start, end = _utc(start), _utc(end)
    fetched = pd.Timestamp.now(tz="UTC") if now is None else _utc(now)
    # Pad a day each side: timestamps are GB local time, converted to UTC below.
    a, b = start.tz_convert(LOCAL) - pd.Timedelta(days=1), end.tz_convert(LOCAL) + pd.Timedelta(days=1)
    names = ",".join(f"'{n}'" for n in BOUNDARIES)
    rows = _sql(
        client,
        f'SELECT * FROM "{FLOW_RESOURCE}" WHERE "Constraint Group" IN ({names}) '
        f"AND \"Date_ Time GMT_BST\" >= '{a:%Y-%m-%dT00:00:00}' AND \"Date_ Time GMT_BST\" <= '{b:%Y-%m-%dT23:59:59}' "
        'ORDER BY "Constraint Group", "Date_ Time GMT_BST"',
    )
    cols = ["ts", "boundary", "flow_mw", "limit_mw", "utilisation", "fetched_at"]
    if not rows:
        return pd.DataFrame(columns=cols)
    df = pd.DataFrame(rows)
    df["boundary"] = df["Constraint Group"].map(BOUNDARIES)
    local = pd.to_datetime(df["Date_ Time GMT_BST"])
    df["flow_mw"] = df["Flow_MW"].astype(float)
    df["limit_mw"] = df["Limit_MW"].astype(float)
    # On the clock-change night NESO lists each repeated half-hour twice, BST pass first, in _id order.
    df = df.assign(local=local).sort_values(["Constraint Group", "_id"])
    first_pass = (df.groupby(["Constraint Group", "local"]).cumcount() == 0).to_numpy()
    df["ts"] = df["local"].dt.tz_localize(LOCAL, ambiguous=first_pass, nonexistent="shift_forward").dt.tz_convert("UTC")
    df["ts"] = df["ts"].dt.floor("h")
    df = df.groupby(["ts", "boundary"], as_index=False).agg(flow_mw=("flow_mw", "mean"), limit_mw=("limit_mw", "min"))
    df = df[(df["ts"] >= start.floor("h")) & (df["ts"] <= end)]
    df["utilisation"] = df["flow_mw"] / df["limit_mw"].where(df["limit_mw"] > 0)
    df["fetched_at"] = fetched
    return df[cols].reset_index(drop=True)


def _client(client):
    if cache.offline():
        raise RuntimeError("LG_OFFLINE is set: NESO ingest needs the network")
    return client or httpx.Client(timeout=90), client is None


def fetch(start, end, client: httpx.Client | None = None) -> pd.DataFrame:
    """Ingest-registry entry point: daily GB constraint cost total as constraint_cost_gbp actuals."""
    client, own = _client(client)
    try:
        costs = fetch_costs(start, end, client)
    finally:
        if own:
            client.close()
    return _as_actuals(costs)


def _as_actuals(costs: pd.DataFrame) -> pd.DataFrame:
    df = pd.DataFrame(
        {"ts": costs["ts"], "zone": "GB", "series": "constraint_cost_gbp", "value": costs["total_cost_gbp"], "unit": "GBP"}
    )
    return schemas.validate(df, "actuals/neso_constraint_cost_gbp")


def _merge(name: str, new: pd.DataFrame, key: list[str]) -> None:
    if cache.exists(name):
        new = pd.concat([pd.read_parquet(cache.path(name)), new], ignore_index=True)
    cache.write(name, new.drop_duplicates(key, keep="last").sort_values(key).reset_index(drop=True))


def run(start, end, client: httpx.Client | None = None) -> list[str]:
    client, own = _client(client)
    try:
        costs = fetch_costs(start, end, client)
        flows = fetch_boundaries(start, end, client)
    finally:
        if own:
            client.close()
    written = []
    if len(costs):
        _merge(COSTS, costs, ["ts"])
        _merge("actuals/neso_constraint_cost_gbp", _as_actuals(costs), ["ts", "zone"])
        written += [COSTS, "actuals/neso_constraint_cost_gbp"]
    if len(flows):
        _merge(FLOWS, flows, ["ts", "boundary"])
        written.append(FLOWS)
    return written


def latest_lag_days(costs: pd.DataFrame) -> float:
    """Days between the newest published constraint-cost day and when it was fetched."""
    last = costs.sort_values("ts").iloc[-1]
    return (last["fetched_at"] - last["ts"]).total_seconds() / 86400
