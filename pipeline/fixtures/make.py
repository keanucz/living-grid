"""Regenerates the fixture parquet files: 6 zones, 48 h. Run: uv run python -m pipeline.fixtures.make"""

import numpy as np
import pandas as pd

from pipeline import schemas
from pipeline.fixtures import OUT

Z = schemas.ZONES
T0 = pd.Timestamp("2026-11-06 00:00", tz="UTC")
HOURS = pd.date_range(T0, periods=48, freq="h")
FUTURE = pd.date_range(T0 + pd.Timedelta(hours=48), periods=24, freq="h")
NOW = T0 + pd.Timedelta(hours=48)
rng = np.random.default_rng(7)


def save(name, df):
    df = schemas.validate(df, name)
    p = OUT / f"{name}.parquet"
    p.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(p, index=False)


def actuals():
    spec = {
        "energycharts_price_da": ("price_da", "EUR/MWh", 80, 25),
        "energycharts_load": ("load", "MW", 30000, 4000),
        "energycharts_gen_wind": ("gen_wind", "MW", 6000, 3000),
        "energycharts_gen_gas": ("gen_gas", "MW", 5000, 1500),
        "carbonintensity_ci_gco2_kwh": ("ci_gco2_kwh", "gCO2/kWh", 180, 60),
    }
    for name, (series, unit, mu, sd) in spec.items():
        rows = []
        for z in Z:
            u = "GBP/MWh" if (series == "price_da" and z == "GB") else unit
            v = np.clip(mu + sd * rng.standard_normal(len(HOURS)), 0, None)
            rows.append(pd.DataFrame({"ts": HOURS, "zone": z, "series": series, "value": v, "unit": u}))
        save(f"actuals/{name}", pd.concat(rows, ignore_index=True))
    flow = pd.DataFrame(
        {"ts": HOURS, "zone": "GB", "series": "flow_NO2_GB", "value": 1200 + 100 * rng.standard_normal(48), "unit": "MW"}
    )
    save("actuals/energycharts_flow_NO2_GB", flow)


def forecasts():
    rows = []
    for z in Z:
        for h in range(1, 25):
            mid = 80 + 10 * rng.standard_normal()
            rows.append((NOW - pd.Timedelta(hours=1), z, "price_da", NOW + pd.Timedelta(hours=h - 1), h, mid - 15, mid, mid + 15, "stub-0"))
    log = pd.DataFrame(rows, columns=schemas.FORECAST_LOG.names)
    save("forecasts/log", log)
    save("forecasts/frozen_monday", log.assign(frozen_at=NOW - pd.Timedelta(hours=1)))


def features():
    rows = []
    for z in Z:
        for ts in FUTURE:
            r = {"ts": ts, "zone": z}
            for c in schemas.FEATURE_COLUMNS:
                r[c] = 0.0
            r.update(
                hour_of_day=ts.hour,
                day_of_week=ts.day_of_week,
                month=ts.month,
                price_lag_24h=80 + 10 * rng.standard_normal(),
                price_lag_168h=80 + 10 * rng.standard_normal(),
                load_fc_mw=30000 + 3000 * rng.standard_normal(),
                wind_speed_100m=8 + 3 * rng.standard_normal(),
                gas_ttf_eur_mwh=35.0,
                eua_eur_t=70.0,
                gas_marginal_share=0.5,
            )
            rows.append(r)
    save("features/latest", pd.DataFrame(rows))


def others():
    save(
        "carbon/consumption_intensity",
        pd.DataFrame(
            [
                {"ts": ts, "zone": z, "production_gco2_kwh": 120.0 + i * 20, "consumption_gco2_kwh": 150.0 + i * 15, "imports_share": 0.15}
                for i, z in enumerate(Z)
                for ts in HOURS
            ]
        ),
    )
    save(
        "weather/openmeteo_historical_forecast",
        pd.DataFrame(
            [
                {"ts": ts, "issued_at": T0, "zone": z, "point": f"{z}-0", "variable": "wind_speed_100m", "value": 8.0}
                for z in Z
                for ts in HOURS
            ]
        ),
    )
    save(
        "scores/scores",
        pd.DataFrame(
            [
                {"window_start": T0, "window_end": NOW, "zone": z, "target": "price_da", "metric": m, "model": mdl, "value": v, "n": 24}
                for z in Z
                for m, mdl, v in [("mae", "lgbm", 9.0), ("mae", "persistence", 12.0), ("coverage_p10_p90", "lgbm", 0.8)]
            ]
        ),
    )
    save(
        "backtest/walk_forward",
        pd.DataFrame(
            [
                {"fold": f, "zone": z, "target": "price_da", "model": m, "mae": mae, "coverage_p10_p90": 0.8, "n": 168}
                for f in range(3)
                for z in Z
                for m, mae in [("lgbm", 9.0), ("persistence", 12.0)]
            ]
        ),
    )
    save(
        "features/gas_marginal_share",
        pd.DataFrame(
            [{"zone": z, "hour_of_day": h, "month": 11, "share": 0.5} for z in Z for h in range(24)]
        ),
    )


if __name__ == "__main__":
    actuals()
    forecasts()
    features()
    others()
