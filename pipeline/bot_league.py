"""Bot league evaluation: which forecasting technique wins, and when.

    nice -n 19 env OMP_NUM_THREADS=2 uv run python -m pipeline.bot_league [--folds 6] [--test-days 7] [--threads 2]

Re-runs the purged walk-forward folds of pipeline.backtest with every league bot, keeping each test row rather than
fold averages, then refits the whole league as of each replay day in data/replay/ (only data before the day). Scores:
  mae, pinball         of the P50, and of P10/P50/P90 (lower is better)
  coverage_p10_p90     share of outcomes inside the band (nominal 0.80)
  brier, log_loss      on a yes/no question for every zone-hour in the market's form: "above X?", with X the
                       zone's mean price over the 7 days before the forecast was made, rounded to 10 (the live
                       market uses our P50, which would pin our probability at 0.5); each model's probability
                       comes from its own quantiles (pipeline.models.bots.base.prob_above)
split by regime: storm days are the top 15% of days by mean GB wind generation, as in pipeline.evaluation (#121).
Diebold-Mariano (absolute error, HAC with 48 lags, Harvey correction; same test as #121) for every model against
ours, on the zone-mean loss per hour. Persistence and yesterday are point forecasts: no pinball or coverage, and
their probabilities are 0.02 or 0.98. Prices are GBP/MWh for GB and EUR/MWh elsewhere; pooled MAE mixes the two,
as the backtest headline does.

Writes data/backtest/bot_league.json (for /scores and the quant slide) and data/backtest/bot_league_rows.parquet.
"""

import argparse
import json
import logging
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from scipy import stats

from pipeline import cache
from pipeline.backtest import BASELINES, MIN_TRAIN_ROWS, MODEL, baselines, make_folds
from pipeline.features import build
from pipeline.models import bots as league
from pipeline.models import train
from pipeline.models.bots.base import Context, assert_no_leakage, prob_above
from pipeline.models.bots.lgbm import OurModel

log = logging.getLogger("pipeline.bot_league")

NAME = "backtest/bot_league"
ROWS = "backtest/bot_league_rows"
REPLAY_DIR = "replay"
THREADS = 2
DM_LAGS = 48
STORM_QUANTILE = 0.85
SIGNIFICANCE = 0.05
MIN_DM_ROWS = 48
QUESTION_STEP = 10.0
LINE_DAYS = 7
POINT_MODELS = BASELINES
TITLES = {"persistence": "Persistence", "yesterday": "Same hour yesterday (no band)"}


def _utc(d) -> pd.Timestamp:
    t = pd.Timestamp(d)
    return t.tz_localize("UTC") if t.tzinfo is None else t.tz_convert("UTC")


def _long(te: pd.DataFrame, preds: dict[str, np.ndarray], base: pd.DataFrame, **tags) -> pd.DataFrame:
    """One row per test row and model: ts, zone, y, model, p10, p50, p90, plus tags. base: persistence, yesterday."""
    keep = ["ts", "zone", "y"]
    frames = []
    for name, q in preds.items():
        f = te[keep].copy()
        f["model"], f["p10"], f["p50"], f["p90"] = name, q[:, 0], q[:, 1], q[:, 2]
        frames.append(f)
    for b in POINT_MODELS:
        f = te[keep].copy()
        f["model"], f["p50"] = b, base[b].to_numpy()
        f["p10"] = f["p90"] = np.nan
        frames.append(f)
    out = pd.concat(frames, ignore_index=True)
    out["line"] = np.tile(base["line"].to_numpy(), len(frames))
    for k, v in tags.items():
        out[k] = v
    return out


def _point_baselines(te: pd.DataFrame, wide: pd.DataFrame, lead_h: int) -> pd.DataFrame:
    parts = []
    for zone, g in te.groupby("zone"):
        ts = pd.DatetimeIndex(g["ts"])
        b = baselines(wide, zone, ts, lead_h)
        series = wide.get(zone)
        week = series.dropna().rolling(f"{LINE_DAYS * 24}h").mean() if series is not None else None
        b["line"] = build._at(week, ts - pd.Timedelta(hours=lead_h + 1), "3h")
        b.index = g.index
        parts.append(b)
    return pd.concat(parts).reindex(te.index)


def _score_block(te, tr, wide, lead_h, params, ours=None):
    ctx = Context(wide=wide, lead_h=lead_h, params=params)
    fitted = league.fit_league(tr, ctx, ours)
    return _point_baselines(te, wide, lead_h), league.predict_league(fitted, te, ctx), fitted


