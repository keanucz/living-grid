import { SenderError } from 'spacetimedb/server';
import { Identity } from 'spacetimedb';
import {
  BOT_MAX_SHARES, NOWCASTER, ORDER, OUR_MODEL, kellyShares, nowcastProbability, type Quantiles,
} from './reducers/league_math';

// Mystery-day prediction market, points only, one round per lobby (see lobby.ts, which starts and ticks rounds).
// LMSR: cost C(y, n) = b ln(e^(y/b) + e^(n/b)); a trade costs C(after) - C(before); price = the room's
// probability of yes. A winning share pays 1 point. Rules mirror engine/market/book.py, which holds the tests.
// Every row is scoped by lobby_id and every question id is '<lobby_id>|<id>'.

const START_POINTS = 1000;
const MAX_SHARES = 500;
const MODEL_MAX_SHARES = 150;
export const LMSR_B = 100;
const MODEL_HEX = '00000000000000000000000000000000000000000000000000000000006d0de1';
const MODEL = Identity.fromString(MODEL_HEX);

// Mirrors engine/market/bots.py specs(); engine/tests/test_market.py checks the two lists agree.
export const BOT_SPECS = [
  { name: 'bot_last_week', title: 'Last week', method: 'Same hour seven days ago, band from its own recent errors.', kelly: 0.1 },
  { name: 'bot_yesterday', title: 'Yesterday', method: 'Same hour yesterday, band from its own recent errors.', kelly: 0.15 },
  { name: 'bot_engineer', title: 'The Engineer', method: 'Merit order: price from residual load, shifted by gas and carbon costs.', kelly: 0.35 },
  { name: 'lgbm_q', title: 'Our model', method: 'LightGBM quantile regression on 18 features.', kelly: 0.5 },
  { name: 'bot_committee', title: 'The Committee', method: 'Quantile regression averaging of the others, then conformal.', kelly: 0.5 },
  { name: 'bot_nowcaster', title: 'The Nowcaster', method: 'Our model, corrected by the hours already played.', kelly: 0.35 },
];

export const lk = (lobby: number, s: string) => `${lobby}|${s}`;
export const acctKey = (lobby: number, id: Identity) => lk(lobby, id.toHexString());
const posKey = (id: Identity, qid: string) => `${id.toHexString()}|${qid}`;
const botHex = (i: number) => `${'0'.repeat(58)}6d0d${i.toString(16).padStart(2, '0')}`;
const botId = (name: string): Identity => (name === OUR_MODEL ? MODEL : Identity.fromString(botHex(ORDER.indexOf(name))));

function cost(y: number, n: number, b: number): number {
  const m = Math.max(y, n);
  return m + b * Math.log(Math.exp((y - m) / b) + Math.exp((n - m) / b));
}
const priceYes = (y: number, n: number, b: number) => 1 / (1 + Math.exp((n - y) / b));

function runningRound(ctx: any, lobby: number) {
  const r = ctx.db.market_round.id.find(lobby);
  if (!r || r.status !== 'running') throw new SenderError('no market round is running in this lobby');
  return r;
}

function account(ctx: any, lobby: number, id: Identity) {
  const a = ctx.db.market_account.key.find(acctKey(lobby, id));
  if (!a) throw new SenderError('join this lobby first');
  return a;
}

function openQuestion(ctx: any, r: any, qid: string) {
  const q = ctx.db.market_question.id.find(qid);
  if (!q || q.lobby_id !== r.id) throw new SenderError(`unknown question ${qid}`);
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
  const a = account(ctx, r.id, who);
  const key = posKey(who, qid);
  const pos = ctx.db.market_position.key.find(key) ?? { key, lobby_id: r.id, identity: who, question_id: qid, yes: 0, no: 0, spent: 0 };
  if (shares < 0 && -shares > pos[side] + 1e-9) throw new SenderError('cannot sell more than you hold');
  const y = q.q_yes + (side === 'yes' ? shares : 0);
  const n = q.q_no + (side === 'no' ? shares : 0);
  const paid = cost(y, n, r.b) - cost(q.q_yes, q.q_no, r.b);
  if (paid > a.points + 1e-9) throw new SenderError('not enough points');
  ctx.db.market_account.key.update({ ...a, points: a.points - paid });
  ctx.db.market_question.id.update({ ...q, q_yes: y, q_no: n, price_yes: priceYes(y, n, r.b) });
  const next = { ...pos, [side]: pos[side] + shares, spent: pos.spent + paid };
  if (ctx.db.market_position.key.find(key)) ctx.db.market_position.key.update(next);
  else ctx.db.market_position.insert(next);
  return paid;
}

