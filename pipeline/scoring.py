"""Live scorer: forecast log versus real outcomes, against two naive baselines.

    uv run python -m pipeline.scoring

A forecast is scored only if its outcome time is strictly after made_at. Day-ahead prices are public from
12:00 UTC the day before delivery, so a price_da forecast made after that is not scored either. Both
baselines use only values that were fully known at made_at:
  persistence  the last completed hour before made_at
  yesterday    the same hour a whole number of days earlier (1 day up to 23 h ahead, 2 days up to 47 h, ...)
The model and the baselines are compared on the same rows, so a baseline gap never flatters either side.

Writes data/scores/scores.parquet (one row per zone, target, model and metric) and data/scores/overall.parquet
(per target, no zone: GB prices are in GBP and the rest in EUR, so overall figures are unitless).
Metrics: mae, coverage_p10_p90, mae_ratio_vs_persistence (model MAE over persistence MAE; below 1 beats it),
forecasts_scored (every forecast with an outcome, whether or not a baseline exists).
"""

import numpy as np
import pandas as pd

from pipeline import cache, forecast_log, schemas

SCORES = "scores/scores"
OVERALL = "scores/overall"
OVERALL_COLUMNS = ["window_start", "window_end", "target", "metric", "model", "value", "n"]
TARGET_SERIES = {"price_da": "price_da", "gb_system_price": "system_price", "load": "load", "wind": "gen_wind"}
DAY_AHEAD_PUBLIC_HOUR_UTC = 12
SOURCE_PRIORITY = ["nordpool", "energy_charts", "elexon"]
BASELINES = ("persistence", "yesterday")


def _names(base) -> set[str]:
    return {f"actuals/{p.stem}" for p in (base / "actuals").glob("*.parquet")}


def _rank(name: str) -> int:
    source = name.removeprefix("actuals/")
    return next((i for i, s in enumerate(SOURCE_PRIORITY) if source.startswith(s)), len(SOURCE_PRIORITY))


def load_actuals() -> pd.DataFrame:
    """Cached actuals, de-duplicated by source priority; fixtures only when nothing real is cached."""
    names = _names(cache.DATA) or _names(cache.FIXTURES)
    frames = [cache.read(n) for n in sorted(names, key=lambda n: (_rank(n), n))]
    if not frames:
        return pd.DataFrame(columns=schemas.ACTUALS.names)
    return pd.concat(frames, ignore_index=True).drop_duplicates(["ts", "zone", "series"], keep="first")


def attach_outcomes(log: pd.DataFrame, actuals: pd.DataFrame) -> pd.DataFrame:
    """Log rows with actual, persistence and yesterday columns (NaN where unknown) and a `valid` flag."""
    df = log.copy().reset_index(drop=True)
    idx = actuals.set_index(["zone", "series", "ts"])["value"]
    idx = idx[~idx.index.duplicated(keep="first")]
    series = df["target"].map(TARGET_SERIES)

    def look(ts):
        return idx.reindex(pd.MultiIndex.from_arrays([df["zone"], series, ts])).to_numpy()

    df["actual"] = look(df["ts"])
    df["persistence"] = look(df["made_at"].dt.floor("h") - pd.Timedelta(hours=1))
    days = np.ceil((df["ts"] - df["made_at"] + pd.Timedelta(hours=1)) / pd.Timedelta(days=1))
    df["yesterday"] = look(df["ts"] - pd.to_timedelta(days, unit="D"))
    public = df["ts"].dt.floor("D") - pd.Timedelta(days=1) + pd.Timedelta(hours=DAY_AHEAD_PUBLIC_HOUR_UTC)
    leaked = (df["target"] == "price_da") & (df["made_at"] >= public)
    df["valid"] = df["actual"].notna() & (df["ts"] > df["made_at"]) & ~leaked
    return df


def _mae(df: pd.DataFrame, col: str) -> float:
    return float((df[col] - df["actual"]).abs().mean())


def _rows(window, zone, target, metric, model, value, n) -> dict:
    return {"window_start": window[0], "window_end": window[1], "zone": zone, "target": target,
            "metric": metric, "model": model, "value": float(value), "n": int(n)}


def score(log: pd.DataFrame | None = None, actuals: pd.DataFrame | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    log = forecast_log.read() if log is None else log
    actuals = load_actuals() if actuals is None else actuals
    scored = attach_outcomes(log, actuals)
    scored = scored[scored["valid"]]
    zone_rows, overall_rows = [], []
    for (zone, target, version), g in scored.groupby(["zone", "target", "model_version"]):
        window = (g["made_at"].min(), g["ts"].max())
        zone_rows.append(_rows(window, zone, target, "forecasts_scored", version, len(g), len(g)))
        c = g.dropna(subset=list(BASELINES))
        if c.empty:
            continue
        inside = ((c["actual"] >= c["p10"]) & (c["actual"] <= c["p90"])).mean()
        mae = _mae(c, "p50")
        zone_rows += [
            _rows(window, zone, target, "mae", version, mae, len(c)),
            _rows(window, zone, target, "coverage_p10_p90", version, inside, len(c)),
            _rows(window, zone, target, "mae_ratio_vs_persistence", version, mae / _mae(c, "persistence"), len(c)),
        ]
        zone_rows += [_rows(window, zone, target, "mae", b, _mae(c, b), len(c)) for b in BASELINES]
    zones = pd.DataFrame(zone_rows, columns=schemas.SCORES.names)
    for (target, version), g in scored.groupby(["target", "model_version"]):
        window = (g["made_at"].min(), g["ts"].max())
        overall_rows.append({"window_start": window[0], "window_end": window[1], "target": target, "metric": "forecasts_scored",
                             "model": version, "value": float(len(g)), "n": len(g)})
        z = zones[(zones["target"] == target) & (zones["model"] == version)]
        ratios = z[z["metric"] == "mae_ratio_vs_persistence"]
        if ratios.empty:
            continue
        cov = z[z["metric"] == "coverage_p10_p90"]
        overall_rows += [
            {"window_start": window[0], "window_end": window[1], "target": target, "metric": "coverage_p10_p90",
             "model": version, "value": float(np.average(cov["value"], weights=cov["n"])), "n": int(cov["n"].sum())},
            {"window_start": window[0], "window_end": window[1], "target": target, "metric": "mae_ratio_vs_persistence",
             "model": version, "value": float(ratios["value"].mean()), "n": int(ratios["n"].sum())},
        ]
    overall = pd.DataFrame(overall_rows, columns=OVERALL_COLUMNS)
    if len(zones):
        zones = schemas.validate(zones, SCORES)
    return zones, overall


def run() -> dict[str, int]:
    zones, overall = score()
    cache.write(SCORES, zones)
    cache.write(OVERALL, overall)
    return {SCORES: len(zones), OVERALL: len(overall)}


if __name__ == "__main__":
    print(run())