def collect(n_folds=6, test_days=7, purge_h=48, targets=league.TARGETS, lead_h=build.HISTORY_LEAD_H, params=None,
            inputs=None, replay_days=None, min_train_rows=MIN_TRAIN_ROWS) -> pd.DataFrame:
    """Every scored row: source (backtest | replay), fold, day, target, ts, zone, y, model, p10, p50, p90, line."""
    inp = inputs or build.Inputs()
    hist = build.build_history(lead_h=lead_h, inputs=inp)
    if hist.empty:
        raise ValueError("no feature history; has the backfill finished?")
    wides = train.target_frames(inp)
    params = {**train.PARAMS, **(params or {})}
    folds = make_folds(hist["ts"].min(), hist["ts"].max(), n_folds, test_days, purge_h)
    out = []
    for t in [t for t in targets if t in wides]:
        df = train.training_frame(hist, wides[t], pd.Timestamp.max.tz_localize("UTC"))
        for k, (train_end, test_start, test_end) in enumerate(folds):
            tr = df[df["ts"] < train_end]
            te = df[(df["ts"] >= test_start) & (df["ts"] < test_end)].reset_index(drop=True)
            if len(tr) < min_train_rows or te.empty:
                log.warning("fold %d of %s skipped: %d training rows, %d test rows", k, t, len(tr), len(te))
                continue
            log.info("fold %d %s: train to %s, test %d rows from %s", k, t, train_end, len(te), test_start)
            base, preds, fitted = _score_block(te, tr, wides[t], lead_h, params)
            for b in fitted.values():
                assert_no_leakage(b, test_start)
            out.append(_long(te, preds, base, source="backtest", fold=k, day=None, target=t))
        for day in replay_days or []:
            d = _utc(day)
            tr = df[df["ts"] < d]
            te = df[(df["ts"] >= d) & (df["ts"] < d + pd.Timedelta(days=1))].reset_index(drop=True)
            if len(tr) < min_train_rows or te.empty:
                log.warning("replay %s of %s skipped: %d training rows, %d test rows", d.date(), t, len(tr), len(te))
                continue
            log.info("replay %s %s: train to %s, test %d rows", d.date(), t, tr["ts"].max(), len(te))
            base, preds, fitted = _score_block(te, tr, wides[t], lead_h, params)
            for b in fitted.values():
                assert_no_leakage(b, d)
            out.append(_long(te, preds, base, source="replay", fold=-1, day=str(d.date()), target=t))
    if not out:
        raise ValueError("no fold or replay day had enough data")
    return pd.concat(out, ignore_index=True)


def replay_days() -> list[str]:
    folder = cache.DATA / REPLAY_DIR
    return sorted(p.stem for p in folder.glob("*.json")) if folder.exists() else []


def storm_days(wind: pd.DataFrame, q: float = STORM_QUANTILE) -> set:
    """UTC dates whose mean GB wind generation is in the top (1 - q) of days (same rule as pipeline.evaluation)."""
    w = wind[(wind["zone"] == "GB") & (wind["series"] == "gen_wind")]
    if w.empty:
        return set()
    daily = w.groupby(w["ts"].dt.date)["value"].mean()
    return set(daily[daily >= daily.quantile(q)].index)


def add_questions(rows: pd.DataFrame) -> pd.DataFrame:
    """The yes/no line per row (its `line`, rounded), each model's P(above) and the outcome.

    The live market puts the line at our P50, which pins our probability at 0.5 and makes our Brier score
    uninformative. Here the line is a price no model chose: the zone's mean over the week before the forecast.
    """
    out = rows.copy()
    out["threshold"] = np.maximum(QUESTION_STEP, np.round(out["line"] / QUESTION_STEP) * QUESTION_STEP)
    p = [prob_above(x, a, b, c) if np.isfinite(x) else np.nan
         for x, a, b, c in zip(out["threshold"], out["p10"].fillna(out["p50"]), out["p50"], out["p90"].fillna(out["p50"]))]
    out["p_above"] = p
    out["above"] = (out["y"] > out["threshold"]).astype(float)
    return out


def tag_regime(rows: pd.DataFrame, storms: set) -> pd.DataFrame:
    rows = rows.copy()
    rows["regime"] = np.where(rows["ts"].dt.date.isin(storms), "storm", "calm")
    return rows


def _pinball(y, q) -> np.ndarray:
    tau = np.array([0.1, 0.5, 0.9])[None, :]
    d = y[:, None] - q
    return np.maximum(tau * d, (tau - 1) * d).mean(axis=1)


