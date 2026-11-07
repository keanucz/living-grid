import { t, SenderError } from 'spacetimedb/server';
import { Identity } from 'spacetimedb';
import spacetimedb from '../schema';
import { requireAdmin } from '../auth';
import {
  BOT_MAX_SHARES, NOWCASTER, ORDER, OUR_MODEL, kellyShares, nowcastProbability, type Quantiles,
} from './league_math';

// Mystery-day prediction market, points only. engine/market starts a round (questions public, outcomes in a
// private table), the model trades as a player, then market_tick moves the game clock one hour at a time and
// settles each question once its hour has passed. Rules mirror engine/market/book.py, which holds the tests.
//
// LMSR: cost C(y, n) = b ln(e^(y/b) + e^(n/b)); a trade costs C(after) - C(before); price = the room's
// probability of yes. A winning share pays 1 point.

const START_POINTS = 1000;
const MAX_SHARES = 500;
const MODEL_MAX_SHARES = 150;
const ROUND = 1;
const MODEL_HEX = '00000000000000000000000000000000000000000000000000000000006d0de1';
const MODEL = Identity.fromString(MODEL_HEX);
const MODEL_NAME = 'Our model';

function cost(y: number, n: number, b: number): number {
  const m = Math.max(y, n);
  return m + b * Math.log(Math.exp((y - m) / b) + Math.exp((n - m) / b));
}
const priceYes = (y: number, n: number, b: number) => 1 / (1 + Math.exp((n - y) / b));
const posKey = (id: Identity, qid: string) => `${id.toHexString()}|${qid}`;

function round(ctx: any) {
  const r = ctx.db.market_round.id.find(ROUND);
  if (!r || r.status !== 'running') throw new SenderError('no market round is running');
  return r;
}

function account(ctx: any, id: Identity) {
  const a = ctx.db.market_account.identity.find(id);
  if (a) return a;
  const p = ctx.db.player.identity.find(id);
  if (!p) throw new SenderError('join first');
  const row = { identity: id, name: p.name, points: START_POINTS, is_model: false };
  ctx.db.market_account.insert(row);
  return row;
}

function openQuestion(ctx: any, r: any, qid: string) {
  const q = ctx.db.market_question.id.find(qid);
  if (!q) throw new SenderError(`unknown question ${qid}`);
  if (q.status !== 'open' || r.clock_hour >= q.target_hour) throw new SenderError('that question has closed');
  return q;
}

// Signed trade: shares > 0 buys, < 0 sells. Returns points paid (negative when selling).
function trade(ctx: any, r: any, who: Identity, qid: string, side: string, shares: number): number {
  if (side !== 'yes' && side !== 'no') throw new SenderError('side must be yes or no');
  if (!Number.isFinite(shares) || shares === 0 || Math.abs(shares) > MAX_SHARES) {
    throw new SenderError(`shares must be between 0 and ${MAX_SHARES}`);
  }
  const q = openQuestion(ctx, r, qid);
  const a = account(ctx, who);
  const key = posKey(who, qid);
  const pos = ctx.db.market_position.key.find(key) ?? { key, identity: who, question_id: qid, yes: 0, no: 0, spent: 0 };
  if (shares < 0 && -shares > pos[side] + 1e-9) throw new SenderError('cannot sell more than you hold');
  const y = q.q_yes + (side === 'yes' ? shares : 0);
  const n = q.q_no + (side === 'no' ? shares : 0);
  const paid = cost(y, n, r.b) - cost(q.q_yes, q.q_no, r.b);
  if (paid > a.points + 1e-9) throw new SenderError('not enough points');
  ctx.db.market_account.identity.update({ ...a, points: a.points - paid });
  ctx.db.market_question.id.update({ ...q, q_yes: y, q_no: n, price_yes: priceYes(y, n, r.b) });
  const next = { ...pos, [side]: pos[side] + shares, spent: pos.spent + paid };
  if (ctx.db.market_position.key.find(key)) ctx.db.market_position.key.update(next);
  else ctx.db.market_position.insert(next);
  return paid;
}

export const market_buy = spacetimedb.reducer(
  { question_id: t.string(), side: t.string(), shares: t.f64() },
  (ctx, { question_id, side, shares }) => {
    if (!(shares > 0)) throw new SenderError('shares must be positive');
    trade(ctx, round(ctx), ctx.sender, question_id, side, shares);
  }
);

