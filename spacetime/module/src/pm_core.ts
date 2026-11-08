import { SenderError, ScheduleAt } from 'spacetimedb/server';
import { Identity } from 'spacetimedb';
import { MAX_SHARES, START_POINTS, botOrder, clampPrice, fill, mark, points } from './pm_math';
import { BOT_SPECS, botId, lk } from './market_core';
import { applyResults } from './profile_core';

// Solo markets: see tables.ts and pm_math.ts. A game runs on a mystery day from pm_day. Each tick moves the clock one game
// hour: every open market's price steps to the model's price for that hour, markets whose close hour has come are closed
// and settled (the outcome is revealed then, never before), and when the last one closes the day is revealed. Nothing
// that gives an answer away is in a public table before its market closes.

export const SECONDS_PER_HOUR = 15;
export const PM_BOTS = ['bot_yesterday', 'bot_engineer', 'lgbm_q', 'bot_committee'];

export type PmMarket = {
  id: string; text: string; kind: string; unit: string; close_hour: number; model_note: string;
  outcome: 'yes' | 'no'; actual_text: string;
  prices: Record<string, number>; // game hour -> YES price in cents, for start_hour .. close_hour - 1
  reasons?: Record<string, string>; // game hour -> why the price moved to this
  bots?: Record<string, number>; // bot -> its probability of YES
};

const hex = (id: Identity) => id.toHexString();
const ak = (game: number, id: Identity) => lk(game, hex(id));
const mk = (game: number, market: string) => lk(game, market);
const posKey = (game: number, id: Identity, market: string, side: string) => lk(game, `${hex(id)}|${market}|${side}`);
const priceKey = (game: number, market: string, hour: number) => lk(game, `${market}|${hour}`);

function schedule(ctx: any, game: number, seconds: number) {
  ctx.db.pm_tick.insert({ scheduled_id: 0n, scheduled_at: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + BigInt(Math.round(seconds * 1e6))), game_id: game });
}

export function clearPm(ctx: any, game: number) {
  for (const s of [...ctx.db.pm_tick.iter()]) if (s.game_id === game) ctx.db.pm_tick.scheduled_id.delete(s.scheduled_id);
  const PK: Record<string, string> = { pm_market: 'key', pm_price: 'key', pm_account: 'key', pm_position: 'key', pm_trade: 'key' };
  for (const tbl of Object.keys(PK)) for (const row of [...ctx.db[tbl].game_id.filter(game)]) ctx.db[tbl][PK[tbl]].delete(row[PK[tbl]]);
  ctx.db.pm_secret.game_id.delete(game);
  ctx.db.pm_game.id.delete(game);
}

function priceAt(m: PmMarket, hour: number): number {
  const p = m.prices[String(hour)];
  if (typeof p !== 'number') throw new SenderError(`market ${m.id} has no price for hour ${hour}`);
  return clampPrice(p);
}

function nextSeq(ctx: any, game: number): number {
  let n = 0;
  for (const t of ctx.db.pm_trade.game_id.filter(game)) n = Math.max(n, t.seq);
  return n + 1;
}

function logTrade(ctx: any, game: number, who: Identity, market: string, side: string, action: string, shares: number, price: number, hour: number) {
  const seq = nextSeq(ctx, game);
  ctx.db.pm_trade.insert({ key: lk(game, String(seq)), game_id: game, seq, identity: who, market_id: market, side, action, shares, price, hour });
}

// Cash plus open positions at the model's price.
export function equityOf(ctx: any, game: number, who: Identity): number {
  const acct = ctx.db.pm_account.key.find(ak(game, who));
  if (!acct) return 0;
  let v = acct.points;
  for (const p of ctx.db.pm_position.identity.filter(who)) {
    if (p.game_id !== game || p.settled) continue;
    const m = ctx.db.pm_market.key.find(mk(game, p.market_id));
    if (m && m.status === 'open') v += (p.shares * mark(m.price_yes, p.side)) / 100;
  }
  return Math.round(v * 100) / 100;
}

function refreshEquity(ctx: any, game: number) {
  for (const a of [...ctx.db.pm_account.game_id.filter(game)]) ctx.db.pm_account.key.update({ ...a, equity: equityOf(ctx, game, a.identity) });
}