def metrics(g: pd.DataFrame) -> dict:
    g = g.dropna(subset=["y", "p50"])
    y, p50 = g["y"].to_numpy(float), g["p50"].to_numpy(float)
    banded = g["p10"].notna().all() and len(g) > 0
    q = g[["p10", "p50", "p90"]].to_numpy(float)
    pa, above = g["p_above"].to_numpy(float), g["above"].to_numpy(float)
    ok = np.isfinite(pa)
    pc = np.clip(pa[ok], 1e-6, 1 - 1e-6)
    return {
        "n": int(len(g)),
        "mae": float(np.abs(y - p50).mean()) if len(g) else None,
        "pinball": float(_pinball(y, q).mean()) if banded else None,
        "coverage_p10_p90": float(((y >= q[:, 0]) & (y <= q[:, 2])).mean()) if banded else None,
        "brier": float(np.mean((pa[ok] - above[ok]) ** 2)) if ok.any() else None,
        "log_loss": float(-np.mean(above[ok] * np.log(pc) + (1 - above[ok]) * np.log(1 - pc))) if ok.any() else None,
    }


def table(rows: pd.DataFrame) -> list[dict]:
    """Per model: metrics, ranked by pinball (point models after banded ones) and by Brier."""
    out = [{"model": m, **metrics(g)} for m, g in rows.groupby("model")]
    banded = sorted([r for r in out if r["pinball"] is not None], key=lambda r: r["pinball"])
    for i, r in enumerate(banded, 1):
        r["rank_pinball"] = i
    for i, r in enumerate(sorted([r for r in out if r["brier"] is not None], key=lambda r: r["brier"]), 1):
        r["rank_brier"] = i
    return sorted(out, key=lambda r: (r.get("rank_pinball") or 99, r["model"]))


def diebold_mariano(loss_ours: np.ndarray, loss_other: np.ndarray, horizon: int = 1, lags: int = DM_LAGS) -> dict:
    """DM test on a loss series. Positive mean_gain: our loss is lower than the other model's."""
    d = np.asarray(loss_other, float) - np.asarray(loss_ours, float)
    d = d[np.isfinite(d)]
    n = len(d)
    mean = float(d.mean()) if n else 0.0
    empty = {"n": n, "mean_gain": mean, "dm_stat": None, "p_value": None, "significant": False}
    if n < MIN_DM_ROWS:
        return empty
    c = d - mean
    lrv = float(c @ c) / n
    for k in range(1, min(lags, n - 1) + 1):
        lrv += 2 * (1 - k / (lags + 1)) * float(c[k:] @ c[:-k]) / n
    if lrv <= 0:
        return empty
    hln = np.sqrt(max(n + 1 - 2 * horizon + horizon * (horizon - 1) / n, 1e-9) / n)
    stat = float(mean / np.sqrt(lrv / n) * hln)
    p = float(2 * stats.t.sf(abs(stat), df=n - 1))
    return {"n": n, "mean_gain": mean, "dm_stat": stat, "p_value": p, "significant": bool(p < SIGNIFICANCE)}


def dm_vs_ours(rows: pd.DataFrame) -> list[dict]:
    """Every model against ours on absolute error, zone-mean per hour so the series is one value per ts."""
    err = rows.assign(ae=(rows["y"] - rows["p50"]).abs()).dropna(subset=["ae"])
    wide = err.groupby(["ts", "model"])["ae"].mean().unstack("model").sort_index()
    out = []
    if MODEL not in wide:
        return out
    for m in [c for c in wide.columns if c != MODEL]:
        pair = wide[[MODEL, m]].dropna()
        res = diebold_mariano(pair[MODEL].to_numpy(), pair[m].to_numpy())
        verdict = ("ours better" if res["significant"] and res["mean_gain"] > 0
                   else f"{m} better" if res["significant"] else "no significant difference")
        out.append({"model": m, **res, "verdict": verdict})
    return out


def report(rows: pd.DataFrame, storms: set, config: dict) -> dict:
    """The JSON for /scores and the slide: per target, overall and by regime (backtest rows), replay days, DM."""
    rows = tag_regime(add_questions(rows), storms)
    names = {s["name"]: s for s in league.specs()}
    models = [names.get(m, {"name": m, "title": TITLES.get(m, m), "method": "Point forecast; no band."})
              for m in sorted(rows["model"].unique(), key=lambda m: (m not in names, list(names).index(m) if m in names else 0, m))]
    targets = {}
    for t, g in rows.groupby("target"):
        bt, rp = g[g["source"] == "backtest"], g[g["source"] == "replay"]
        by_regime = {r: table(x) for r, x in bt.groupby("regime")}
        targets[t] = {
            "overall": table(bt),
            "by_regime": by_regime,
            "regime_days": {r: int(x["ts"].dt.date.nunique()) for r, x in bt.groupby("regime")},
            "replay": {d: table(x) for d, x in rp.groupby("day")},
            "dm_vs_ours": {"all": dm_vs_ours(bt), **{r: dm_vs_ours(x) for r, x in bt.groupby("regime")}},
            "winner": {k: _winner(v) for k, v in {"all": table(bt), **by_regime}.items()},
        }
    return {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "config": config,
            "models": models, "targets": targets, "headline": headline(targets)}