export const market_sell = spacetimedb.reducer(
  { question_id: t.string(), side: t.string(), shares: t.f64() },
  (ctx, { question_id, side, shares }) => {
    if (!(shares > 0)) throw new SenderError('shares must be positive');
    trade(ctx, round(ctx), ctx.sender, question_id, side, -shares);
  }
);

const QuestionIn = t.object('MarketQuestionIn', {
  id: t.string(),
  text: t.string(),
  kind: t.string(),
  target_hour: t.u32(),
  unit: t.string(),
  threshold: t.f64(),
  model_p: t.f64(),
  model_note: t.string(),
});
const AnswerIn = t.object('MarketAnswerIn', { question_id: t.string(), outcome: t.bool(), actual: t.f64() });
const FeedIn = t.object('MarketFeedIn', { label: t.string(), value: t.f64(), unit: t.string() });

function clear(ctx: any) {
  const PK: Record<string, string> = {
    market_question: 'id', market_answer: 'question_id', market_position: 'key', market_feed: 'key',
    market_bot: 'name', market_bot_p: 'key', market_profile: 'question_id',
  };
  for (const tbl of Object.keys(PK)) {
    const pk = PK[tbl];
    for (const row of [...ctx.db[tbl].iter()]) ctx.db[tbl][pk].delete(row[pk]);
  }
  for (const a of [...ctx.db.market_account.iter()]) ctx.db.market_account.identity.delete(a.identity);
  for (const s of [...ctx.db.market_secret.iter()]) ctx.db.market_secret.round.delete(s.round);
  ctx.db.market_round.id.delete(ROUND);
}

// Admin: start a fresh round. Every account starts again at START_POINTS; the model then trades towards its
// probability on each question, at most MODEL_MAX_SHARES, like any other player.
export const market_start = spacetimedb.reducer(
  {
    title: t.string(),
    b: t.f64(),
    start_hour: t.u32(),
    end_hour: t.u32(),
    seconds_per_hour: t.u32(),
    questions: t.array(QuestionIn),
    answers: t.array(AnswerIn),
    day: t.string(),
  },
  (ctx, { title, b, start_hour, end_hour, seconds_per_hour, questions, answers, day }) => {
    requireAdmin(ctx);
    if (!(b > 0)) throw new SenderError('b must be positive');
    if (questions.length !== answers.length) throw new SenderError('one answer per question');
    clear(ctx);
    const r = {
      id: ROUND, status: 'running', title, day_revealed: '', clock_hour: start_hour, start_hour, end_hour,
      seconds_per_hour, b, room_brier: -1, model_brier: -1, n_settled: 0, started_at: ctx.timestamp,
    };
    ctx.db.market_round.insert(r);
    ctx.db.market_secret.insert({ round: ROUND, day });
    for (const a of answers) ctx.db.market_answer.insert(a);
    for (const q of questions) {
      if (!ctx.db.market_answer.question_id.find(q.id)) throw new SenderError(`no answer for ${q.id}`);
      ctx.db.market_question.insert({
        ...q, q_yes: 0, q_no: 0, price_yes: 0.5, status: 'open', outcome: '', actual: 0, room_p_close: -1,
      });
    }
    ctx.db.market_account.insert({ identity: MODEL, name: MODEL_NAME, points: START_POINTS, is_model: true });
    for (const q of questions) {
      const p = Math.min(Math.max(q.model_p, 1e-6), 1 - 1e-6);
      const gap = b * Math.log(p / (1 - p));
      const side = gap >= 0 ? 'yes' : 'no';
      const shares = Math.min(Math.abs(gap), MODEL_MAX_SHARES);
      if (shares > 0) trade(ctx, r, MODEL, q.id, side, shares);
    }
  }
);

