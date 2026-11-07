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
const posKey = (id: Identity, qid: string, side: string) => `${id.toHexString()}|${qid}|${side}`;
const botHex = (i: number) => `${'0'.repeat(58)}6d0d${i.toString(16).padStart(2, '0')}`;
const botId = (name: string): Identity => (name === OUR_MODEL ? MODEL : Identity.fromString(botHex(ORDER.indexOf(name))));

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

const softmaxPrices = (q: Record<string, number>, b: number): Record<string, number> => {
  const ids = Object.keys(q);
  const m = Math.max(...ids.map(i => q[i]));
  const e = ids.map(i => Math.exp((q[i] - m) / b));
  const z = e.reduce((x, y) => x + y, 0);
  return Object.fromEntries(ids.map((i, k) => [i, e[k] / z]));
};
const costOf = (q: Record<string, number>, b: number): number => {
  const ids = Object.keys(q);
  const m = Math.max(...ids.map(i => q[i]));
  return m + b * Math.log(ids.reduce((z, i) => z + Math.exp((q[i] - m) / b), 0));
};
export const optionIds = (q: any): string[] => (q.qtype === 'choice' ? JSON.parse(q.choices_json).map((c: any) => c.id) : ['yes', 'no']);

// Signed trade on one option: shares > 0 buys, < 0 sells. Returns points paid (negative when selling). The market
// maker is an LMSR over the question's options (two for yes/no), so the prices are the room's probabilities.
function trade(ctx: any, r: any, who: Identity, qid: string, side: string, shares: number): number {
  if (!Number.isFinite(shares) || shares === 0 || Math.abs(shares) > MAX_SHARES) {
    throw new SenderError(`shares must be between 0 and ${MAX_SHARES}`);
  }
  const q = openQuestion(ctx, r, qid);
  if (!optionIds(q).includes(side)) throw new SenderError(`unknown option ${side}: use ${optionIds(q).join(' or ')}`);
  const a = account(ctx, r.id, who);
  const key = posKey(who, qid, side);
  const pos = ctx.db.market_position.key.find(key) ?? { key, lobby_id: r.id, identity: who, question_id: qid, side, shares: 0, spent: 0 };
  if (shares < 0 && -shares > pos.shares + 1e-9) throw new SenderError('cannot sell more than you hold');
  const before: Record<string, number> = JSON.parse(q.q_json);
  const after = { ...before, [side]: before[side] + shares };
  const paid = costOf(after, r.b) - costOf(before, r.b);
  if (paid > a.points + 1e-9) throw new SenderError('not enough points');
  ctx.db.market_account.key.update({ ...a, points: a.points - paid });
  const prices = softmaxPrices(after, r.b);
  ctx.db.market_question.id.update({
    ...q, q_json: JSON.stringify(after), prices_json: JSON.stringify(prices),
    ...(q.qtype === 'binary' ? { q_yes: after.yes, q_no: after.no, price_yes: prices.yes } : {}),
  });
  const next = { ...pos, shares: pos.shares + shares, spent: pos.spent + paid };
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
  group_id?: string; option_label?: string; // options of one multi-outcome question share a group_id
  choices?: { id: string; label: string }[]; // a choice question: several options, exactly one wins
};
export type Answer = { question_id: string; outcome: boolean | string; actual: number }; // a bool means yes or no
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
  if (!bot || !bp || !q || q.qtype !== 'binary' || q.status !== 'open' || r.clock_hour >= q.target_hour) return;
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
    const choice = !!q.choices && q.choices.length >= 2;
    const outcome = typeof a.outcome === 'boolean' ? (a.outcome ? 'yes' : 'no') : a.outcome;
    const opts = choice ? q.choices!.map(c => c.id) : ['yes', 'no'];
    if (!opts.includes(outcome)) throw new SenderError(`answer for ${q.id} is not one of ${opts.join(', ')}`);
    ctx.db.market_answer.insert({ question_id: qid, lobby_id: lobby.id, outcome, actual: a.actual });
    ctx.db.market_question.insert({
      qtype: choice ? 'choice' : 'binary', choices_json: choice ? JSON.stringify(q.choices) : '',
      q_json: JSON.stringify(Object.fromEntries(opts.map(i => [i, 0]))), prices_json: JSON.stringify(Object.fromEntries(opts.map(i => [i, 1 / opts.length]))),
      id: qid, lobby_id: lobby.id, group_id: q.group_id ? lk(lobby.id, q.group_id) : '', option_label: q.option_label ?? '', text: q.text, kind: q.kind, target_hour: q.target_hour, unit: q.unit, threshold: q.threshold,
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
    const win = ans.outcome;
    for (const pos of [...ctx.db.market_position.question_id.filter(q.id)]) {
      const a = ctx.db.market_account.key.find(acctKey(lobby, pos.identity));
      if (a && pos.side === win && pos.shares > 0) ctx.db.market_account.key.update({ ...a, points: a.points + pos.shares });
    }
    const y = win === 'yes' ? 1 : 0;
    if (q.qtype === 'binary') {
      room += (q.price_yes - y) ** 2;
      model += (q.model_p - y) ** 2;
      n += 1;
    }
    ctx.db.market_question.id.update({ ...q, status: 'settled', outcome: win, actual: ans.actual, room_p_close: q.qtype === 'binary' ? q.price_yes : -1 });
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
