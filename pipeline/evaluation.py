"""Forecast evaluation for the quant slide: is the model really better, and does it fail gracefully?

    uv run python -m pipeline.evaluation [--folds 6] [--test-days 7] [--purge-hours 48] [--targets all]

Re-runs the purged walk-forward backtest (same folds, same calibrated bands, same rows as pipeline.backtest) but
keeps every test row, then writes data/backtest/evaluation.json with three things. The live model is not touched.

  dm            Diebold-Mariano test of the model's absolute errors against each baseline, per target and zone.
                d = |baseline error| - |model error|, so a positive mean_gain means the model is better. The
                long-run variance is Newey-West (Bartlett kernel, 48 hourly lags, since errors overlap), with the
                Harvey-Leybourne-Newbold small-sample correction and a Student t p-value. "significant" is p < 0.05.
  calibration   P10-P90 coverage and a quantile-bucket PIT histogram per target, split into calm and storm days
                (and all days). We only have three quantiles, so PIT is the share of outcomes below P10, between
                P10 and P50, between P50 and P90 and above P90; a calibrated model gives 10 / 40 / 40 / 10 %.
                A storm day is a UTC day whose mean GB wind generation is in the top 15% of days in the test window.
  pass_through  How much of a daily gas price move shows up in the day-ahead price: regress daily price change
                (EUR/MWh) on daily TTF change (EUR/MWh) and EUA change (EUR/t), per zone, over the whole window and
                per quarter. Theory is about 2 for TTF (50% efficient CCGT) when gas sets the price, less when it
                often does not, so beta_gas / 2 is the share of the move that comes through. GB is converted at 1.15.
                These are regression estimates on daily means, not a market model.
"""

import argparse
import json
import logging
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from scipy import stats

from pipeline import cache, marginal, schemas, scoring
from pipeline.backtest import BASELINES, MIN_TRAIN_ROWS, MODEL, baselines, make_folds
from pipeline.features import build
from pipeline.models import calibrate, quantile, train

log = logging.getLogger("pipeline.evaluation")

NAME = "backtest/evaluation"
ROWS = "backtest/evaluation_rows"
DEFAULT_TARGETS = "price_da,gb_system_price"
THREADS = 2
DM_LAGS = 48
STORM_QUANTILE = 0.85
SIGNIFICANCE = 0.05
MIN_DM_ROWS = 48
MIN_REGRESSION_DAYS = 30
MIN_R2 = 0.05
RELIABLE_DAYS = 120
PIT_LABELS = ["below_p10", "p10_p50", "p50_p90", "above_p90"]
PIT_EXPECTED = [0.1, 0.4, 0.4, 0.1]


def collect_rows(n_folds=6, test_days=7, purge_h=48, targets=None, lead_h=build.HISTORY_LEAD_H, params=None, inputs=None,
              min_train_rows=MIN_TRAIN_ROWS) -> pd.DataFrame:
    """Every walk-forward test row: ts, zone, target, y, p10, p50, p90 (calibrated), persistence, yesterday."""
    inp = inputs or build.Inputs()
    hist = build.build_history(lead_h=lead_h, inputs=inp)
    if hist.empty:
        raise ValueError("no feature history; has the backfill finished?")
    wides = train.target_frames(inp)
    chosen = list(wides) if not targets or targets == ["all"] else list(targets)
    unknown = [t for t in chosen if t not in wides]
    if unknown:
        raise ValueError(f"no cached actuals for target(s) {unknown}; have {list(wides)}")
    folds = make_folds(hist["ts"].min(), hist["ts"].max(), n_folds, test_days, purge_h)
    params = {**train.PARAMS, "n_jobs": THREADS, **(params or {})}
    out = []
    for t in chosen:
        df = train.training_frame(hist, wides[t], pd.Timestamp.max.tz_localize("UTC"))
        for k, (train_end, test_start, test_end) in enumerate(folds):
            tr = df[df["ts"] < train_end]
            te = df[(df["ts"] >= test_start) & (df["ts"] < test_end)].reset_index(drop=True)
            if len(tr) < min_train_rows or te.empty:
                log.warning("fold %d of %s skipped: %d training rows, %d test rows", k, t, len(tr), len(te))
                continue
            log.info("fold %d %s: train %d rows, test %d rows", k, t, len(tr), len(te))
            cal = train.calibration(tr, params)
            q = quantile.raw_quantiles(train.fit_target(tr, params), te)
            if cal:
                q = calibrate.apply(q, cal["scale"])
            for zone, g in te.groupby("zone"):
                base = baselines(wides[t], zone, pd.DatetimeIndex(g["ts"]), lead_h)
                ok = base.notna().all(axis=1).to_numpy()
                if not ok.any():
                    continue
                qz = q[g.index.to_numpy()][ok]
                out.append(pd.DataFrame({
                    "fold": k, "ts": g["ts"].to_numpy()[ok], "zone": zone, "target": t, "y": g["y"].to_numpy()[ok],
                    "p10": qz[:, 0], "p50": qz[:, 1], "p90": qz[:, 2],
                    "persistence": base["persistence"].to_numpy()[ok], "yesterday": base["yesterday"].to_numpy()[ok],
                }))
    if not out:
        raise ValueError("no fold had enough data; run the backfill or lower --folds / --test-days")
    return pd.concat(out, ignore_index=True)