// Admin: move the clock to `hour`, record what happened in the hour just gone, and settle every open question
// whose hour has passed. Winning shares pay 1 point; Brier scores compare the closing price with the model.
export const market_tick = spacetimedb.reducer({ hour: t.u32(), feed: t.array(FeedIn) }, (ctx, { hour, feed }) => {
  requireAdmin(ctx);
  const r = round(ctx);
  for (const f of feed) {
    const key = `${hour - 1}|${f.label}`;
    const row = { key, hour: hour - 1, ...f };
    if (ctx.db.market_feed.key.find(key)) ctx.db.market_feed.key.update(row);
    else ctx.db.market_feed.insert(row);
  }
  nowcastOpen(ctx, { ...r, clock_hour: hour });
  let room = r.room_brier < 0 ? 0 : r.room_brier * r.n_settled;
  let model = r.model_brier < 0 ? 0 : r.model_brier * r.n_settled;
  let n = r.n_settled;
  for (const q of [...ctx.db.market_question.iter()]) {
    if (q.status !== 'open' || hour <= q.target_hour) continue;
    const ans = ctx.db.market_answer.question_id.find(q.id);
    if (!ans) continue;
    const win = ans.outcome ? 'yes' : 'no';
    for (const pos of [...ctx.db.market_position.question_id.filter(q.id)]) {
      const a = ctx.db.market_account.identity.find(pos.identity);
      if (a && pos[win] > 0) ctx.db.market_account.identity.update({ ...a, points: a.points + pos[win] });
    }
    const y = ans.outcome ? 1 : 0;
    room += (q.price_yes - y) ** 2;
    model += (q.model_p - y) ** 2;
    n += 1;
    ctx.db.market_question.id.update({ ...q, status: 'settled', outcome: win, actual: ans.actual, room_p_close: q.price_yes });
    for (const bp of [...ctx.db.market_bot_p.question_id.filter(q.id)]) {
      const bot = ctx.db.market_bot.name.find(bp.bot);
      if (bot) ctx.db.market_bot.name.update({ ...bot, brier: bot.n ? (bot.brier * bot.n + (bp.p - y) ** 2) / (bot.n + 1) : (bp.p - y) ** 2, n: bot.n + 1 });
    }
  }
  const done = hour > r.end_hour;
  const secret = done ? ctx.db.market_secret.round.find(ROUND) : null;
  ctx.db.market_round.id.update({
    ...r, clock_hour: hour, n_settled: n,
    room_brier: n ? room / n : -1, model_brier: n ? model / n : -1,
    status: done ? 'done' : 'running', day_revealed: secret ? secret.day : '',
  });
});

// Admin: remove the round and every account.
export const market_reset = spacetimedb.reducer({}, ctx => {
  requireAdmin(ctx);
  clear(ctx);
});

// ---------------------------------------------------------------------------------------------------------------
// Bot league (mirrors engine/market/bots.py and book.py; engine/tests/test_market_bots.py holds the reference).
// market_start_league starts a round in which every bot has an account and trades its own probability, sized by
// fractional Kelly. market_start above is unchanged (one model trader). market_tick serves both.

const botHex = (i: number) => `${'0'.repeat(58)}6d0d${i.toString(16).padStart(2, '0')}`;
const botId = (name: string): Identity => (name === OUR_MODEL ? MODEL : Identity.fromString(botHex(ORDER.indexOf(name))));

const BotIn = t.object('MarketBotIn', { name: t.string(), title: t.string(), method: t.string(), kelly: t.f64() });
const BotPIn = t.object('MarketBotPIn', { bot: t.string(), p: t.f64(), note: t.string() });
const LeagueQuestionIn = t.object('MarketLeagueQuestionIn', {
  id: t.string(),
  text: t.string(),
  kind: t.string(),
  target_hour: t.u32(),
  unit: t.string(),
  threshold: t.f64(),
  model_p: t.f64(),
  model_note: t.string(),
  bot_p: t.array(BotPIn),
  series: t.string(), // the feed label the Nowcaster watches; empty for history-only questions
  profile_json: t.string(), // Our model's as-of quantiles by hour: [{hour, p10, p50, p90}], empty when no profile
});

// One bot's opening or updating trade on a question, sized by its fractional Kelly.
function botTrade(ctx: any, r: any, name: string, qid: string) {
  const bot = ctx.db.market_bot.name.find(name);
  const bp = ctx.db.market_bot_p.key.find(`${name}|${qid}`);
  const q = ctx.db.market_question.id.find(qid);
  if (!bot || !bp || !q || q.status !== 'open' || r.clock_hour >= q.target_hour) return;
  const acct = ctx.db.market_account.identity.find(botId(name));
  const [side, shares] = kellyShares(bp.p, q.price_yes, acct.points, bot.kelly, Math.min(BOT_MAX_SHARES, MAX_SHARES), r.b, q.q_yes, q.q_no);
  if (shares > 1e-9) trade(ctx, r, botId(name), qid, side, shares);
}