function apply(ctx: any, game: number, who: Identity, market: string, side: 'yes' | 'no', action: 'buy' | 'sell', shares: number, hour: number) {
  const m = ctx.db.pm_market.key.find(mk(game, market));
  if (!m) throw new SenderError(`unknown market ${market}`);
  if (m.status !== 'open') throw new SenderError('that market has closed');
  if (!(shares > 0) || !Number.isInteger(shares) || shares > MAX_SHARES) throw new SenderError(`shares must be a whole number from 1 to ${MAX_SHARES}`);
  const acct = ctx.db.pm_account.key.find(ak(game, who));
  if (!acct) throw new SenderError('you are not in this game');
  const cents = fill(m.price_yes, side, action);
  const amount = points(shares, cents);
  const key = posKey(game, who, market, side);
  const pos = ctx.db.pm_position.key.find(key) ?? { key, game_id: game, identity: who, market_id: market, side, shares: 0, cost: 0, settled: false, payout: 0 };
  if (action === 'buy') {
    if (pos.shares + shares > MAX_SHARES) throw new SenderError(`at most ${MAX_SHARES} shares in one market`);
    if (amount > acct.points + 1e-9) throw new SenderError('not enough points');
    ctx.db.pm_account.key.update({ ...acct, points: Math.round((acct.points - amount) * 100) / 100 });
    const next = { ...pos, shares: pos.shares + shares, cost: Math.round((pos.cost + amount) * 100) / 100 };
    if (ctx.db.pm_position.key.find(key)) ctx.db.pm_position.key.update(next);
    else ctx.db.pm_position.insert(next);
  } else {
    if (shares > pos.shares + 1e-9) throw new SenderError('you do not hold that many');
    const keep = (pos.shares - shares) / pos.shares;
    ctx.db.pm_account.key.update({ ...acct, points: Math.round((acct.points + amount) * 100) / 100 });
    ctx.db.pm_position.key.update({ ...pos, shares: pos.shares - shares, cost: Math.round(pos.cost * keep * 100) / 100 });
  }
  logTrade(ctx, game, who, market, side, action, shares, cents, hour);
  ctx.db.pm_account.key.update({ ...ctx.db.pm_account.key.find(ak(game, who)), equity: equityOf(ctx, game, who) });
}

export function tradePm(ctx: any, game: number, who: Identity, market: string, side: string, action: 'buy' | 'sell', shares: number) {
  const g = ctx.db.pm_game.id.find(game);
  if (!g || g.state !== 'running') throw new SenderError('this game is over');
  if (!g.owner.isEqual(who)) throw new SenderError('this is not your game');
  if (side !== 'yes' && side !== 'no') throw new SenderError('side must be yes or no');
  apply(ctx, game, who, market, side, action, shares, g.clock_hour);
}

export function startPm(ctx: any, owner: Identity, name: string, day: any): number {
  const markets: PmMarket[] = JSON.parse(day.markets_json);
  const g = ctx.db.pm_game.insert({
    id: 0, owner, state: 'running', clock_hour: day.start_hour, start_hour: day.start_hour, end_hour: day.end_hour,
    seconds_per_hour: SECONDS_PER_HOUR, opened_at: ctx.timestamp, day_revealed: '', started_at: ctx.timestamp,
  });
  ctx.db.pm_secret.insert({ game_id: g.id, day: day.day });
  ctx.db.pm_account.insert({ key: ak(g.id, owner), game_id: g.id, identity: owner, name, is_bot: false, points: START_POINTS, equity: START_POINTS });
  for (const b of PM_BOTS) {
    const spec = BOT_SPECS.find(x => x.name === b)!;
    ctx.db.pm_account.insert({ key: ak(g.id, botId(b)), game_id: g.id, identity: botId(b), name: spec.title, is_bot: true, points: START_POINTS, equity: START_POINTS });
  }
  for (const m of markets) {
    const p = priceAt(m, day.start_hour);
    ctx.db.pm_market.insert({
      key: mk(g.id, m.id), game_id: g.id, market_id: m.id, text: m.text, kind: m.kind, unit: m.unit, close_hour: m.close_hour, model_note: m.model_note,
      status: 'open', price_yes: p, note: m.reasons?.[String(day.start_hour)] ?? '', outcome: '', actual_text: '',
    });
    ctx.db.pm_price.insert({ key: priceKey(g.id, m.id, day.start_hour), game_id: g.id, market_id: m.id, hour: day.start_hour, price_yes: p });
    for (const b of PM_BOTS) {
      const belief = m.bots?.[b];
      if (belief === undefined) continue;
      const cash = ctx.db.pm_account.key.find(ak(g.id, botId(b))).points;
      const order = botOrder(belief, p, cash);
      if (order) apply(ctx, g.id, botId(b), m.id, order.side, 'buy', order.shares, day.start_hour);
    }
  }
  refreshEquity(ctx, g.id);
  schedule(ctx, g.id, SECONDS_PER_HOUR);
  return g.id;
}

