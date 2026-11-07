"""Reference implementation of the market rules the SpacetimeDB module runs (market.ts)."""

from dataclasses import dataclass, field

from engine.market import bots, lmsr

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
    # League fields. bot_p: each bot's own P(yes) (the Nowcaster's is updated while the question is open);
    # threshold/series/profile feed the Nowcaster (series is the feed label whose hourly actuals it watches;
    # profile maps hour -> {p10, p50, p90} from Our model's as-of forecast). Empty for history-only questions.
    bot_p: dict[str, float] = field(default_factory=dict)
    threshold: float | None = None
    series: str | None = None
    profile: dict[int, dict] = field(default_factory=dict)


@dataclass
class Book:
    b: float = lmsr.B
    clock: int = 0
    questions: dict[str, Question] = field(default_factory=dict)
    points: dict[str, float] = field(default_factory=dict)
    positions: dict[tuple[str, str], dict[str, float]] = field(default_factory=dict)
    observed: dict[str, dict[int, float]] = field(default_factory=dict)  # feed label -> hour -> value, hours already played

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

    def bot_trade(self, name: str, qid: str) -> float:
        """Bot `name` trades question qid towards its own probability, sized by its fractional-Kelly stake. Returns shares."""
        q = self.questions[qid]
        prof = bots.PROFILES[name]
        if name not in q.bot_p or q.settled or self.clock >= q.target_hour:
            return 0.0
        side, shares = bots.kelly_shares(q.bot_p[name], self.price(qid), self.account(name), prof.kelly, min(prof.cap, MAX_SHARES),
                                         self.b, q.q_yes, q.q_no)
        if shares > 1e-9:
            self.buy(name, qid, side, shares)
        return shares

    def open_round(self) -> None:
        """Every bot places its opening trades, question by question, in league order."""
        for qid in self.questions:
            for name in bots.ORDER:
                if name != bots.NOWCASTER:
                    self.bot_trade(name, qid)
            self.nowcast(qid)

    def nowcast(self, qid: str) -> float | None:
        """Refresh the Nowcaster's belief for an open question from the hours played so far, and let it trade."""
        q = self.questions[qid]
        if bots.NOWCASTER not in q.bot_p and not q.profile:
            return None
        if q.settled or self.clock >= q.target_hour or q.threshold is None or q.series is None:
            return q.bot_p.get(bots.NOWCASTER)
        base = q.bot_p.get(bots.OUR_MODEL, q.model_p)
        q.bot_p[bots.NOWCASTER] = bots.nowcast_probability(q.threshold, q.target_hour, self.clock, q.profile,
                                                           self.observed.get(q.series, {}), base)
        self.bot_trade(bots.NOWCASTER, qid)
        return q.bot_p[bots.NOWCASTER]

    def tick(self, hour: int, answers: dict[str, bool], feed: list[dict] | None = None) -> list[str]:
        """Move the clock; settle every open question whose hour has passed. Winning shares pay 1 point.

        feed: what happened in the hour just gone ({label, value} rows). It is shown to the Nowcaster only as the
        clock passes it; nothing for hours at or after the clock is ever stored.
        """
        for row in feed or []:
            self.observed.setdefault(row["label"], {})[hour - 1] = float(row["value"])
        self.clock = hour
        for qid, q in self.questions.items():
            if q.profile and not q.settled and hour < q.target_hour:
                self.nowcast(qid)
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

    def brier(self) -> dict:
        """Brier score (lower is better) of the room's closing price, Our model, and each bot over the questions it priced."""
        s = [q for q in self.questions.values() if q.settled]
        if not s:
            return {"room": None, "model": None, "n": 0}
        o = [1.0 if q.outcome else 0.0 for q in s]
        per_bot = {}
        for name in bots.ORDER:
            ps = [(q.bot_p[name], y) for q, y in zip(s, o) if name in q.bot_p]
            if ps:
                per_bot[name] = {"brier": sum((p - y) ** 2 for p, y in ps) / len(ps), "n": len(ps)}
        return {"room": sum((q.room_p - y) ** 2 for q, y in zip(s, o)) / len(s),
                "model": sum((q.model_p - y) ** 2 for q, y in zip(s, o)) / len(s), "n": len(s), "bots": per_bot}


def from_questions(qs, clock: int = 12, b: float = lmsr.B) -> Book:
    """A book for market questions (engine.market.questions.MarketQuestion), ready for open_round()."""
    m = Book(b=b, clock=clock)
    for q in qs:
        m.add(Question(q.id, q.target_hour, q.model_p, bot_p=dict(q.bot_p), threshold=q.threshold or None,
                       series=q.series or None, profile={r["hour"]: r for r in q.profile}))
    return m
