"""The five calls of "Beat the model" for one mystery day, built from a replay file.

    uv run python -m engine.beat.build [--day 2026-10-26 | --all] [--dry-run]

Each call has options, the right answer (from what happened), the model's call with its top reason, and what each bot
would answer. Only forecasts made before the day feed the model and bot answers, never the day's own actuals; the
answer comes from the actuals. Calls the data cannot support are left out, and a day with fewer than three is refused.
Sends beat_day_put to the SpacetimeDB module (admin identity via LG_STDB_URL / LG_STDB_TOKEN(_FILE)).

  price_band     which band will GB's day-ahead price be in at 18:00 (five bands)
  battery        charge, hold or sell a 1 MW battery for the next hour, on GB prices (see battery_call)
  import_export  will Britain import or export at 19:00 (history only)
  which_zone     which zone will have the highest day-ahead price at 17:00
  wind_over      will Britain pay more than X GWh of wind to switch off by the end of play (history only)
"""

import argparse
import json
import logging
from datetime import date

import numpy as np
import pandas as pd

from engine.market import bots as market_bots
from engine.market import question_types as qt
from engine.market import questions as q
from engine.replay_days import list_days

log = logging.getLogger("engine.beat.build")

BOTS = ("bot_yesterday", "bot_engineer", "lgbm_q", "bot_committee")
OUR_MODEL = market_bots.OUR_MODEL
MIN_CALLS = 3
ROUND_TRIP = 0.88
DEGRADATION = 2.0  # GBP per MWh of grid energy, as in engine.game.settle
BAND_QUANTILES = (0.2, 0.4, 0.6, 0.8)
MIN_CONF, MAX_CONF = 50, 95


def conf(p: float) -> int:
    """A confidence in whole per cent, 50 to 95, from the probability of the chosen option."""
    return int(round(float(np.clip(p, MIN_CONF / 100, MAX_CONF / 100)) * 100))


def pick(probs: dict[str, float]) -> tuple[str, int]:
    best = max(probs, key=lambda k: (probs[k], k))
    return best, conf(probs[best])


def inv_cdf(u: float, p10: float, p50: float, p90: float) -> float:
    """Inverse of qt.cdf through the three quantiles."""
    return p10 + (u - 0.1) / 0.4 * (p50 - p10) if u <= 0.5 else p50 + (u - 0.5) / 0.4 * (p90 - p50)


def band_probs(edges: list[float], p10: float, p50: float, p90: float) -> list[float]:
    cum = [0.0] + [qt.cdf(e, p10, p50, p90) for e in edges] + [1.0]
    return qt._norm([cum[i + 1] - cum[i] for i in range(len(edges) + 1)])


def battery_action(p0: float, p1: float) -> str:
    """What a 1 MW battery should do now given this hour's price p0 and next hour's p1 (GBP/MWh).
    Charging now and selling next hour pays if ROUND_TRIP * p1 beats p0 by the degradation cost; selling stored energy now
    beats waiting if p0 beats p1 by the same margin; otherwise hold."""
    if ROUND_TRIP * p1 - p0 > DEGRADATION:
        return "charge"
    if p0 - p1 > DEGRADATION:
        return "sell"
    return "hold"


def _bot_points(league: dict | None, zone: str, target: str, ts: str) -> dict[str, dict]:
    for s in (league or {}).get("series", []):
        if s["zone"] == zone and s["target"] == target:
            for pt in s["points"]:
                if pd.Timestamp(pt["ts"]) == pd.Timestamp(ts):
                    return pt["bots"]
    return {}


def _point(replay: dict, zone: str, target: str, hour: int) -> tuple[dict, dict] | None:
    s = next((s for s in replay["series"] if s["zone"] == zone and s["target"] == target), None)
    p = q._point(s, hour) if s else None
    return (s, p) if s and p and all(p.get(k) is not None for k in ("actual", "p10", "p50", "p90")) else None


def _reason(p: dict, sym: str) -> str:
    if p.get("explanation"):
        return str(p["explanation"])
    made = pd.Timestamp(p["made_at"])
    return (f"No explanation stored for this hour. Forecast made {(pd.Timestamp(p['ts']) - made).total_seconds() / 3600:.0f} h ahead: "
            f"median {sym}{p['p50']:.0f}, 80% range {sym}{p['p10']:.0f} to {sym}{p['p90']:.0f}")


def _with_model(call: dict, bots_ans: dict) -> dict:
    """Our model is also a bot (lgbm_q): it always answers like the model; others come from the league data when present."""
    call["bots"] = {**bots_ans, OUR_MODEL: {"choice": call["model"]["choice"], "confidence": call["model"]["confidence"]}}
    return call


