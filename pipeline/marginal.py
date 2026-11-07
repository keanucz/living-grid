"""Share of hours in which gas sets the power price, per zone, UTC hour of day and month.

    uv run python -m pipeline.marginal

An hour counts as gas-marginal when gas generation is running (at least 10% of the zone's own 95th percentile
gas output, so it is a mix signal) and the day-ahead price sits within 0.8x to 1.5x of the CCGT marginal cost,
TTF / 0.5 efficiency + EUA x 0.37 t/MWh. The band is wide on the upside because older plants and peakers
cost more than a modern CCGT. These are estimates, not a market model.

Cells are shrunk toward their zone-hour average, then toward the zone average, then toward standard-estimate
priors, with pseudo-counts, so a thin history gives a smooth answer and no history gives the priors. The full
zone x 24 hours x 12 months grid is therefore always written, every share in [0, 1].

Outputs:
  data/features/gas_marginal_share.parquet       zone, hour_of_day, month, share (the shared schema; what
                                                 engine/interventions/passthrough.py and the feature build read)
  data/features/gas_marginal_share_meta.parquet  zone, n_hours, raw_share, basis ('estimated' or 'prior only'),
                                                 so screens can say how much of a figure is data and how much prior
"""

import numpy as np
import pandas as pd

from pipeline import cache, schemas, scoring

SHARE = "features/gas_marginal_share"
META = "features/gas_marginal_share_meta"
META_COLUMNS = ["zone", "n_hours", "raw_share", "basis"]

PRIOR = {"GB": 0.60, "NL": 0.65, "BE": 0.45, "DE-LU": 0.35, "FR": 0.15, "NO2": 0.03}
CCGT_EFFICIENCY = 0.5
CCGT_CO2_T_PER_MWH = 0.37
EUR_PER_GBP = 1.15
BAND = (0.8, 1.5)
GAS_RUNNING_FRACTION = 0.10
GAS_SERIES = ("gen_gas", "gen_fossil_gas")
K_ZONE, K_HOUR, K_CELL = 48.0, 24.0, 24.0


def _market_costs(markets: pd.DataFrame | None, hours: pd.DatetimeIndex) -> pd.Series | None:
    if markets is None or markets.empty:
        return None
    wide = markets.pivot_table(index="ts", columns="series", values="value")
    if "gas_ttf" not in wide:
        return None
    wide = wide.reindex(wide.index.union(hours)).ffill().bfill().reindex(hours)
    eua = wide["eua"] if "eua" in wide else pd.Series(0.0, index=hours)
    return wide["gas_ttf"] / CCGT_EFFICIENCY + eua.fillna(0.0) * CCGT_CO2_T_PER_MWH


def _empty() -> pd.DataFrame:
    return pd.DataFrame(
        {"ts": pd.Series(dtype="datetime64[ns, UTC]"), "zone": pd.Series(dtype=object), "marginal": pd.Series(dtype=float)}
    )


def gas_marginal_hours(actuals: pd.DataFrame, markets: pd.DataFrame | None) -> pd.DataFrame:
    """ts, zone, marginal (0/1) for every zone-hour with a price, a marginal cost and gas generation."""
    price = actuals[actuals["series"] == "price_da"]
    gas = actuals[actuals["series"].isin(GAS_SERIES)]
    if price.empty or gas.empty:
        return _empty()
    cost = _market_costs(markets, pd.DatetimeIndex(sorted(price["ts"].unique())))
    if cost is None:
        return _empty()
    p = price.assign(eur=np.where(price["unit"].str.startswith("GBP"), price["value"] * EUR_PER_GBP, price["value"]))
    g = gas.groupby(["ts", "zone"], as_index=False)["value"].max().rename(columns={"value": "gas_mw"})
    floor = GAS_RUNNING_FRACTION * g.groupby("zone")["gas_mw"].transform(lambda s: s.quantile(0.95))
    g["running"] = (g["gas_mw"] > 0) & (g["gas_mw"] >= floor)
    df = p[["ts", "zone", "eur"]].merge(g[["ts", "zone", "running"]], on=["ts", "zone"])
    df["mc"] = df["ts"].map(cost)
    df = df.dropna(subset=["eur", "mc"])
    ratio = df["eur"] / df["mc"]
    df["marginal"] = (df["running"] & (ratio >= BAND[0]) & (ratio <= BAND[1])).astype(float)
    return df[["ts", "zone", "marginal"]]


def _shrink(prior: float, sums: pd.Series, counts: pd.Series, k: float) -> pd.Series:
    return (k * prior + sums) / (k + counts)


def estimate(actuals: pd.DataFrame, markets: pd.DataFrame | None) -> tuple[pd.DataFrame, pd.DataFrame]:
    obs = gas_marginal_hours(actuals, markets)
    hours, months = range(24), range(1, 13)
    grid, meta = [], []
    for zone in schemas.ZONES:
        o = obs[obs["zone"] == zone]
        n, s = len(o), float(o["marginal"].sum())
        zone_share = (K_ZONE * PRIOR[zone] + s) / (K_ZONE + n)
        by_hour = o.groupby(o["ts"].dt.hour)["marginal"].agg(["sum", "count"]).reindex(hours, fill_value=0)
        hour_share = _shrink(zone_share, by_hour["sum"], by_hour["count"], K_HOUR)
        cell = o.groupby([o["ts"].dt.hour, o["ts"].dt.month])["marginal"].agg(["sum", "count"])
        cell = cell.reindex(pd.MultiIndex.from_product([hours, months]), fill_value=0)
        parent = hour_share.reindex(cell.index.get_level_values(0)).to_numpy()
        share = (K_CELL * parent + cell["sum"].to_numpy()) / (K_CELL + cell["count"].to_numpy())
        grid.append(
            pd.DataFrame(
                {
                    "zone": zone,
                    "hour_of_day": cell.index.get_level_values(0).astype("int32"),
                    "month": cell.index.get_level_values(1).astype("int32"),
                    "share": share,
                }
            )
        )
        meta.append({"zone": zone, "n_hours": n, "raw_share": s / n if n else float("nan"), "basis": "estimated" if n else "prior only"})
    return schemas.validate(pd.concat(grid, ignore_index=True), SHARE), pd.DataFrame(meta, columns=META_COLUMNS)


def load() -> pd.DataFrame:
    """The cached estimate, or the committed fixture when none has been written (offline demo)."""
    return schemas.validate(cache.read(SHARE), SHARE)


def _markets() -> pd.DataFrame | None:
    try:
        return cache.read("markets/gas_carbon")
    except FileNotFoundError:
        return None


def run() -> dict[str, int]:
    share, meta = estimate(scoring.load_actuals(), _markets())
    cache.write(SHARE, share)
    cache.write(META, meta)
    return {SHARE: len(share), META: len(meta)}


if __name__ == "__main__":
    print(run())
