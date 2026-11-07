"""Choice questions for a mystery day: several options, exactly one wins. Built like engine.market.questions from a replay
file (as-of forecasts and actuals) and optional history, never from anything the day itself would reveal first.

  price_bucket   which band will a zone's day-ahead price be in at a given hour (four bands round our median)
  which_zone     which zone will have the highest day-ahead price at a given hour (GB converted at EUR_PER_GBP)
  peak_block     which six-hour block of the day will have GB's highest day-ahead price
  import_export  will Britain import or export power at a given hour (history only: the share of recent days)
  wind_band      how much wind will Britain pay to switch off by the end of play (thirds of the last 30 days)

Every option carries our model's probability p. For the price questions it comes from the replay's own P10/P50/P90
through a piecewise-linear CDF; for questions across zones or hours it is simulated from those bands with errors
assumed independent, which the note says. The history-only questions say they are history, not a forecast.
"""

import numpy as np
import pandas as pd

from engine.market import questions as q

EUR_PER_GBP = 1.15
P_MIN = 0.02
DRAWS = 4000
BLOCKS = (("night", "Night, 00:00 to 06:00", 0, 6), ("morning", "Morning, 06:00 to 12:00", 6, 12),
          ("afternoon", "Afternoon, 12:00 to 18:00", 12, 18), ("evening", "Evening, 18:00 to 24:00", 18, 24))


def _title(name: str) -> str:
    return name[:1].upper() + name[1:]


def _norm(ps: list[float]) -> list[float]:
    a = np.maximum(np.asarray(ps, float), P_MIN)
    return [round(float(x), 3) for x in a / a.sum()]


def cdf(x: float, p10: float, p50: float, p90: float) -> float:
    """P(value <= x) through the three quantiles, tails extended at the same slopes, kept inside (0.01, 0.99)."""
    if not p10 < p50 < p90:
        return 0.5 if x == p50 else (0.01 if x < p50 else 0.99)
    c = 0.1 + 0.4 * (x - p10) / (p50 - p10) if x <= p50 else 0.5 + 0.4 * (x - p50) / (p90 - p50)
    return float(np.clip(c, 0.01, 0.99))


def draws(p10: float, p50: float, p90: float, n: int = DRAWS, seed: int = 0) -> np.ndarray:
    """Samples from the piecewise-linear quantile function through P10/P50/P90 (tails reach half a band beyond)."""
    u = np.random.default_rng(seed).random(n)
    xs = [p10 - 0.5 * (p50 - p10), p10, p50, p90, p90 + 0.5 * (p90 - p50)]
    return np.interp(u, [0.01, 0.1, 0.5, 0.9, 0.99], xs, left=xs[0], right=xs[-1])


def _series(replay: dict, zone: str, target: str) -> dict | None:
    return next((s for s in replay["series"] if s["zone"] == zone and s["target"] == target), None)


def _ok(p: dict | None) -> bool:
    return bool(p) and all(p.get(k) is not None for k in ("actual", "p10", "p50", "p90"))


def price_bucket(replay: dict, zone: str = "GB", target: str = "price_da", asked: int = 18, start: int = 12, end: int = 18):
    hour = q.fit_hour(asked, start, end)
    s = _series(replay, zone, target)
    p = q._point(s, hour) if s else None
    if not _ok(p):
        return None
    sym = q.SYMBOL.get(s["unit"], "")
    edges = [q.nice(p["p10"] + 0.5 * (p["p50"] - p["p10"])), q.nice(p["p50"]), q.nice(p["p50"] + 0.5 * (p["p90"] - p["p50"]))]
    if not edges[0] < edges[1] < edges[2]:
        return None
    labels = [f"Under {sym}{edges[0]:.0f}", f"{sym}{edges[0]:.0f} to {sym}{edges[1]:.0f}", f"{sym}{edges[1]:.0f} to {sym}{edges[2]:.0f}", f"Over {sym}{edges[2]:.0f}"]
    cum = [0.0] + [cdf(e, p["p10"], p["p50"], p["p90"]) for e in edges] + [1.0]
    probs = _norm([cum[i + 1] - cum[i] for i in range(4)])
    won = int(np.searchsorted(edges, p["actual"], side="right"))
    made = pd.Timestamp(p["made_at"])
    return q.MarketQuestion(
        id=f"{zone}-{target}-band-{hour:02d}", kind="price_bucket", target_hour=hour, unit=s["unit"], threshold=0.0,
        text=f"Which band will {q.ZONE_NAMES.get(zone, zone)}'s {q.TARGET_NAMES.get(target, target)} be in at {hour:02d}:00?",
        model_p=0.0,
        model_note=f"Our forecast made {(pd.Timestamp(p['ts']) - made).total_seconds() / 3600:.0f} h ahead: median {sym}{p['p50']:.0f}, "
                   f"80% range {sym}{p['p10']:.0f} to {sym}{p['p90']:.0f}",
        outcome=f"b{won}", actual=float(p["actual"]),
        choices=[{"id": f"b{i}", "label": labels[i], "p": probs[i]} for i in range(4)],
    )