def price_band_call(replay: dict, league: dict | None, hour: int = 18, start: int = 12, end: int = 18) -> dict | None:
    hour = q.fit_hour(hour, start, end)
    sp = _point(replay, "GB", "price_da", hour)
    if not sp:
        return None
    s, p = sp
    sym = q.SYMBOL.get(s["unit"], "")
    edges = [q.nice(inv_cdf(u, p["p10"], p["p50"], p["p90"])) for u in BAND_QUANTILES]
    if sorted(set(edges)) != edges:
        return None
    labels = [f"Under {sym}{edges[0]:.0f}", *[f"{sym}{edges[i]:.0f} to {sym}{edges[i + 1]:.0f}" for i in range(3)], f"Over {sym}{edges[3]:.0f}"]
    ids = [f"b{i}" for i in range(5)]
    model = pick(dict(zip(ids, band_probs(edges, p["p10"], p["p50"], p["p90"]), strict=True)))
    won = int(np.searchsorted(edges, p["actual"], side="right"))
    bots_ans = {}
    for name, b in _bot_points(league, "GB", "price_da", p["ts"]).items():
        if name in BOTS:
            c, k = pick(dict(zip(ids, band_probs(edges, b["p10"], b["p50"], b["p90"]), strict=True)))
            bots_ans[name] = {"choice": c, "confidence": k}
    return _with_model({
        "id": f"price-band-{hour:02d}", "kind": "price_band", "hour": hour, "unit": s["unit"],
        "text": f"Which band will Britain's day-ahead price be in at {hour:02d}:00?",
        "options": [{"id": i, "label": label} for i, label in zip(ids, labels, strict=True)],
        "answer": ids[won], "actual_text": f"It was {sym}{p['actual']:.0f}/MWh, in the band {labels[won]}.",
        "model": {"choice": model[0], "confidence": model[1], "reason": _reason(p, sym)},
    }, bots_ans)


def battery_call(replay: dict, league: dict | None, hour: int = 17, start: int = 12, end: int = 18) -> dict | None:
    hour = q.fit_hour(hour, start, end)
    a, b = _point(replay, "GB", "price_da", hour), _point(replay, "GB", "price_da", hour + 1) if hour < 23 else None
    if not a or not b:
        return None
    (s, p0), (_, p1) = a, b
    sym = q.SYMBOL.get(s["unit"], "")

    def probs(q0: dict, q1: dict, seed: int) -> dict[str, float]:
        x0, x1 = qt.draws(q0["p10"], q0["p50"], q0["p90"], seed=seed), qt.draws(q1["p10"], q1["p50"], q1["p90"], seed=seed + 1)
        acts = np.where(ROUND_TRIP * x1 - x0 > DEGRADATION, "charge", np.where(x0 - x1 > DEGRADATION, "sell", "hold"))
        return dict(zip(("charge", "hold", "sell"), qt._norm([float((acts == k).mean()) for k in ("charge", "hold", "sell")]), strict=True))

    model = pick(probs(p0, p1, 0))
    answer = battery_action(p0["actual"], p1["actual"])
    bots_ans = {}
    b0, b1 = _bot_points(league, "GB", "price_da", p0["ts"]), _bot_points(league, "GB", "price_da", p1["ts"])
    for name in BOTS:
        if name in b0 and name in b1:
            c, k = pick(probs(b0[name], b1[name], 10))
            bots_ans[name] = {"choice": c, "confidence": k}
    reason = (f"Forecast median {sym}{p0['p50']:.0f} now and {sym}{p1['p50']:.0f} at {hour + 1:02d}:00: "
              f"{'the next hour looks dearer than the round trip costs, so store energy now' if model[0] == 'charge' else 'this hour looks dearer than the next, so sell what is stored' if model[0] == 'sell' else 'the gap is too small to pay for the losses, so wait'}.")
    return _with_model({
        "id": f"battery-{hour:02d}", "kind": "battery", "hour": hour, "unit": s["unit"],
        "text": f"Your 1 MW battery at {hour:02d}:00: charge, hold or sell for the next hour?",
        "options": [{"id": "charge", "label": "Charge"}, {"id": "hold", "label": "Hold"}, {"id": "sell", "label": "Sell"}],
        "answer": answer,
        "actual_text": f"Prices were {sym}{p0['actual']:.0f} then {sym}{p1['actual']:.0f}/MWh, so the best move was to {answer}. (88% round trip, {sym}{DEGRADATION:.0f}/MWh wear.)",
        "model": {"choice": model[0], "confidence": model[1], "reason": reason},
    }, bots_ans)


