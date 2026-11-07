"""Consumption-based carbon intensity: what a zone's electricity really carries once imports are counted.

    uv run python -m pipeline.carbon

Per hour, every traced zone i has a pool of electricity: its own generation P_i plus imports M_i. The pool
is consumed locally or exported, and exports carry the pool's intensity c_i. Emissions balance gives one
linear system for all zones at once (so flows that loop through several countries are handled):

    c_i * (P_i + M_i) = E_i + sum over exporters j of  import_ji * c_j

where E_i is local generation times standard emission factors (pipeline/emission_factors.py, estimates).
Imports from zones we do not trace use rough placeholder intensities. Zones with no generation data in an
hour are left out of that hour and treated like untraced zones by their neighbours.

Flows are net MW per link pair, combining both reporting sides (flow_a_b from a, and flow_b_a from b with
opposite sign) by averaging; positive flow_a_b means a exports to b.

Outputs:
  data/carbon/consumption_intensity.parquet  shared contract: production, consumption, imports_share
  data/carbon/import_contributions.parquet   ts, zone, from_zone, mw, source_gco2_kwh, contribution_gco2_kwh,
                                             basis (traced, estimated or local); per zone and hour the
                                             contributions sum to consumption_gco2_kwh, with from_zone == zone
                                             being local generation.
"""

import logging

import numpy as np
import pandas as pd

from pipeline import cache, emission_factors, schemas, scoring

log = logging.getLogger("pipeline.carbon")

CONSUMPTION = "carbon/consumption_intensity"
CONTRIBUTIONS = "carbon/import_contributions"
CONTRIBUTION_COLUMNS = ["ts", "zone", "from_zone", "mw", "source_gco2_kwh", "contribution_gco2_kwh", "basis"]


def _generation(actuals: pd.DataFrame):
    g = actuals[actuals["series"].str.startswith("gen_") & actuals["zone"].isin(schemas.ZONES)].copy()
    kinds = g["series"].map(emission_factors.classify)
    g = g[kinds.notna()]
    keys = kinds[kinds.notna()]
    g["factor"] = keys.map(lambda k: emission_factors.FACTORS[k[0]])
    unmapped = set(g.loc[~keys.map(lambda k: k[1]), "series"])
    g = g[g["value"].notna() & (g["value"] > 0)]
    g["emissions"] = g["value"] * g["factor"]
    out = g.groupby(["ts", "zone"]).agg(P=("value", "sum"), E=("emissions", "sum"))
    return out, unmapped


def _net_flows(actuals: pd.DataFrame) -> pd.DataFrame:
    """ts, src, dst, mw: net flow per ordered pair with mw > 0, averaged over both reporting sides."""
    f = actuals[actuals["series"].str.startswith("flow_") & ~actuals["series"].str.startswith("flow_net_")]
    if f.empty:
        return pd.DataFrame(columns=["ts", "src", "dst", "mw"])
    parts = f["series"].str.split("_", n=2, expand=True)
    f = f.assign(a=parts[1].map(lambda z: emission_factors.ALIASES.get(z, z)), b=parts[2].map(lambda z: emission_factors.ALIASES.get(z, z)))
    f = f[f["a"] != f["b"]]
    swap = f["a"] > f["b"]
    est = pd.DataFrame(
        {
            "ts": f["ts"],
            "lo": np.where(swap, f["b"], f["a"]),
            "hi": np.where(swap, f["a"], f["b"]),
            "lo_to_hi": np.where(swap, -f["value"], f["value"]),
        }
    )
    net = est.groupby(["ts", "lo", "hi"], as_index=False)["lo_to_hi"].mean()
    fwd = net[net["lo_to_hi"] > 0].rename(columns={"lo": "src", "hi": "dst", "lo_to_hi": "mw"})
    rev = net[net["lo_to_hi"] < 0].rename(columns={"hi": "src", "lo": "dst"}).assign(mw=lambda d: -d["lo_to_hi"])
    return pd.concat([fwd, rev[["ts", "src", "dst", "mw"]]], ignore_index=True)[["ts", "src", "dst", "mw"]]


