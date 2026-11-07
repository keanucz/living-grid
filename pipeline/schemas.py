"""Shared parquet contracts. A writes, B reads. Changing anything here needs the team's agreement."""

import re

import pandas as pd
import pyarrow as pa

ZONES = ["GB", "FR", "DE-LU", "NL", "BE", "NO2"]
TARGETS = ["gb_system_price", "price_da", "load", "wind"]
GROUPS = ["wind", "solar", "demand", "gas", "carbon", "imports", "time_of_day"]

TS = pa.timestamp("us", tz="UTC")

ACTUALS = pa.schema(
    [("ts", TS), ("zone", pa.string()), ("series", pa.string()), ("value", pa.float64()), ("unit", pa.string())]
)

FORECAST_LOG = pa.schema(
    [
        ("made_at", TS),
        ("zone", pa.string()),
        ("target", pa.string()),
        ("ts", TS),
        ("horizon_h", pa.int32()),
        ("p10", pa.float64()),
        ("p50", pa.float64()),
        ("p90", pa.float64()),
        ("model_version", pa.string()),
    ]
)

FROZEN_MONDAY = FORECAST_LOG.append(pa.field("frozen_at", TS))

CARBON = pa.schema(
    [
        ("ts", TS),
        ("zone", pa.string()),
        ("production_gco2_kwh", pa.float64()),
        ("consumption_gco2_kwh", pa.float64()),
        ("imports_share", pa.float64()),
    ]
)

WEATHER = pa.schema(
    [
        ("ts", TS),
        ("issued_at", TS),
        ("zone", pa.string()),
        ("point", pa.string()),
        ("variable", pa.string()),
        ("value", pa.float64()),
    ]
)

SCORES = pa.schema(
    [
        ("window_start", TS),
        ("window_end", TS),
        ("zone", pa.string()),
        ("target", pa.string()),
        ("metric", pa.string()),
        ("model", pa.string()),
        ("value", pa.float64()),
        ("n", pa.int64()),
    ]
)

WALK_FORWARD = pa.schema(
    [
        ("fold", pa.int32()),
        ("zone", pa.string()),
        ("target", pa.string()),
        ("model", pa.string()),
        ("mae", pa.float64()),
        ("coverage_p10_p90", pa.float64()),
        ("n", pa.int64()),
    ]
)

# data/backtest/bot_league.parquet (pipeline.backtest): walk-forward bot results with pinball loss. Not in SCHEMAS:
# SCHEMAS entries need an offline fixture, and nothing reads this table yet.
BOT_LEAGUE = pa.schema(
    [
        ("fold", pa.int32()),
        ("zone", pa.string()),
        ("target", pa.string()),
        ("model", pa.string()),
        ("mae", pa.float64()),
        ("pinball", pa.float64()),
        ("coverage_p10_p90", pa.float64()),
        ("n", pa.int64()),
    ]
)

# Metered (B1610, else PN) hourly output per mapped Scottish wind BM unit; the metered side of ghost wind estimate 2.
WIND_METERED = pa.schema([("ts", TS), ("bm_unit", pa.string()), ("mwh", pa.float64()), ("source", pa.string())])

GAS_MARGINAL_SHARE = pa.schema(
    [("zone", pa.string()), ("hour_of_day", pa.int32()), ("month", pa.int32()), ("share", pa.float64())]
)

# Carbon Intensity API regional model (modelled), per GB region letter A to P.
REGIONAL_CARBON = pa.schema(
    [("ts", TS), ("region", pa.string()), ("region_id", pa.int64()), ("intensity_gco2_kwh", pa.float64()),
     ("index", pa.string())]
)
REGIONAL_MIX = pa.schema([("ts", TS), ("region", pa.string()), ("fuel", pa.string()), ("perc", pa.float64())])