def _from_question(x: q.MarketQuestion, kind: str, bots_ans: dict | None = None) -> dict:
    """A calls entry from a choice or yes/no question of engine.market. History-only questions have no better bot answer
    than the base rate, so every bot answers like the model on them."""
    if x.choices:
        options = [{"id": c["id"], "label": c["label"]} for c in x.choices]
        choice, c = pick({c["id"]: c["p"] for c in x.choices})
        answer = str(x.outcome)
    else:
        options = [{"id": "yes", "label": "Yes"}, {"id": "no", "label": "No"}]
        choice, c = pick({"yes": x.model_p, "no": 1 - x.model_p})
        answer = "yes" if x.outcome else "no"
    labels = {o["id"]: o["label"] for o in options}
    call = {
        "id": x.id, "kind": kind, "hour": x.target_hour, "unit": x.unit, "text": x.text, "options": options, "answer": answer,
        "actual_text": f"It was {labels[answer]} (actual {x.actual:.1f} {x.unit}).", "model": {"choice": choice, "confidence": c, "reason": x.model_note},
    }
    if bots_ans is None:
        bots_ans = {name: {"choice": choice, "confidence": c} for name in BOTS}
    return _with_model(call, bots_ans)


def which_zone_call(replay: dict, league: dict | None, hour: int = 17, start: int = 12, end: int = 18) -> dict | None:
    x = qt.which_zone(replay, hour, start, end)
    if not x:
        return None
    h = x.target_hour
    zones = [c["id"] for c in x.choices]
    bots_ans = {}
    for name in BOTS:
        sims = []
        for i, z in enumerate(zones):
            s = next((s for s in replay["series"] if s["zone"] == z and s["target"] == "price_da"), None)
            p = q._point(s, h) if s else None
            b = _bot_points(league, z, "price_da", p["ts"]).get(name) if p else None
            if not b:
                break
            fx = qt.EUR_PER_GBP if s["unit"].startswith("GBP") else 1.0
            sims.append(qt.draws(b["p10"] * fx, b["p50"] * fx, b["p90"] * fx, seed=i))
        else:
            wins = np.bincount(np.vstack(sims).argmax(axis=0), minlength=len(zones)) / len(sims[0])
            c, k = pick(dict(zip(zones, qt._norm(list(wins)), strict=True)))
            bots_ans[name] = {"choice": c, "confidence": k}
    call = _from_question(x, "which_zone", bots_ans)
    call["text"] = f"Which zone will have the highest day-ahead price at {h:02d}:00?"
    return call


def calls(replay: dict, boalf: pd.DataFrame | None = None, net_import: pd.DataFrame | None = None, league: dict | None = None,
          start: int = 12, end: int = 18) -> list[dict]:
    day = pd.Timestamp(replay["event"], tz="UTC")
    wind = q.wind_question(day, boalf, end) if boalf is not None else None
    flow = qt.import_export(day, net_import, 19, start, end)
    made = [price_band_call(replay, league, 18, start, end), battery_call(replay, league, 17, start, end),
            _from_question(flow, "import_export") if flow else None, which_zone_call(replay, league, 17, start, end),
            _from_question(wind, "wind_over") if wind else None]
    return [c for c in made if c]


def validate(cs: list[dict]) -> None:
    """The checks beat_day_put makes in the module, so a bad day fails here first."""
    if len(cs) < MIN_CALLS:
        raise ValueError(f"only {len(cs)} calls could be built; need {MIN_CALLS}")
    for c in cs:
        ids = [o["id"] for o in c["options"]]
        assert len(ids) >= 2 and len(set(ids)) == len(ids), c["id"]
        assert c["answer"] in ids and c["model"]["choice"] in ids and c["model"]["reason"] and c["text"], c["id"]
        for name, a in c["bots"].items():
            assert name in BOTS and a["choice"] in ids and isinstance(a["confidence"], int) and MIN_CONF <= a["confidence"] <= 100, (c["id"], name)


def regime(r: dict) -> str:
    from engine.game import battery_pool

    return battery_pool.regime(r)


def payload(day: date, replay: dict, **kw) -> list:
    cs = calls(replay, **kw)
    validate(cs)
    return [day.isoformat(), regime(replay), json.dumps(cs)]


def main() -> None:
    from engine import replay as rp
    from engine.market import botdata
    from engine.publisher.client import from_env
    from pipeline import cache

    ap = argparse.ArgumentParser()
    ap.add_argument("--day", type=date.fromisoformat)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    days = list_days(rp.path(rp.HEADLINE_EVENT).parent) if args.all else [args.day or rp.HEADLINE_EVENT]
    client = None if args.dry_run else from_env()
    try:
        boalf = cache.read("actuals/elexon_boalf_mwh")
        boalf = boalf[boalf["zone"] == "GB"][["ts", "value"]]
    except FileNotFoundError:
        boalf = None
    try:
        from engine import data

        net = qt.gb_net_import(data.actuals())
    except Exception:  # noqa: BLE001
        net = None
    for d in days:
        r = rp.load(d)
        if r is None:
            log.warning("no replay for %s", d)
            continue
        try:
            args_ = payload(d, r, boalf=boalf, net_import=net, league=botdata.load(d))
        except ValueError as e:
            log.warning("skipping %s: %s", d, e)
            continue
        if client:
            client.call("beat_day_put", *args_)
        log.info("beat day %s %s %d calls%s", d, args_[1], len(json.loads(args_[2])), " (dry run)" if client is None else "")


if __name__ == "__main__":
    main()