def diebold_mariano(model_err: np.ndarray, base_err: np.ndarray, horizon: int = 1, lags: int = DM_LAGS) -> dict:
    """DM test on absolute-error loss. Positive mean_gain: the model's loss is lower than the baseline's."""
    d = np.abs(np.asarray(base_err, float)) - np.abs(np.asarray(model_err, float))
    n = len(d)
    mean = float(d.mean())
    if n < MIN_DM_ROWS:
        return {"n": n, "mean_gain": mean, "dm_stat": None, "p_value": None, "significant": False}
    c = d - mean
    lrv = float(c @ c) / n
    for k in range(1, min(lags, n - 1) + 1):
        lrv += 2 * (1 - k / (lags + 1)) * float(c[k:] @ c[:-k]) / n
    if lrv <= 0:
        return {"n": n, "mean_gain": mean, "dm_stat": None, "p_value": None, "significant": False}
    dm = mean / np.sqrt(lrv / n)
    hln = np.sqrt(max(n + 1 - 2 * horizon + horizon * (horizon - 1) / n, 1e-9) / n)
    stat = float(dm * hln)
    p = float(2 * stats.t.sf(abs(stat), df=n - 1))
    return {"n": n, "mean_gain": mean, "dm_stat": stat, "p_value": p, "significant": bool(p < SIGNIFICANCE)}


def dm_table(rows: pd.DataFrame, horizon: int = 1) -> list[dict]:
    out = []
    for (target, zone), g in rows.sort_values("ts").groupby(["target", "zone"]):
        g = g.drop_duplicates("ts")
        for b in BASELINES:
            res = diebold_mariano(g["y"] - g["p50"], g["y"] - g[b], horizon)
            mae_m, mae_b = float((g["y"] - g["p50"]).abs().mean()), float((g["y"] - g[b]).abs().mean())
            verdict = ("model better" if res["significant"] and res["mean_gain"] > 0
                       else "baseline better" if res["significant"] else "no significant difference")
            out.append({"target": target, "zone": zone, "baseline": b, "mae_model": mae_m, "mae_baseline": mae_b, **res,
                        "verdict": verdict})
    return out


def storm_days(wind: pd.DataFrame, q: float = STORM_QUANTILE) -> set:
    """UTC dates whose mean GB wind generation is in the top (1 - q) of days. wind: actuals rows for GB gen_wind."""
    w = wind[(wind["zone"] == "GB") & (wind["series"] == "gen_wind")]
    if w.empty:
        return set()
    daily = w.groupby(w["ts"].dt.date)["value"].mean()
    return set(daily[daily >= daily.quantile(q)].index)


def pit_bins(y: np.ndarray, q: np.ndarray) -> list[float]:
    """Share of outcomes in each quantile bucket (below P10, P10-P50, P50-P90, above P90)."""
    y = np.asarray(y, float)
    q = np.asarray(q, float)
    idx = (y > q[:, 0]).astype(int) + (y > q[:, 1]).astype(int) + (y > q[:, 2]).astype(int)
    return [float((idx == i).mean()) for i in range(4)]


def calibration_table(rows: pd.DataFrame, storms: set) -> list[dict]:
    rows = rows.assign(regime=np.where(rows["ts"].dt.date.isin(storms), "storm", "calm"))
    out = []
    for target, tg in rows.groupby("target"):
        for zone, zg in [("all", tg), *tg.groupby("zone")]:
            for regime, g in [("all", zg), *zg.groupby("regime")]:
                if g.empty:
                    continue
                q = g[["p10", "p50", "p90"]].to_numpy()
                bins = pit_bins(g["y"].to_numpy(), q)
                out.append({"target": target, "zone": zone, "regime": regime, "n": int(len(g)),
                            "coverage_p10_p90": float(bins[1] + bins[2]), "pit": dict(zip(PIT_LABELS, bins)),
                            "pit_expected": dict(zip(PIT_LABELS, PIT_EXPECTED))})
    return out


def _ols(y: np.ndarray, x: np.ndarray) -> tuple[np.ndarray, float]:
    x1 = np.column_stack([np.ones(len(x)), x])
    beta, *_ = np.linalg.lstsq(x1, y, rcond=None)
    resid = y - x1 @ beta
    ss = float(((y - y.mean()) ** 2).sum())
    return beta, (1 - float(resid @ resid) / ss) if ss > 0 else 0.0


