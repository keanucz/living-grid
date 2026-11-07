"""Reference implementation of the market rules the SpacetimeDB module runs (market.ts)."""

from dataclasses import dataclass, field

from engine.market import lmsr

START_POINTS = 1000.0
MAX_SHARES = 500.0
MODEL_MAX_SHARES = 150.0
MODEL = "model"


@dataclass
class Question:
    id: str
    target_hour: int
    model_p: float
    q_yes: float = 0.0
    q_no: float = 0.0
    settled: bool = False
    outcome: bool | None = None
    room_p: float | None = None


@dataclass
class Book:
    b: float = lmsr.B
    clock: int = 0
    questions: dict[str, Question] = field(default_factory=dict)
    points: dict[str, float] = field(default_factory=dict)
    positions: dict[tuple[str, str], dict[str, float]] = field(default_factory=dict)

    def add(self, q: Question) -> None:
        self.questions[q.id] = q

    def account(self, who: str) -> float:
        return self.points.setdefault(who, START_POINTS)

    def price(self, qid: str) -> float:
        q = self.questions[qid]
        return lmsr.price_yes(q.q_yes, q.q_no, self.b)

    def buy(self, who: str, qid: str, side: str, shares: float) -> float:
        q = self.questions[qid]
        if q.settled or self.clock >= q.target_hour:
            raise ValueError("question closed")
        if not 0 < shares <= MAX_SHARES:
            raise ValueError("shares out of range")
        paid = lmsr.trade_cost(q.q_yes, q.q_no, side, shares, self.b)
        if paid > self.account(who) + 1e-9:
            raise ValueError("not enough points")
        self.points[who] -= paid
        if side == "yes":
            q.q_yes += shares
        else:
            q.q_no += shares
        pos = self.positions.setdefault((who, qid), {"yes": 0.0, "no": 0.0})
        pos[side] += shares
        return paid

    def sell(self, who: str, qid: str, side: str, shares: float) -> float:
        q = self.questions[qid]
        pos = self.positions.get((who, qid), {"yes": 0.0, "no": 0.0})
        if q.settled or self.clock >= q.target_hour:
            raise ValueError("question closed")
        if not 0 < shares <= pos[side] + 1e-9:
            raise ValueError("cannot sell more than you hold")
        got = -lmsr.trade_cost(q.q_yes, q.q_no, side, -shares, self.b)
        self.points[who] = self.account(who) + got
        if side == "yes":
            q.q_yes -= shares
        else:
            q.q_no -= shares
        pos[side] -= shares
        return got

    def model_trade(self, qid: str) -> None:
        q = self.questions[qid]
        side, shares = lmsr.shares_to_reach(q.q_yes, q.q_no, q.model_p, self.b)
        shares = min(shares, MODEL_MAX_SHARES)
        if shares > 0:
            self.buy(MODEL, qid, side, shares)

    def tick(self, hour: int, answers: dict[str, bool]) -> list[str]:
        """Move the clock; settle every open question whose hour has passed. Winning shares pay 1 point."""
        self.clock = hour
        done = []
        for q in self.questions.values():
            if q.settled or hour <= q.target_hour:
                continue
            q.room_p = self.price(q.id)
            q.outcome = answers[q.id]
            q.settled = True
            win = "yes" if q.outcome else "no"
            for (who, qid), pos in self.positions.items():
                if qid == q.id:
                    self.points[who] = self.account(who) + pos[win]
            done.append(q.id)
        return done

    def brier(self) -> dict[str, float | int | None]:
        s = [q for q in self.questions.values() if q.settled]
        if not s:
            return {"room": None, "model": None, "n": 0}
        o = [1.0 if q.outcome else 0.0 for q in s]
        return {"room": sum((q.room_p - y) ** 2 for q, y in zip(s, o)) / len(s),
                "model": sum((q.model_p - y) ** 2 for q, y in zip(s, o)) / len(s), "n": len(s)}
