"""Plain-English explanations of the price forecast, from LightGBM pred_contrib on the p50 model.

contributions()   per row: base plus seven groups (wind, solar, demand, gas, carbon, imports, time_of_day) that
                  sum exactly to the raw p50 prediction. The zone's own price level is part of base.
explain_delta()   attribution difference between two feature rows (an intervention before and after, or a forecast
                  against a reference hour). The group deltas sum to the change in p50.
sentence()        "GB price up £18: wind down 40% (+£12), less imported power (+£5)".
All of it is model attribution: it says what drove the model's number, not a causal market finding.
"""

import pandas as pd

from pipeline import schemas

CURRENCY = {"GB": "£"}
DEFAULT_CURRENCY = "€"
MAX_DRIVERS = 3
MIN_DRIVER = 0.5


def grouped_zero(features: pd.DataFrame) -> pd.DataFrame:
    out = features[["ts", "zone"]].reset_index(drop=True)
    out["base"] = 0.0
    for g in schemas.GROUPS:
        out[g] = 0.0
    return out[schemas.EXPLANATION_COLUMNS]


def contributions(model, features: pd.DataFrame, target: str = "price_da") -> pd.DataFrame:
    """ts, zone, base and one column per group; base + groups equals the raw p50 prediction."""
    from .quantile import FEATURES, design

    if not model.boosters or target not in model.boosters:
        return grouped_zero(features)
    raw = model.boosters[target]["p50"].predict(design(features), pred_contrib=True, num_threads=1)
    by_feature = pd.DataFrame(raw[:, :-1], columns=FEATURES)
    out = features[["ts", "zone"]].reset_index(drop=True)
    out["base"] = raw[:, -1] + by_feature["zone_id"].to_numpy()
    for g in schemas.GROUPS:
        cols = [c for c, grp in schemas.FEATURE_GROUPS.items() if grp == g]
        out[g] = by_feature[cols].sum(axis=1).to_numpy()
    return out[schemas.EXPLANATION_COLUMNS]


def explain(features: pd.DataFrame) -> pd.DataFrame:
    """Per-row contributions grouped into wind, solar, demand, gas, carbon, imports, time_of_day."""
    from .quantile import active

    return contributions(active(), features)


def explain_delta(model, before: pd.DataFrame, after: pd.DataFrame, target: str = "price_da") -> pd.DataFrame:
    """Row-by-row change in each group's contribution, plus total (the change in p50)."""
    if len(before) != len(after):
        raise ValueError("before and after must have the same rows")
    b, a = contributions(model, before, target), contributions(model, after, target)
    if not (b["zone"].to_numpy() == a["zone"].to_numpy()).all():
        raise ValueError("before and after must be the same zones in the same order")
    out = a[["ts", "zone"]].copy()
    for g in schemas.GROUPS:
        out[g] = a[g].to_numpy() - b[g].to_numpy()
    out["total"] = out[schemas.GROUPS].sum(axis=1)
    return out


def _pct(before: float, after: float) -> int | None:
    if before is None or before <= 0:
        return None
    return round((after - before) / before * 100)


def _move(pct: int, word: str) -> str | None:
    if pct == 0:
        return None
    return f"{word} {'up' if pct > 0 else 'down'} {abs(pct)}%"


def _demand(before: pd.Series, after: pd.Series, contribution: float | None) -> str:
    """Word the demand group by a change that points the same way as its price effect.

    The group holds the load forecast, residual load (load left after wind and sun), temperature and two lagged prices,
    so its contribution can come from any of them. Naming only the load forecast read as a contradiction ('demand down
    20% (+£10)'). Candidates are tried in order and the first whose direction agrees with the contribution's sign is used:
    more demand, more residual load, colder weather and higher earlier prices all push a price up. With no contribution
    given the first change found is described, as before.
    """
    up = None if contribution is None or contribution == 0 else contribution > 0
    agrees = lambda moved_up: up is None or moved_up == up  # noqa: E731

    p = _pct(before["load_fc_mw"], after["load_fc_mw"])
    if p and agrees(p > 0):
        return _move(p, "demand")
    d = after["residual_load_mw"] - before["residual_load_mw"]
    if abs(d) >= 100 and agrees(d > 0):
        return f"demand left after wind and sun {'up' if d > 0 else 'down'} {abs(d) / 1000:.1f} GW"
    t = round(after["temperature_c"] - before["temperature_c"])
    if t and agrees(t < 0):
        return f"{'warmer' if t > 0 else 'colder'} by {abs(t)}°C"
    for col, label in (("price_lag_24h", "yesterday’s prices"), ("price_lag_168h", "last week’s prices")):
        q = _pct(before[col], after[col])
        if q and agrees(q > 0):
            return f"{label} {'higher' if q > 0 else 'lower'}"
    return "demand and recent prices"