# Feature column -> plain-English group used for explanations.
FEATURE_GROUPS = {
    "wind_speed_100m": "wind",
    "wind_gen_fc_mw": "wind",
    "wind_gen_lag_24h": "wind",
    "solar_irradiance_wm2": "solar",
    "solar_gen_fc_mw": "solar",
    "load_fc_mw": "demand",
    "temperature_c": "demand",
    "residual_load_mw": "demand",
    "price_lag_24h": "demand",
    "price_lag_168h": "demand",
    "gas_ttf_eur_mwh": "gas",
    "gas_marginal_share": "gas",
    "eua_eur_t": "carbon",
    "import_net_mw": "imports",
    "import_ci_gco2_kwh": "imports",
    "hour_of_day": "time_of_day",
    "day_of_week": "time_of_day",
    "month": "time_of_day",
}
FEATURE_COLUMNS = list(FEATURE_GROUPS)
INT_FEATURES = {"hour_of_day", "day_of_week", "month"}

FEATURES_LATEST = pa.schema(
    [("ts", TS), ("zone", pa.string())]
    + [(c, pa.int32() if c in INT_FEATURES else pa.float64()) for c in FEATURE_COLUMNS]
)

EXPLANATION_COLUMNS = ["ts", "zone", "base"] + GROUPS

# Actuals `series` vocabulary. gen_<fuel>, flow_<from>_<to> are patterns.
SERIES = [
    "price_da",
    "system_price",
    "market_index",
    "load",
    "load_forecast",
    "boalf_mwh",
    "constraint_cost_gbp",
    "boundary_flow_mw",
    "ci_gco2_kwh",
    "agile_p_kwh",
]
_SERIES_RE = re.compile(
    r"^(" + "|".join(SERIES) + r"|gen_[a-z0-9_]+|flow_[A-Za-z0-9-]+_[A-Za-z0-9-]+)$"
)

SCHEMAS = {
    "actuals": ACTUALS,
    "forecasts/log": FORECAST_LOG,
    "forecasts/frozen_monday": FROZEN_MONDAY,
    "features/latest": FEATURES_LATEST,
    "features/gas_marginal_share": GAS_MARGINAL_SHARE,
    "carbon/consumption_intensity": CARBON,
    "weather": WEATHER,
    "boalf/wind_metered": WIND_METERED,
    "carbon_intensity/regional": REGIONAL_CARBON,
    "carbon_intensity/regional_mix": REGIONAL_MIX,
    "scores/scores": SCORES,
    "backtest/walk_forward": WALK_FORWARD,
}


def schema_for(name: str) -> pa.Schema:
    if name in SCHEMAS:
        return SCHEMAS[name]
    if name.startswith("actuals/"):
        return ACTUALS
    if name.startswith("weather/"):
        return WEATHER
    raise KeyError(f"no schema for {name!r}")


def validate(df: pd.DataFrame, name: str) -> pd.DataFrame:
    """Raise ValueError if df breaks the contract; return df cast to the schema's dtypes."""
    schema = schema_for(name)
    missing = [f.name for f in schema if f.name not in df.columns]
    if missing:
        raise ValueError(f"{name}: missing columns {missing}")
    for f in schema:
        if pa.types.is_timestamp(f.type):
            s = df[f.name]
            if not isinstance(s.dtype, pd.DatetimeTZDtype) or str(s.dt.tz) != "UTC":
                raise ValueError(f"{name}: {f.name} must be timezone-aware UTC")
    try:
        table = pa.Table.from_pandas(df[schema.names], schema=schema, preserve_index=False, safe=True)
    except (pa.ArrowInvalid, pa.ArrowTypeError) as e:
        raise ValueError(f"{name}: {e}") from e
    out = table.to_pandas()
    for f in schema:
        if out[f.name].isna().any():
            raise ValueError(f"{name}: {f.name} has nulls")
    if name.startswith("actuals"):
        bad = sorted(set(out.loc[~out["series"].str.match(_SERIES_RE), "series"]))
        if bad:
            raise ValueError(f"{name}: unknown series {bad}")
    if name in ("forecasts/log", "forecasts/frozen_monday"):
        if not ((out["p10"] <= out["p50"]) & (out["p50"] <= out["p90"])).all():
            raise ValueError(f"{name}: quantiles must satisfy p10 <= p50 <= p90")
        if not out["target"].isin(TARGETS).all():
            raise ValueError(f"{name}: unknown target")
    if "zone" in out and not out["zone"].isin(ZONES).all():
        raise ValueError(f"{name}: unknown zone")
    return out
