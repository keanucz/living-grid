"""Logarithmic market scoring rule (Hanson) for a yes/no question.

C(q_yes, q_no) = b ln(e^(q_yes/b) + e^(q_no/b)); a trade costs C(after) - C(before); the yes price is the
room's probability. The market maker can lose at most b ln 2 points per question.
"""

import math

B = 100.0  # liquidity: about 100 shares move a 50% price to 73%


def cost(q_yes: float, q_no: float, b: float = B) -> float:
    m = max(q_yes, q_no)
    return m + b * math.log(math.exp((q_yes - m) / b) + math.exp((q_no - m) / b))


def price_yes(q_yes: float, q_no: float, b: float = B) -> float:
    return 1.0 / (1.0 + math.exp((q_no - q_yes) / b))


def trade_cost(q_yes: float, q_no: float, side: str, shares: float, b: float = B) -> float:
    """Points paid for `shares` of `side` (negative shares sell and return a negative cost)."""
    if side == "yes":
        return cost(q_yes + shares, q_no, b) - cost(q_yes, q_no, b)
    if side == "no":
        return cost(q_yes, q_no + shares, b) - cost(q_yes, q_no, b)
    raise ValueError("side must be yes or no")


def shares_to_reach(q_yes: float, q_no: float, p: float, b: float = B) -> tuple[str, float]:
    """The side and number of shares that move the yes price to p."""
    p = min(max(p, 1e-6), 1 - 1e-6)
    gap = b * math.log(p / (1 - p)) - (q_yes - q_no)
    return ("yes", gap) if gap >= 0 else ("no", -gap)