def pass_through(prices: pd.DataFrame, markets: pd.DataFrame, min_days: int = MIN_REGRESSION_DAYS) -> dict:
    """Daily price change (EUR/MWh) on TTF (EUR/MWh) and EUA (EUR/t) changes, per zone: whole window and per quarter."""
    mk = markets.pivot_table(index=markets["ts"].dt.floor("D"), columns="series", values="value")
    if not {"gas_ttf", "eua"} <= set(mk.columns):
        return {"overall": [], "by_quarter": []}
    mk = mk[["gas_ttf", "eua"]].ffill().diff()
    p = prices[prices["series"] == "price_da"]
    daily = p.assign(day=p["ts"].dt.floor("D")).groupby(["zone", "day"])["value"].agg(["mean", "count"]).reset_index()
    daily = daily[daily["count"] >= 20]
    daily.loc[daily["zone"] == "GB", "mean"] *= marginal.EUR_PER_GBP

    def fit(g: pd.DataFrame) -> dict | None:
        z = g.set_index("day")["mean"].diff().rename("dp").to_frame().join(mk, how="inner").dropna()
        if len(z) < min_days or z["gas_ttf"].std() == 0:
            return None
        beta, r2 = _ols(z["dp"].to_numpy(), z[["gas_ttf", "eua"]].to_numpy())
        return {"n_days": int(len(z)), "beta_gas": float(beta[1]), "beta_eua": float(beta[2]), "r2": r2, "reliable": bool(r2 >= MIN_R2 and len(z) >= RELIABLE_DAYS),
                "share_of_theory": float(beta[1] * marginal.CCGT_EFFICIENCY)}

    overall, quarterly = [], []
    for zone, g in daily.groupby("zone"):
        res = fit(g)
        if res:
            overall.append({"zone": zone, **res})
        q = g.assign(quarter=g["day"].dt.tz_localize(None).dt.to_period("Q").astype(str))
        for qtr, gq in q.groupby("quarter"):
            res = fit(gq)
            if res:
                quarterly.append({"zone": zone, "quarter": qtr, **res})
    return {"overall": overall, "by_quarter": quarterly}


def build_report(rows: pd.DataFrame, actuals: pd.DataFrame, markets: pd.DataFrame | None, lead_h: int, config: dict) -> dict:
    storms = storm_days(actuals[actuals["series"] == "gen_wind"])
    days = rows["ts"].dt.date.unique()
    pt = pass_through(actuals, markets) if markets is not None and len(markets) else {"overall": [], "by_quarter": []}
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "config": {**config, "lead_h": lead_h, "dm_lags": DM_LAGS, "significance": SIGNIFICANCE},
        "regimes": {
            "definition": f"storm = UTC day with GB mean wind generation in the top {round((1 - STORM_QUANTILE) * 100)}% of days",
            "storm_days_in_test": sorted(str(d) for d in storms if d in set(days)),
            "n_days_in_test": int(len(days)),
        },
        "dm": dm_table(rows, horizon=lead_h),
        "calibration": calibration_table(rows, storms),
        "pass_through": {**pt, "units": "EUR/MWh power per EUR/MWh TTF; theory about 2 when gas sets the price",
                         "note": "regression on daily changes, an estimate not a market model; reliable=false means R2 under 5% or under 120 days, so do not quote the beta"},
    }


def headline(report: dict) -> str:
    dm = [r for r in report["dm"] if r["baseline"] == "persistence"]
    better = sum(r["verdict"] == "model better" for r in dm)
    worse = [f"{r['target']} {r['zone']}" for r in dm if r["verdict"] == "baseline better"]
    cal = {r["regime"]: r["coverage_p10_p90"] for r in report["calibration"] if r["target"] == "price_da" and r["zone"] == "all"}
    lines = [f"DM vs persistence: model significantly better in {better} of {len(dm)} target-zone pairs"
             + (f"; persistence better in {', '.join(worse)}" if worse else "")]
    if cal:
        lines.append("price_da P10-P90 coverage: " + ", ".join(f"{k} {v:.0%}" for k, v in sorted(cal.items())))
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Diebold-Mariano, PIT by regime and gas pass-through from the backtest.")
    ap.add_argument("--folds", type=int, default=6)
    ap.add_argument("--test-days", type=int, default=7)
    ap.add_argument("--purge-hours", type=int, default=48)
    ap.add_argument("--reuse", action="store_true", help="reuse the saved test rows instead of retraining")
    ap.add_argument("--targets", default=DEFAULT_TARGETS, help="comma-separated or 'all': " + ", ".join(schemas.TARGETS))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        if args.reuse and cache.exists(ROWS):
            rows = cache.read(ROWS)
        else:
            rows = collect_rows(args.folds, args.test_days, args.purge_hours, args.targets.split(","))
            cache.write(ROWS, rows)
    except (ValueError, FileNotFoundError) as e:
        log.error("%s", e)
        return 1
    try:
        markets = cache.read("markets/gas_carbon")
    except FileNotFoundError:
        markets = None
    config = {"folds": args.folds, "test_days": args.test_days, "purge_hours": args.purge_hours}
    report = build_report(rows, scoring.load_actuals(), markets, build.HISTORY_LEAD_H, config)
    path = cache.path(NAME).with_suffix(".json")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, allow_nan=False))
    log.info("wrote %s\n%s", path, headline(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
