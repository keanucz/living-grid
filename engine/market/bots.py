"""Bot league rules for the mystery-day market: who trades, how big, and the Nowcaster.

Every bot turns its own P10/P50/P90 for a question's hour into a probability (pipeline.models.bots.prob_above, the
same rule as questions.prob_above) and trades towards it at the start of the round. Stakes follow fractional Kelly:

    full Kelly = the number of shares that maximises expected log wealth, given the bot's bankroll and the LMSR cost
                 (so it stops short of its own belief, more so with a small bankroll);
    position = fraction * full Kelly, at most CAP shares

so a bot that is sure and far from the room stakes more, and a small fraction keeps a lucky guess from being ruinous.
Fractions are fixed by hand, higher for the models that backtested better, not fitted to any outcome.

The Nowcaster is not given a forecast of its own. It starts from Our model's view and, at each tick, shifts it by how
far the hours already played came in above or below that forecast (the error decays as it looks further ahead) and
narrows the band as the question draws near, so it improves through the round as a player watching the feed can.
It reads only hours strictly before the clock.
"""

from dataclasses import dataclass

import numpy as np

from engine.market import lmsr

MODEL_MAX_SHARES = 150.0  # also the cap in book.py and the module
NOWCASTER = "bot_nowcaster"
OUR_MODEL = "lgbm_q"
ERROR_DECAY_PER_HOUR = 0.9  # share of a forecast miss still expected one hour later
LEAD_H = 12  # the horizon the as-of bands describe
MIN_BAND_SHARE = 0.25
P_FLOOR, P_CEIL = 0.03, 0.97


@dataclass(frozen=True)
class Profile:
    title: str
    method: str
    kelly: float
    cap: float = MODEL_MAX_SHARES


# Trade order is this order: the naive bots first, the strongest last, each facing the price the others left.
PROFILES: dict[str, Profile] = {
    "bot_last_week": Profile("Last week", "Same hour seven days ago, band from its own recent errors.", 0.10),
    "bot_yesterday": Profile("Yesterday", "Same hour yesterday, band from its own recent errors.", 0.15),
    "bot_engineer": Profile("The Engineer", "Merit order: price from residual load, shifted by gas and carbon costs.", 0.35),
    OUR_MODEL: Profile("Our model", "LightGBM quantile regression on 18 features.", 0.50),
    "bot_committee": Profile("The Committee", "Quantile regression averaging of the others, then conformal.", 0.50),
    NOWCASTER: Profile("The Nowcaster", "Our model, corrected by the hours already played.", 0.35),
}
ORDER = tuple(PROFILES)


def specs() -> list[dict]:
    return [{"name": n, "title": p.title, "method": p.method, "kelly": p.kelly} for n, p in PROFILES.items()]


def full_kelly_shares(p_win: float, side: str, bankroll: float, q_yes: float, q_no: float, b: float = lmsr.B) -> float:
    """Shares of `side` that maximise expected log wealth for a bettor who wins with probability p_win and pays the LMSR cost.

    Bisection on the derivative of p ln(W - C(s) + s) + (1 - p) ln(W - C(s)); the marginal price rises as it buys, so the
    optimum stops short of the belief by an amount that grows as the bankroll shrinks.
    """
    price = lmsr.price_yes(q_yes, q_no, b)
    price = price if side == "yes" else 1 - price
    if p_win <= price or bankroll <= 0:
        return 0.0
    reach_side, reach = lmsr.shares_to_reach(q_yes, q_no, p_win if side == "yes" else 1 - p_win, b)
    hi = reach if reach_side == side else 0.0

    def slope(shares: float) -> float:
        cost = lmsr.trade_cost(q_yes, q_no, side, shares, b)
        after = lmsr.price_yes(q_yes + (shares if side == "yes" else 0), q_no + (shares if side == "no" else 0), b)
        marginal = after if side == "yes" else 1 - after
        left = bankroll - cost
        if left <= 0:
            return -1.0
        return p_win * (1 - marginal) / (left + shares) - (1 - p_win) * marginal / left

    lo = 0.0
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if slope(mid) > 0 else (lo, mid)
    return lo


def kelly_shares(p: float, price_yes: float, bankroll: float, fraction: float, cap: float = MODEL_MAX_SHARES,
                 b: float = lmsr.B, q_yes: float = 0.0, q_no: float = 0.0) -> tuple[str, float]:
    """(side, shares) a fractional-Kelly bettor with belief p takes now: `fraction` of the full-Kelly position, at most cap.

    price_yes is only used to pick the side; the book's q_yes and q_no set the real price. 0 shares when there is no edge.
    """
    p = min(max(p, 1e-6), 1 - 1e-6)
    side = "yes" if p >= price_yes else "no"
    full = full_kelly_shares(p if side == "yes" else 1 - p, side, bankroll, q_yes, q_no, b)
    return side, float(max(0.0, min(fraction * full, cap)))


def band_probability(threshold: float, p10: float, p50: float, p90: float) -> float:
    """P(value > threshold) through the three quantiles, as questions.prob_above."""
    if not p10 < p50 < p90:
        return 0.5 if threshold == p50 else (P_FLOOR if threshold > p50 else P_CEIL)
    cdf = 0.5 - 0.4 * (p50 - threshold) / (p50 - p10) if threshold <= p50 else 0.5 + 0.4 * (threshold - p50) / (p90 - p50)
    return float(np.clip(1 - cdf, P_FLOOR, P_CEIL))


def nowcast_probability(threshold: float, target_hour: int, clock: int, profile: dict[int, dict], observed: dict[int, float],
                        fallback: float) -> float:
    """The Nowcaster's P(above) for a question at `clock`, from the model's hourly profile and hours already played.

    profile: hour -> {p10, p50, p90} from Our model's as-of forecast. observed: hour -> actual value. Only hours < clock
    are read (an hour is revealed when the clock passes it). With nothing played yet, or no profile, returns `fallback`.
    """
    played = sorted(h for h in observed if h < clock and h in profile and h <= target_hour)
    target = profile.get(target_hour)
    if not played or target is None:
        return fallback
    h0 = played[-1]
    miss = observed[h0] - profile[h0]["p50"]
    gap = max(1, target_hour - h0)
    centre = target["p50"] + miss * ERROR_DECAY_PER_HOUR**gap
    width = min(1.0, max(MIN_BAND_SHARE, (gap / LEAD_H) ** 0.5))
    lo, hi = target["p50"] - target["p10"], target["p90"] - target["p50"]
    return band_probability(threshold, centre - lo * width, centre, centre + hi * width)