// The Nowcaster's belief for an open question from the hours played so far (the feed rows before the clock), then its trade.
function nowcast(ctx: any, r: any, qid: string) {
  const q = ctx.db.market_question.id.find(qid);
  const prof = ctx.db.market_profile.question_id.find(qid);
  if (!q || !prof || q.status !== 'open' || r.clock_hour >= q.target_hour) return;
  const profile = new Map<number, Quantiles>();
  for (const row of JSON.parse(prof.profile_json || '[]')) profile.set(row.hour, { p10: row.p10, p50: row.p50, p90: row.p90 });
  const observed = new Map<number, number>();
  for (const f of ctx.db.market_feed.iter()) if (f.label === prof.series && f.hour < r.clock_hour) observed.set(f.hour, f.value);
  const base = ctx.db.market_bot_p.key.find(`${OUR_MODEL}|${qid}`)?.p ?? q.model_p;
  const p = nowcastProbability(q.threshold, q.target_hour, r.clock_hour, profile, observed, base);
  const key = `${NOWCASTER}|${qid}`;
  const row = { key, bot: NOWCASTER, question_id: qid, p, note: 'Our model, corrected by the hours already played', updated_hour: r.clock_hour };
  if (ctx.db.market_bot_p.key.find(key)) ctx.db.market_bot_p.key.update(row);
  else ctx.db.market_bot_p.insert(row);
  botTrade(ctx, r, NOWCASTER, qid);
}

function nowcastOpen(ctx: any, r: any) {
  for (const prof of [...ctx.db.market_profile.iter()]) nowcast(ctx, r, prof.question_id);
}

// Admin: start a bot-league round. Every bot gets an account with START_POINTS and, question by question, trades in
// league order towards its own probability; the Nowcaster starts from Our model's view and updates at each tick.
export const market_start_league = spacetimedb.reducer(
  {
    title: t.string(),
    b: t.f64(),
    start_hour: t.u32(),
    end_hour: t.u32(),
    seconds_per_hour: t.u32(),
    questions: t.array(LeagueQuestionIn),
    answers: t.array(AnswerIn),
    day: t.string(),
    bots: t.array(BotIn),
  },
  (ctx, { title, b, start_hour, end_hour, seconds_per_hour, questions, answers, day, bots }) => {
    requireAdmin(ctx);
    if (!(b > 0)) throw new SenderError('b must be positive');
    if (questions.length !== answers.length) throw new SenderError('one answer per question');
    for (const bot of bots) {
      if (!ORDER.includes(bot.name)) throw new SenderError(`unknown bot ${bot.name}`);
      if (!(bot.kelly > 0 && bot.kelly <= 1)) throw new SenderError('kelly must be in (0, 1]');
    }
    clear(ctx);
    const r = {
      id: ROUND, status: 'running', title, day_revealed: '', clock_hour: start_hour, start_hour, end_hour,
      seconds_per_hour, b, room_brier: -1, model_brier: -1, n_settled: 0, started_at: ctx.timestamp,
    };
    ctx.db.market_round.insert(r);
    ctx.db.market_secret.insert({ round: ROUND, day });
    for (const a of answers) ctx.db.market_answer.insert(a);
    for (const bot of bots) {
      ctx.db.market_account.insert({ identity: botId(bot.name), name: bot.title, points: START_POINTS, is_model: true });
      ctx.db.market_bot.insert({ name: bot.name, title: bot.title, method: bot.method, kelly: bot.kelly, identity: botId(bot.name), brier: -1, n: 0 });
    }
    for (const q of questions) {
      if (!ctx.db.market_answer.question_id.find(q.id)) throw new SenderError(`no answer for ${q.id}`);
      const { bot_p, series, profile_json, ...pub } = q;
      ctx.db.market_question.insert({ ...pub, q_yes: 0, q_no: 0, price_yes: 0.5, status: 'open', outcome: '', actual: 0, room_p_close: -1 });
      for (const p of bot_p) {
        if (!bots.some(x => x.name === p.bot)) continue;
        ctx.db.market_bot_p.insert({ key: `${p.bot}|${q.id}`, bot: p.bot, question_id: q.id, p: p.p, note: p.note, updated_hour: start_hour });
      }
      if (series && profile_json) ctx.db.market_profile.insert({ question_id: q.id, series, profile_json });
    }
    for (const q of questions) {
      for (const name of ORDER) if (name !== NOWCASTER) botTrade(ctx, r, name, q.id);
      if (bots.some(x => x.name === NOWCASTER)) nowcast(ctx, r, q.id);
    }
  }
);