// One game hour passes.
export function tickPm(ctx: any, game: number) {
  const g = ctx.db.pm_game.id.find(game);
  if (!g || g.state !== 'running') return;
  const day = ctx.db.pm_secret.game_id.find(game)?.day;
  const pooled = day ? ctx.db.pm_day.day.find(day) : null;
  if (!pooled) return;
  const markets: PmMarket[] = JSON.parse(pooled.markets_json);
  const hour = g.clock_hour + 1;
  let open = 0;
  for (const m of markets) {
    const row = ctx.db.pm_market.key.find(mk(game, m.id));
    if (!row || row.status !== 'open') continue;
    if (m.close_hour <= hour) {
      ctx.db.pm_market.key.update({ ...row, status: 'closed', outcome: m.outcome, actual_text: m.actual_text });
      for (const pos of [...ctx.db.pm_position.game_id.filter(game)]) {
        if (pos.market_id !== m.id || pos.settled) continue;
        const win = pos.side === m.outcome ? pos.shares : 0;
        const a = ctx.db.pm_account.key.find(ak(game, pos.identity));
        if (a && win > 0) ctx.db.pm_account.key.update({ ...a, points: Math.round((a.points + win) * 100) / 100 });
        ctx.db.pm_position.key.update({ ...pos, settled: true, payout: win });
      }
    } else {
      const p = priceAt(m, hour);
      ctx.db.pm_market.key.update({ ...row, price_yes: p, note: m.reasons?.[String(hour)] ?? '' });
      ctx.db.pm_price.insert({ key: priceKey(game, m.id, hour), game_id: game, market_id: m.id, hour, price_yes: p });
      open += 1;
    }
  }
  refreshEquity(ctx, game);
  if (open === 0) {
    ctx.db.pm_game.id.update({ ...g, clock_hour: hour, state: 'done', opened_at: ctx.timestamp, day_revealed: day });
    finishPm(ctx, ctx.db.pm_game.id.find(game), day);
  } else {
    ctx.db.pm_game.id.update({ ...g, clock_hour: hour, opened_at: ctx.timestamp });
    schedule(ctx, game, g.seconds_per_hour);
  }
}

// Final standings: profit over the starting points, into the same ratings and meta leaderboard as the other modes.
function finishPm(ctx: any, g: any, day: string) {
  const rows = [...ctx.db.pm_account.game_id.filter(g.id)].sort((a: any, b: any) => b.equity - a.equity);
  const avatar = ctx.db.profile.identity.find(g.owner)?.avatar ?? '';
  rows.forEach((r: any, i: number) => {
    ctx.db.game_result.insert({
      key: lk(0, `pm${g.id}|${hex(r.identity)}`), lobby_id: 0, round_no: g.id, identity: r.identity, name: r.name, is_bot: r.is_bot, mode: 'pm', day,
      rank: i + 1, n_players: rows.length, points: Math.round((r.equity - START_POINTS) * 100) / 100, ended_at: ctx.timestamp,
    });
  });
  applyResults(ctx, rows.map((r: any, i: number) => ({ identity: r.identity, name: r.name, is_bot: r.is_bot, points: r.equity - START_POINTS, rank: i + 1 })), { [hex(g.owner)]: avatar });
}