export function playerTrade(ctx: any, question_id: string, side: string, shares: number) {
  const q = ctx.db.market_question.id.find(question_id);
  if (!q) throw new SenderError(`unknown question ${question_id}`);
  trade(ctx, runningRound(ctx, q.lobby_id), ctx.sender, question_id, side, shares);
}

// ---------------------------------------------------------------------------------------------------------------
// Used by lobby.ts

export type DayQuestion = {
  id: string; text: string; kind: string; target_hour: number; unit: string; threshold: number; model_p: number; model_note: string;
  bot_p: { bot: string; p: number; note: string }[]; series: string; profile_json: string;
};
export type Answer = { question_id: string; outcome: boolean; actual: number };
export type FeedRow = { label: string; value: number; unit: string };

// Delete everything a lobby's round created (not the lobby or its players).
export function clearRound(ctx: any, lobby: number) {
  const PK: Record<string, string> = {
    market_question: 'id', market_answer: 'question_id', market_position: 'key', market_feed: 'key',
    market_bot: 'key', market_bot_p: 'key', market_profile: 'question_id', market_account: 'key',
  };
  for (const tbl of Object.keys(PK)) {
    const pk = PK[tbl];
    for (const row of [...ctx.db[tbl].lobby_id.filter(lobby)]) ctx.db[tbl][pk].delete(row[pk]);
  }
  ctx.db.market_secret.round.delete(lobby);
  ctx.db.market_round.id.delete(lobby);
}

// One bot's opening or updating trade on a question, sized by its fractional Kelly.
function botTrade(ctx: any, r: any, name: string, qid: string) {
  const bot = ctx.db.market_bot.key.find(lk(r.id, name));
  const bp = ctx.db.market_bot_p.key.find(`${name}|${qid}`);
  const q = ctx.db.market_question.id.find(qid);
  if (!bot || !bp || !q || q.status !== 'open' || r.clock_hour >= q.target_hour) return;
  const acct = ctx.db.market_account.key.find(acctKey(r.id, botId(name)));
  if (!acct) return;
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
  for (const f of ctx.db.market_feed.lobby_id.filter(r.id)) if (f.label === prof.series && f.hour < r.clock_hour) observed.set(f.hour, f.value);
  const base = ctx.db.market_bot_p.key.find(`${OUR_MODEL}|${qid}`)?.p ?? q.model_p;
  const p = nowcastProbability(q.threshold, q.target_hour, r.clock_hour, profile, observed, base);
  const key = `${NOWCASTER}|${qid}`;
  const row = { key, lobby_id: r.id, bot: NOWCASTER, question_id: qid, p, note: 'Our model, corrected by the hours already played', updated_hour: r.clock_hour };
  if (ctx.db.market_bot_p.key.find(key)) ctx.db.market_bot_p.key.update(row);
  else ctx.db.market_bot_p.insert(row);
  botTrade(ctx, r, NOWCASTER, qid);
}

function nowcastOpen(ctx: any, r: any) {
  for (const prof of [...ctx.db.market_profile.lobby_id.filter(r.id)]) nowcast(ctx, r, prof.question_id);
}

