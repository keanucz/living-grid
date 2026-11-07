"""Shared machinery for world events: shock the latest features, re-predict, and price the difference.

Each event module builds a `Shock` (feature edits plus a structural residual-load change per zone)
and calls `evaluate`. The price change per hour is the model's response when it reacts to the
edited features; where it does not (e.g. far outside training data, or a stub model), we fall back to
a merit-order slope estimate. The method used is stated in the result.
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

import numpy as np
import pandas as pd

from engine import data
from pipeline import features as pipeline_features
from pipeline import models

EUR_PER_GBP = 1.15
# Rough slope of each zone's merit order near typical winter load, price change per GW of residual load.
# Standard-estimate magnitudes, labelled as such on screen.
MERIT_SLOPE_PER_GW = {"GB": 4.0, "FR": 3.0, "DE-LU": 1.5, "NL": 4.5, "BE": 5.0, "NO2": 1.0}
SLOPE_UNCERTAINTY = 0.4  # +/- 40% on the structural estimate
MODEL_RESPONSE_EPS = 0.05  # currency/MWh: below this the model is treated as not responding
BATTERY_MW, BATTERY_MWH, BATTERY_RTE = 1.0, 2.0, 0.88
GROUP_PHRASES = {
    "wind": "wind",
    "solar": "solar",
    "demand": "demand",
    "gas": "gas",
    "carbon": "carbon",
    "imports": "imports",
    "time_of_day": "time of day",
}


@dataclass
class Shock:
    title: str
    target: str
    magnitude: float
    hours: int
    clamped: bool
    group: str  # explanation group the structural effect is attributed to
    phrase: str  # e.g. "less from Norway"
    edit: callable = None  # (features DataFrame) -> edited copy, for the model path
    residual_mw: dict[str, float] = field(default_factory=dict)  # structural path, per zone
    structural_delta: dict[str, float] = field(default_factory=dict)  # direct price change per zone, if known
    ghost_wind: dict | None = None


def clamp(value: float, lo: float, hi: float) -> tuple[float, bool]:
    v = float(min(max(value, lo), hi))
    return v, v != value


def latest_features() -> pd.DataFrame:
    return pipeline_features.latest().sort_values(["zone", "ts"]).reset_index(drop=True)


def money(v: float, currency: str) -> str:
    sym = "£" if currency == "GBP" else "€"
    return f"{'-' if v < 0 else '+'}{sym}{abs(v):,.0f}"


def _structural(feats: pd.DataFrame, shock: Shock) -> pd.Series:
    by_zone = {z: shock.residual_mw.get(z, 0.0) / 1000 * MERIT_SLOPE_PER_GW[z] for z in data.ZONES}
    for z, d in shock.structural_delta.items():
        by_zone[z] = by_zone.get(z, 0.0) + d
    return feats["zone"].map(by_zone).fillna(0.0)


def _battery(prices: np.ndarray) -> float:
    """Simple daily arbitrage estimate: charge the cheapest hours, discharge the dearest."""
    n = int(BATTERY_MWH / BATTERY_MW)
    if len(prices) < 2 * n:
        return 0.0
    s = np.sort(prices)
    return float(BATTERY_MW * (s[-n:].sum() * BATTERY_RTE - s[:n].sum()))


def evaluate(req, shock: Shock, feats: pd.DataFrame | None = None) -> dict:
    feats = latest_features() if feats is None else feats.reset_index(drop=True)
    before = models.predict(feats)
    after = models.predict(shock.edit(feats.copy())) if shock.edit else before
    model_d = {q: (after[q] - before[q]).to_numpy(float) for q in ("p10", "p50", "p90")}

    responds = feats.assign(r=np.abs(model_d["p50"])).groupby("zone")["r"].mean() > MODEL_RESPONSE_EPS
    struct = _structural(feats, shock).to_numpy(float)
    use_model = feats["zone"].map(responds).fillna(False).to_numpy(bool)
    lo, hi = struct * (1 - SLOPE_UNCERTAINTY), struct * (1 + SLOPE_UNCERTAINTY)
    d50 = np.where(use_model, model_d["p50"], struct)
    d10 = np.where(use_model, np.minimum(model_d["p10"], model_d["p50"]), np.minimum(lo, hi))
    d90 = np.where(use_model, np.maximum(model_d["p90"], model_d["p50"]), np.maximum(lo, hi))

    demand = feats["load_fc_mw"].to_numpy(float)
    feats = feats.assign(d10=d10, d50=d50, d90=d90, demand=demand, p50_before=before["p50"].to_numpy(float))
    zones, total = [], np.zeros(3)
    winners, losers, battery = [], [], []
    for z in data.ZONES:
        g = feats[feats["zone"] == z].head(shock.hours)
        if g.empty:
            continue
        cur = data.CURRENCY[z]
        scale = shock.hours / len(g)  # events longer than the forecast horizon repeat its average hour
        costs = np.array([(g[c] * g["demand"]).sum() * scale for c in ("d10", "d50", "d90")])
        to_gbp = 1.0 if cur == "GBP" else 1 / EUR_PER_GBP
        total += np.sort(costs) * to_gbp
        cost_gbp = float(costs[1] * to_gbp)
        zones.append(
            {
                "zone": z,
                "currency": cur,
                "avg_delta": round(float(g["d50"].mean()), 2),
                "cost": round(float(costs[1]), -3),
                "cost_gbp": round(cost_gbp, -3),
                "hourly": [
                    {
                        "ts": r.ts.to_pydatetime(),
                        "delta_p10": round(r.d10, 2),
                        "delta_p50": round(r.d50, 2),
                        "delta_p90": round(r.d90, 2),
                    }
                    for r in g.itertuples()
                ],
            }
        )
        if abs(cost_gbp) >= 1000:
            consumers = {"who": f"Consumers in {data.NAMES[z]}", "gbp": round(-cost_gbp, -3)}
            producers = {"who": f"Generators in {data.NAMES[z]}", "gbp": round(cost_gbp, -3)}
            (losers if cost_gbp > 0 else winners).append(consumers)
            (winners if cost_gbp > 0 else losers).append(producers)
        p0 = g["p50_before"].to_numpy(float)
        battery.append(
            {
                "zone": z,
                "profit_before": round(_battery(p0), 1),
                "profit_after": round(_battery(p0 + g["d50"].to_numpy(float)), 1),
                "currency": cur,
                "note": "Estimate for a 1 MW / 2 MWh battery over the next day, charging the cheapest "
                "and discharging the dearest hours (88% round trip).",
            }
        )

    winners = sorted(winners, key=lambda p: -p["gbp"])[:3]
    losers = sorted(losers, key=lambda p: p["gbp"])[:3]
    explanation = _explain(feats, shock, before, after, use_model)
    method = (
        "Model response to the shocked inputs"
        if use_model.all()
        else "Merit-order estimate (standard slopes per GW of residual load)"
        if not use_model.any()
        else "Model response where it reacts, merit-order estimate elsewhere"
    )
    return {
        "id": uuid.uuid4().hex[:12],
        "triggered_at": datetime.now(UTC),
        "request": req.model_dump(),
        "applied_magnitude": shock.magnitude,
        "applied_hours": shock.hours,
        "target": shock.target,
        "clamped": shock.clamped,
        "title": shock.title,
        "zones": zones,
        "cost_total_gbp": {"p10": round(total[0], -3), "p50": round(total[1], -3), "p90": round(total[2], -3)},
        "winners": winners,
        "losers": losers,
        "explanation": explanation,
        "battery": battery,
        "ghost_wind": shock.ghost_wind,
        "method_note": f"{method}. Cost is price change × forecast demand × hours. This approximates market coupling.",
        "kind": "scenario",
    }


def _explain(feats, shock: Shock, before, after, use_model) -> dict:
    gb = (feats["zone"] == "GB").to_numpy() if (feats["zone"] == "GB").any() else np.ones(len(feats), bool)
    contrib = dict.fromkeys(GROUP_PHRASES, 0.0)
    if use_model[gb].any():
        try:
            eb, ea = models.explain(feats), models.explain(shock.edit(feats.copy()) if shock.edit else feats)
            for k in contrib:
                contrib[k] = float((ea[k] - eb[k]).to_numpy(float)[gb].mean())
        except (KeyError, ValueError):
            pass
    zone = "GB" if (feats["zone"] == "GB").any() else feats["zone"].iloc[0]
    delta = float(feats.loc[gb, "d50"].mean())
    if abs(sum(contrib.values())) < MODEL_RESPONSE_EPS:
        contrib[shock.group] = delta
    cur = data.CURRENCY[zone]
    parts = sorted(((k, v) for k, v in contrib.items() if abs(v) >= 0.5), key=lambda kv: -abs(kv[1]))[:2]
    reasons = ", ".join(
        f"{shock.phrase if k == shock.group else GROUP_PHRASES[k]} ({money(v, cur)})" for k, v in parts
    )
    head = f"{data.NAMES[zone] if zone != 'GB' else 'GB'} price {'up' if delta >= 0 else 'down'} {money(abs(delta), cur)[1:]}"
    return {
        "sentence": f"{head}: {reasons}" if reasons else f"{head}: {shock.phrase}",
        "contributions": [{"group": k, "value": round(v, 2)} for k, v in contrib.items()],
        "kind": "scenario",
    }