def trace(actuals: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, set[str]]:
    """(consumption_intensity, import_contributions, unmapped generation series) for every hour with data."""
    gen, unmapped = _generation(actuals)
    flows = _net_flows(actuals)
    by_hour = {ts: g for ts, g in flows.groupby("ts")}
    cons_rows, contrib_rows = [], []
    for ts, hour in gen.groupby(level="ts"):
        hour = hour.droplevel("ts")
        zones = list(hour.index)
        pos = {z: i for i, z in enumerate(zones)}
        fl = by_hour.get(ts, flows.iloc[0:0])
        fl = fl[fl["dst"].isin(zones)]
        n = len(zones)
        pool = hour["P"].to_numpy(float).copy()
        A = np.zeros((n, n))
        rhs = hour["E"].to_numpy(float).copy()
        for src, dst, mw in zip(fl["src"], fl["dst"], fl["mw"], strict=True):
            i = pos[dst]
            pool[i] += mw
            if src in pos:
                A[i, pos[src]] -= mw
            else:
                rhs[i] += mw * emission_factors.external_intensity(src)
        A[np.diag_indices(n)] += pool
        c = np.linalg.solve(A, rhs)
        for z, i in pos.items():
            imports = float(pool[i] - hour.loc[z, "P"])
            cons_rows.append(
                {"ts": ts, "zone": z, "production_gco2_kwh": hour.loc[z, "E"] / hour.loc[z, "P"],
                 "consumption_gco2_kwh": c[i], "imports_share": imports / pool[i]}
            )
            contrib_rows.append(
                {"ts": ts, "zone": z, "from_zone": z, "mw": hour.loc[z, "P"], "source_gco2_kwh": hour.loc[z, "E"] / hour.loc[z, "P"],
                 "contribution_gco2_kwh": hour.loc[z, "E"] / pool[i], "basis": "local"}
            )
        for src_row, dst_row, mw in zip(fl["src"], fl["dst"], fl["mw"], strict=True):
            traced = src_row in pos
            ci = c[pos[src_row]] if traced else emission_factors.external_intensity(src_row)
            contrib_rows.append(
                {"ts": ts, "zone": dst_row, "from_zone": src_row, "mw": mw, "source_gco2_kwh": ci,
                 "contribution_gco2_kwh": mw * ci / pool[pos[dst_row]], "basis": "traced" if traced else "estimated"}
            )
    cons = pd.DataFrame(cons_rows, columns=schemas.CARBON.names)
    contrib = pd.DataFrame(contrib_rows, columns=CONTRIBUTION_COLUMNS)
    if len(cons):
        cons = schemas.validate(cons, CONSUMPTION)
    return cons.sort_values(["ts", "zone"]).reset_index(drop=True), contrib.sort_values(["ts", "zone", "from_zone"]).reset_index(drop=True), unmapped


def _merge(name: str, new: pd.DataFrame, key: list[str]) -> None:
    if cache.exists(name):
        new = pd.concat([pd.read_parquet(cache.path(name)), new], ignore_index=True)
    cache.write(name, new.drop_duplicates(key, keep="last").sort_values(key).reset_index(drop=True))


def run(since: pd.Timestamp | None = None) -> dict[str, int]:
    """Trace every cached hour, or only hours from `since` and merge them into the existing files."""
    actuals = scoring.load_actuals()
    if since is not None:
        actuals = actuals[actuals["ts"] >= pd.Timestamp(since)]
    cons, contrib, unmapped = trace(actuals)
    if since is None:
        cache.write(CONSUMPTION, cons)
        cache.write(CONTRIBUTIONS, contrib)
    else:
        _merge(CONSUMPTION, cons, ["ts", "zone"])
        _merge(CONTRIBUTIONS, contrib, ["ts", "zone", "from_zone"])
    if unmapped:
        log.warning("unrecognised generation series, counted at the 'other' factor: %s", sorted(unmapped))
    return {CONSUMPTION: len(cons), CONTRIBUTIONS: len(contrib)}


if __name__ == "__main__":
    print(run())