// Start the round of `lobby`: accounts for every lobby player, bots when asked, questions from a pool day.
export function startRound(
  ctx: any,
  lobby: { id: number; seconds_per_hour: number; bots: boolean },
  day: { day: string; start_hour: number; end_hour: number },
  questions: DayQuestion[],
  answers: Answer[],
  title: string,
) {
  clearRound(ctx, lobby.id);
  const r = {
    id: lobby.id, status: 'running', title, day_revealed: '', clock_hour: day.start_hour, start_hour: day.start_hour,
    end_hour: day.end_hour, seconds_per_hour: lobby.seconds_per_hour, b: LMSR_B, room_brier: -1, model_brier: -1, n_settled: 0,
    started_at: ctx.timestamp,
  };
  ctx.db.market_round.insert(r);
  ctx.db.market_secret.insert({ round: lobby.id, day: day.day });
  for (const p of [...ctx.db.lobby_player.lobby_id.filter(lobby.id)]) {
    ctx.db.market_account.insert({ key: acctKey(lobby.id, p.identity), lobby_id: lobby.id, identity: p.identity, name: p.name, points: START_POINTS, is_model: false });
    ctx.db.lobby_player.key.update({ ...p, points: START_POINTS, ready: false });
  }
  const bots = lobby.bots ? BOT_SPECS : [];
  for (const bot of bots) {
    const id = botId(bot.name);
    ctx.db.market_account.insert({ key: acctKey(lobby.id, id), lobby_id: lobby.id, identity: id, name: bot.title, points: START_POINTS, is_model: true });
    ctx.db.market_bot.insert({ key: lk(lobby.id, bot.name), lobby_id: lobby.id, name: bot.name, title: bot.title, method: bot.method, kelly: bot.kelly, identity: id, brier: -1, n: 0 });
  }
  const answerOf = new Map(answers.map(a => [a.question_id, a]));
  const ids: string[] = [];
  for (const q of questions) {
    const a = answerOf.get(q.id);
    if (!a) throw new SenderError(`no answer for ${q.id}`);
    const qid = lk(lobby.id, q.id);
    ids.push(qid);
    ctx.db.market_answer.insert({ question_id: qid, lobby_id: lobby.id, outcome: a.outcome, actual: a.actual });
    ctx.db.market_question.insert({
      id: qid, lobby_id: lobby.id, text: q.text, kind: q.kind, target_hour: q.target_hour, unit: q.unit, threshold: q.threshold,
      model_p: q.model_p, model_note: q.model_note, q_yes: 0, q_no: 0, price_yes: 0.5, status: 'open', outcome: '', actual: 0, room_p_close: -1,
    });
    for (const p of q.bot_p) {
      if (!bots.some(x => x.name === p.bot)) continue;
      ctx.db.market_bot_p.insert({ key: `${p.bot}|${qid}`, lobby_id: lobby.id, bot: p.bot, question_id: qid, p: p.p, note: p.note, updated_hour: day.start_hour });
    }
    if (q.series && q.profile_json) ctx.db.market_profile.insert({ question_id: qid, lobby_id: lobby.id, series: q.series, profile_json: q.profile_json });
  }
  for (const qid of ids) {
    for (const name of ORDER) if (name !== NOWCASTER && bots.some(x => x.name === name)) botTrade(ctx, r, name, qid);
    if (bots.some(x => x.name === NOWCASTER)) nowcast(ctx, r, qid);
  }
}

// Move the lobby's clock to `hour`, record what happened in the hour just gone, and settle every open question whose
// hour has passed. Winning shares pay 1 point; Brier scores compare the closing price with the model. Returns true
// when the round is over.
export function tickRound(ctx: any, lobby: number, hour: number, feed: FeedRow[]): boolean {
  const r = runningRound(ctx, lobby);
  for (const f of feed) {
    const key = lk(lobby, `${hour - 1}|${f.label}`);
    const row = { key, lobby_id: lobby, hour: hour - 1, ...f };
    if (ctx.db.market_feed.key.find(key)) ctx.db.market_feed.key.update(row);
    else ctx.db.market_feed.insert(row);
  }
  nowcastOpen(ctx, { ...r, clock_hour: hour });
  let room = r.room_brier < 0 ? 0 : r.room_brier * r.n_settled;
  let model = r.model_brier < 0 ? 0 : r.model_brier * r.n_settled;
  let n = r.n_settled;
  for (const q of [...ctx.db.market_question.lobby_id.filter(lobby)]) {
    if (q.status !== 'open' || hour <= q.target_hour) continue;
    const ans = ctx.db.market_answer.question_id.find(q.id);
    if (!ans) continue;
    const win = ans.outcome ? 'yes' : 'no';
    for (const pos of [...ctx.db.market_position.question_id.filter(q.id)]) {
      const a = ctx.db.market_account.key.find(acctKey(lobby, pos.identity));
      if (a && pos[win] > 0) ctx.db.market_account.key.update({ ...a, points: a.points + pos[win] });
    }
    const y = ans.outcome ? 1 : 0;
    room += (q.price_yes - y) ** 2;
    model += (q.model_p - y) ** 2;
    n += 1;
    ctx.db.market_question.id.update({ ...q, status: 'settled', outcome: win, actual: ans.actual, room_p_close: q.price_yes });
    for (const bp of [...ctx.db.market_bot_p.question_id.filter(q.id)]) {
      const bot = ctx.db.market_bot.key.find(lk(lobby, bp.bot));
      if (bot) ctx.db.market_bot.key.update({ ...bot, brier: bot.n ? (bot.brier * bot.n + (bp.p - y) ** 2) / (bot.n + 1) : (bp.p - y) ** 2, n: bot.n + 1 });
    }
  }
  for (const p of [...ctx.db.lobby_player.lobby_id.filter(lobby)]) {
    const a = ctx.db.market_account.key.find(acctKey(lobby, p.identity));
    if (a && a.points !== p.points) ctx.db.lobby_player.key.update({ ...p, points: a.points });
  }
  const done = hour > r.end_hour;
  const secret = done ? ctx.db.market_secret.round.find(lobby) : null;
  ctx.db.market_round.id.update({
    ...r, clock_hour: hour, n_settled: n,
    room_brier: n ? room / n : -1, model_brier: n ? model / n : -1,
    status: done ? 'done' : 'running', day_revealed: secret ? secret.day : '',
  });
  return done;
}
