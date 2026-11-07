"""Clues for the clue shop: what the model sees for a question, precomputed per mystery day.

A clue is {id, label, cost, body}. They go into market_day_pool.clues_json as {"<question id>": [clue, ...]} (see
spacetime/module/src/reducers/clues.ts). Every number is something known before the day: forecast inputs as they stood
12 hours ahead (pipeline.features.build.build_history), the model's own forecast, and normals from the 30 days before.
Nothing here reads an actual, and build() refuses to return a clue whose text names the date or shows the answer.
"""

import re
from datetime import date

import pandas as pd

from pipeline import schemas

CLUE_COST = 40
NORMAL_DAYS = 30
ZONES = sorted(schemas.ZONES, key=len, reverse=True)
NAMES = {"GB": "Britain", "FR": "France", "DE-LU": "Germany", "NL": "the Netherlands", "BE": "Belgium", "NO2": "southern Norway"}


class ClueLeak(ValueError):
    pass


def zone_of(question_id: str) -> str:
    for z in ZONES:
        if question_id.startswith(f"{z}-"):
            return z
    return "GB"


def date_forms(day: date) -> list[str]:
    d = pd.Timestamp(day)
    return [d.strftime("%Y-%m-%d"), d.strftime("%Y%m%d"), f"{d.day} {d:%B}", f"{d.day} {d:%b}", f"{d:%B} {d.day}", f"{d:%b} {d.day}", f"{d.day}/{d.month}", f"{d:%A}"]


def check_text(text: str, day: date, actual: float | None = None) -> None:
    """Raise ClueLeak when text names the day (any usual spelling, or its weekday) or states the answer."""
    low = text.lower()
    for f in date_forms(day):
        if f.lower() in low:
            raise ClueLeak(f"clue names the date ({f!r}): {text!r}")
    if actual is not None and abs(actual) >= 1:
        shown = {f"{actual:.0f}", f"{actual:.1f}", f"{actual:.2f}"}
        for tok in re.findall(r"-?\d[\d,]*\.?\d*", text):
            if tok.replace(",", "") in shown:
                raise ClueLeak(f"clue shows the answer ({tok}): {text!r}")


def _row(feats: pd.DataFrame, zone: str, ts: pd.Timestamp):
    f = feats[(feats["zone"] == zone) & (feats["ts"] == ts)]
    return None if f.empty else f.iloc[0]


def _normal(feats: pd.DataFrame, zone: str, ts: pd.Timestamp, col: str) -> float | None:
    f = feats[(feats["zone"] == zone) & (feats["ts"].dt.hour == ts.hour) & (feats["ts"] < ts.normalize())]
    f = f[f["ts"] >= ts.normalize() - pd.Timedelta(days=NORMAL_DAYS)][col].dropna()
    return float(f.mean()) if len(f) >= 5 else None


def _clue(cid: str, label: str, body: str) -> dict:
    return {"id": cid, "label": label, "cost": CLUE_COST, "body": body}


def for_question(day: date, question_id: str, target_hour: int, feats: pd.DataFrame, explanation: str | None = None,
                 model_note: str = "") -> list[dict]:
    zone, name = zone_of(question_id), NAMES.get(zone_of(question_id), zone_of(question_id))
    ts = pd.Timestamp(day, tz="UTC") + pd.Timedelta(hours=target_hour)
    r = _row(feats, zone, ts)
    out = []
    if r is not None:
        hh = f"{target_hour:02d}:00"
        if pd.notna(r.get("wind_gen_fc_mw")):
            n = _normal(feats, zone, ts, "wind_gen_fc_mw")
            out.append(_clue("wind", "Wind forecast", f"Wind forecast for {name} at {hh}: {r['wind_gen_fc_mw']:,.0f} MW" + (f", against about {n:,.0f} MW at that hour over the past month." if n else ".")))
        if pd.notna(r.get("temperature_c")):
            n = _normal(feats, zone, ts, "temperature_c")
            out.append(_clue("temperature", "Temperature", f"Forecast temperature in {name} at {hh}: {r['temperature_c']:.1f} °C" + (f", {r['temperature_c'] - n:+.1f} °C against the past month's normal." if n is not None else ".")))
        if pd.notna(r.get("gas_ttf_eur_mwh")):
            week = feats[(feats["zone"] == zone) & (feats["ts"].dt.hour == ts.hour) & (feats["ts"] == ts - pd.Timedelta(days=7))]
            w = week["gas_ttf_eur_mwh"].dropna()
            move = f", {100 * (r['gas_ttf_eur_mwh'] / w.iloc[0] - 1):+.0f}% on a week earlier." if len(w) and w.iloc[0] else "."
            out.append(_clue("gas", "Gas price", f"Gas (TTF) is €{r['gas_ttf_eur_mwh']:.0f}/MWh{move}"))
        if pd.notna(r.get("load_fc_mw")):
            n = _normal(feats, zone, ts, "load_fc_mw")
            out.append(_clue("demand", "Demand forecast", f"Demand forecast for {name} at {hh}: {r['load_fc_mw']:,.0f} MW" + (f", {100 * (r['load_fc_mw'] / n - 1):+.0f}% against that hour's normal." if n else ".")))
        if pd.notna(r.get("import_net_mw")):
            v = r["import_net_mw"]
            out.append(_clue("flows", "Interconnector flows", f"{name} is expected to {'import' if v >= 0 else 'export'} about {abs(v):,.0f} MW through its interconnectors at {hh}."))
    say = (model_note.rstrip(". ") + ". " if model_note else "") + (explanation or "No single driver stands out for this hour.")
    out.append(_clue("model", "What our model says and why", say.strip()))
    return out


def build(day: date, questions: list, feats: pd.DataFrame, explanations: dict[str, str] | None = None) -> dict[str, list[dict]]:
    """Clues for every question (MarketQuestion objects), leak-checked against the day and each question's answer."""
    out = {}
    for q in questions:
        cs = for_question(day, q.id, q.target_hour, feats, (explanations or {}).get(q.id), q.model_note)
        for c in cs:
            check_text(c["body"] + " " + c["label"], day, q.actual if isinstance(q.actual, (int, float)) else None)
        out[q.id] = cs
    return out


def features_for(day: date, lead_h: int | None = None) -> pd.DataFrame:
    """As-of feature rows for the day and the NORMAL_DAYS before it, from the cache."""
    from pipeline.features import build as fb

    d = pd.Timestamp(day, tz="UTC")
    return fb.build_history(d - pd.Timedelta(days=NORMAL_DAYS), d + pd.Timedelta(hours=23), lead_h=lead_h or fb.HISTORY_LEAD_H)