def which_zone(replay: dict, asked: int = 17, start: int = 12, end: int = 18, target: str = "price_da"):
    hour = q.fit_hour(asked, start, end)
    rows = []
    for s in replay["series"]:
        if s["target"] != target:
            continue
        p = q._point(s, hour)
        if _ok(p):
            fx = EUR_PER_GBP if s["unit"].startswith("GBP") else 1.0
            rows.append((s["zone"], p, fx))
    if len(rows) < 3:
        return None
    sims = np.vstack([draws(p["p10"] * fx, p["p50"] * fx, p["p90"] * fx, seed=i) for i, (_, p, fx) in enumerate(rows)])
    wins = np.bincount(sims.argmax(axis=0), minlength=len(rows)) / sims.shape[1]
    actual = [p["actual"] * fx for _, p, fx in rows]
    top = int(np.argmax(actual))
    probs = _norm(list(wins))
    return q.MarketQuestion(
        id=f"zone-highest-{target}-{hour:02d}", kind="which_zone", target_hour=hour, unit="EUR/MWh", threshold=0.0,
        text=f"Which zone will have the highest day-ahead price at {hour:02d}:00?", model_p=0.0,
        model_note="Our forecasts made before the day, with each zone's error assumed independent. Britain converted to euros.",
        outcome=rows[top][0], actual=float(actual[top]),
        choices=[{"id": z, "label": _title(q.ZONE_NAMES.get(z, z)), "p": probs[i]} for i, (z, _, _) in enumerate(rows)],
    )


def peak_block(replay: dict, zone: str = "GB", target: str = "price_da", end: int = 18):
    s = _series(replay, zone, target)
    pts = [p for p in (s["points"] if s else []) if _ok(p)]
    if len(pts) != 24:
        return None
    pts.sort(key=lambda p: pd.Timestamp(p["ts"]))
    sims = np.vstack([draws(p["p10"], p["p50"], p["p90"], seed=i) for i, p in enumerate(pts)])
    peak_hour = sims.argmax(axis=0)
    probs = _norm([float(np.mean([(lo <= h < hi) for h in peak_hour])) for _, _, lo, hi in BLOCKS])
    actual_hour = int(np.argmax([p["actual"] for p in pts]))
    won = next(i for i, (_, _, lo, hi) in enumerate(BLOCKS) if lo <= actual_hour < hi)
    return q.MarketQuestion(
        id=f"{zone}-peak-block", kind="peak_block", target_hour=end, unit=s["unit"], threshold=0.0,
        text=f"In which part of the day will {q.ZONE_NAMES.get(zone, zone)}'s day-ahead price peak?", model_p=0.0,
        model_note="Our forecasts for all 24 hours made before the day, each hour's error assumed independent.",
        outcome=BLOCKS[won][0], actual=float(pts[actual_hour]["actual"]),
        choices=[{"id": b[0], "label": b[1], "p": probs[i]} for i, b in enumerate(BLOCKS)],
    )


def gb_net_import(actuals: pd.DataFrame) -> pd.DataFrame:
    """Hourly GB net import in MW (positive: importing) from the cached flow_GB_<zone> series, which are exports from GB."""
    f = actuals[actuals["series"].str.startswith("flow_GB_")]
    if f.empty:
        return pd.DataFrame(columns=["ts", "value"])
    net = -f.groupby(pd.to_datetime(f["ts"], utc=True))["value"].sum()
    return net.rename("value").reset_index().rename(columns={"index": "ts"})