def describe(group: str, before: pd.Series, after: pd.Series, contribution: float | None = None) -> str:
    """What changed in the inputs behind a group, in a few words. `contribution` (the group's price effect) lets the
    demand group pick wording that agrees with its sign."""
    if group == "wind":
        if before["wind_gen_fc_mw"] >= 100:
            p = _pct(before["wind_gen_fc_mw"], after["wind_gen_fc_mw"])
        else:
            p = _pct(before["wind_speed_100m"], after["wind_speed_100m"])
        return (p is not None and _move(p, "wind")) or "wind"
    if group == "solar":
        b, a = before["solar_irradiance_wm2"], after["solar_irradiance_wm2"]
        if b <= 0 < a:
            return "more sunshine"
        p = _pct(b, a)
        return (p is not None and _move(p, "sunshine")) or "solar"
    if group == "demand":
        return _demand(before, after, contribution)
    if group == "gas":
        p = _pct(before["gas_ttf_eur_mwh"], after["gas_ttf_eur_mwh"])
        if p:
            return _move(p, "gas")
        d = after["gas_marginal_share"] - before["gas_marginal_share"]
        if abs(d) >= 0.05:
            return f"gas {'more' if d > 0 else 'less'} often setting the price"
        return "gas"
    if group == "carbon":
        d = round(after["eua_eur_t"] - before["eua_eur_t"])
        return f"carbon {'up' if d > 0 else 'down'} €{abs(d)}/t" if d else "carbon"
    if group == "imports":
        d = after["import_net_mw"] - before["import_net_mw"]
        if abs(d) >= 1:
            return "more imported power" if d > 0 else "less imported power"
        return "imports"
    return "time of day"


def _money(x: float, cur: str) -> str:
    return f"{'+' if x >= 0 else '−'}{cur}{abs(x):.0f}"


def sentence(zone: str, deltas: pd.Series, before: pd.Series, after: pd.Series, cur: str | None = None) -> str:
    """One British-English sentence for a price change, naming the biggest drivers.

    deltas holds the group contributions to the change (explain_delta row); before and after are feature rows.
    """
    cur = cur or CURRENCY.get(zone, DEFAULT_CURRENCY)
    groups = {g: float(deltas[g]) for g in schemas.GROUPS}
    total = sum(groups.values())
    if round(abs(total)) == 0:
        return f"{zone} price little changed"
    head = f"{zone} price {'up' if total > 0 else 'down'} {cur}{abs(total):.0f}"
    ranked = sorted(groups.items(), key=lambda kv: -abs(kv[1]))
    shown = [(g, v) for g, v in ranked if round(abs(v)) >= 1 and abs(v) >= MIN_DRIVER][:MAX_DRIVERS]
    if not shown:
        return head
    parts = [f"{describe(g, before, after, v)} ({_money(v, cur)})" for g, v in shown]
    return f"{head}: {', '.join(parts)}"


def explain_change(model, before: pd.DataFrame, after: pd.DataFrame, target: str = "price_da") -> pd.DataFrame:
    """explain_delta plus a sentence per row. Use it for interventions (before vs after) and for replay."""
    d = explain_delta(model, before, after, target)
    b, a = before.reset_index(drop=True), after.reset_index(drop=True)
    d["sentence"] = [sentence(d.at[i, "zone"], d.loc[i], b.loc[i], a.loc[i]) for i in range(len(d))]
    return d


def reference_rows(features: pd.DataFrame) -> pd.DataFrame:
    """Default reference for a forecast: each zone's median feature row over the supplied hours."""
    cols = schemas.FEATURE_COLUMNS
    med = features.groupby("zone")[cols].median()
    ref = med.loc[features["zone"]].reset_index(drop=True)
    ref.insert(0, "zone", features["zone"].to_numpy())
    ref.insert(0, "ts", features["ts"].to_numpy())
    return ref


def explain_forecast(model, features: pd.DataFrame, reference: pd.DataFrame | None = None) -> pd.DataFrame:
    """Why each forecast hour differs from a reference (default: the zone's median hour in this batch)."""
    ref = reference_rows(features) if reference is None else reference
    return explain_change(model, ref, features.reset_index(drop=True))


__all__ = ["contributions", "describe", "explain", "explain_change", "explain_delta", "explain_forecast",
           "grouped_zero", "reference_rows", "sentence"]