def _winner(tbl: list[dict]) -> dict | None:
    banded = [r for r in tbl if r.get("rank_pinball") == 1]
    brier = [r for r in tbl if r.get("rank_brier") == 1]
    if not banded:
        return None
    return {"pinball": banded[0]["model"], "brier": brier[0]["model"] if brier else None}


def headline(targets: dict) -> list[str]:
    title = {s["name"]: s["title"] for s in league.specs()} | TITLES
    lines = []
    for t, v in targets.items():
        w = v["winner"]
        parts = [f"{r}: {title.get(w[r]['pinball'], w[r]['pinball'])}" for r in ("all", "calm", "storm") if w.get(r)]
        if parts:
            lines.append(f"{t} lowest pinball loss, " + "; ".join(parts))
    return lines


def text_report(rep: dict) -> str:
    lines = []
    for t, v in rep["targets"].items():
        days = v["regime_days"]
        lines.append(f"{t} (backtest; calm {days.get('calm', 0)} days, storm {days.get('storm', 0)} days)")
        lines.append(f"  {'model':16} {'regime':6} {'n':>6} {'MAE':>7} {'pinball':>8} {'cover':>6} {'Brier':>6} {'logloss':>7}")
        for regime, tbl in [("all", v["overall"]), *v["by_regime"].items()]:
            for r in tbl:
                f = lambda x, p=1: "-" if x is None else f"{x:.{p}f}"  # noqa: E731
                lines.append(f"  {r['model']:16} {regime:6} {r['n']:6d} {f(r['mae']):>7} {f(r['pinball']):>8} "
                             f"{f(r['coverage_p10_p90'], 2):>6} {f(r['brier'], 3):>6} {f(r['log_loss'], 3):>7}")
        for regime, dm in v["dm_vs_ours"].items():
            for r in dm:
                p = "-" if r["p_value"] is None else f"{r['p_value']:.3f}"
                lines.append(f"  DM {regime:5} ours vs {r['model']:16} gain {r['mean_gain']:+.2f}  p {p}  {r['verdict']}")
        for day, tbl in v["replay"].items():
            for r in tbl:
                lines.append(f"  replay {day} {r['model']:16} MAE {r['mae']:.1f} cover "
                             f"{'-' if r['coverage_p10_p90'] is None else round(r['coverage_p10_p90'], 2)}")
    return "\n".join(lines + rep["headline"])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--folds", type=int, default=6)
    ap.add_argument("--test-days", type=int, default=7)
    ap.add_argument("--purge-hours", type=int, default=48)
    ap.add_argument("--targets", default=",".join(league.TARGETS))
    ap.add_argument("--threads", type=int, default=THREADS, help="LightGBM threads (the VPS is shared)")
    ap.add_argument("--no-replay", action="store_true", help="skip the as-of refits for data/replay/ days")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    days = [] if args.no_replay else replay_days()
    rows = collect(args.folds, args.test_days, args.purge_hours, args.targets.split(","),
                   params={"n_jobs": args.threads}, replay_days=days)
    try:
        storms = storm_days(cache.read("actuals/elexon_gen_wind"))
    except FileNotFoundError:
        storms = set()
    config = {"folds": args.folds, "test_days": args.test_days, "purge_hours": args.purge_hours,
              "lead_h": build.HISTORY_LEAD_H, "storm_quantile": STORM_QUANTILE, "replay_days": days,
              "storm_days": sorted(str(d) for d in storms if rows["ts"].dt.date.isin([d]).any()),
              "question": f"above the zone's mean price over the {LINE_DAYS} days before the forecast, rounded to {QUESTION_STEP:.0f}", "dm_lags": DM_LAGS}
    rep = report(rows, storms, config)
    cache.write(ROWS, rows)
    out = cache.DATA / f"{NAME}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rep, indent=1))
    log.info("wrote %s\n%s", out, text_report(rep))
    return 0


if __name__ == "__main__":
    sys.exit(main())