def import_export(day: pd.Timestamp, net_import: pd.DataFrame | None, asked: int = 19, start: int = 12, end: int = 18, history_days: int = 30):
    hour = q.fit_hour(asked, start, end)
    if net_import is None or net_import.empty:
        return None
    s = net_import.set_index(pd.to_datetime(net_import["ts"], utc=True))["value"].sort_index()
    at = lambda d: s.get(d + pd.Timedelta(hours=hour))  # noqa: E731
    past = np.array([v for v in (at(day - pd.Timedelta(days=i)) for i in range(1, history_days + 1)) if v is not None and np.isfinite(v)])
    today = at(day)
    if len(past) < 10 or today is None or not np.isfinite(today):
        return None
    p_imp = float((past > 0).mean())
    probs = _norm([p_imp, 1 - p_imp])
    return q.MarketQuestion(
        id=f"GB-net-flow-{hour:02d}", kind="import_export", target_hour=hour, unit="MW", threshold=0.0,
        text=f"Will Britain be importing or exporting power at {hour:02d}:00?", model_p=0.0,
        model_note=f"History only, not a forecast: Britain was importing at {hour:02d}:00 on {int((past > 0).sum())} of the previous {len(past)} days",
        outcome="import" if today > 0 else "export", actual=float(today),
        choices=[{"id": "import", "label": "Importing", "p": probs[0]}, {"id": "export", "label": "Exporting", "p": probs[1]}],
    )


def wind_band(day: pd.Timestamp, boalf: pd.DataFrame | None, end_hour: int = 18, history_days: int = 30):
    if boalf is None or boalf.empty:
        return None
    s = boalf.set_index(pd.to_datetime(boalf["ts"], utc=True))["value"].sort_index()
    span = lambda d: s[d : d + pd.Timedelta(hours=end_hour - 1)]  # noqa: E731
    past = np.array([span(day - pd.Timedelta(days=i)).sum() / 1000 for i in range(1, history_days + 1) if len(span(day - pd.Timedelta(days=i))) >= end_hour])
    today = span(day)
    if len(past) < 10 or len(today) < end_hour:
        return None
    thirds = np.quantile(past, [1 / 3, 2 / 3])
    lo, hi = (q.nice(float(x), 1.0) for x in thirds)
    if not lo < hi:  # a tight history: keep a decimal rather than merge two bands
        lo, hi = (round(float(x), 1) for x in thirds)
    if not lo < hi:
        return None
    actual = float(today.sum() / 1000)
    edges = [lo, hi]
    labels = [f"Under {lo:g} GWh", f"{lo:g} to {hi:g} GWh", f"Over {hi:g} GWh"]
    probs = _norm([float((past < lo).mean()), float(((past >= lo) & (past < hi)).mean()), float((past >= hi).mean())])
    won = int(np.searchsorted(edges, actual, side="right"))
    return q.MarketQuestion(
        id=f"GB-wind-off-band-{end_hour:02d}", kind="ghost_wind_band", target_hour=end_hour - 1, unit="GWh", threshold=0.0,
        text=f"How much wind will Britain pay to switch off between midnight and {end_hour:02d}:00?", model_p=0.0,
        model_note=f"History only, not a forecast: the previous {len(past)} days split at {lo:g} and {hi:g} GWh",
        outcome=f"b{won}", actual=actual, choices=[{"id": f"b{i}", "label": labels[i], "p": probs[i]} for i in range(3)],
    )


def choice_questions(replay: dict, boalf: pd.DataFrame | None = None, net_import: pd.DataFrame | None = None, start: int = 12, end: int = 18) -> list[q.MarketQuestion]:
    day = pd.Timestamp(replay["event"], tz="UTC")
    made = [price_bucket(replay, "GB", "price_da", 18, start, end), which_zone(replay, 17, start, end), peak_block(replay, end=end),
            import_export(day, net_import, 19, start, end), wind_band(day, boalf, end)]
    return sorted((x for x in made if x), key=lambda x: (x.target_hour, x.id))
