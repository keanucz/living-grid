import { ScheduleAt } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import { lk } from './market_core';

// Helpers shared by lobby.ts and later reducer files (quick play, votes). reducers/*.ts may only export reducers, so
// anything reusable lives here.

export const micros = (ts: any): bigint => ts.microsSinceUnixEpoch;
export const DEFAULT_COUNTDOWN_S = 5;

export function setState(ctx: any, l: any, state: string, extra: Record<string, unknown> = {}) {
  const next = { ...l, state, state_since: ctx.timestamp, ...extra };
  ctx.db.lobby.id.update(next);
  return next;
}

export function schedule(ctx: any, kind: string, lobby: number, afterUs: bigint, every = false) {
  ctx.db.lobby_tick.insert({
    scheduled_id: 0n,
    scheduled_at: every ? ScheduleAt.interval(afterUs) : ScheduleAt.time(micros(ctx.timestamp) + afterUs),
    kind,
    lobby_id: lobby,
  });
}

export function cancelSchedule(ctx: any, lobby: number) {
  for (const s of [...ctx.db.lobby_tick.iter()]) if (s.lobby_id === lobby && s.kind !== 'sweep') ctx.db.lobby_tick.scheduled_id.delete(s.scheduled_id);
}

// (Re)start the lobby's countdown: it begins the round `seconds` from now. Calling it again replaces the running one,
// which is how a "wait for more" vote can reset the clock.
export function startCountdown(ctx: any, l: any, seconds: number = DEFAULT_COUNTDOWN_S) {
  cancelSchedule(ctx, l.id);
  const us = BigInt(Math.round(seconds * 1_000_000));
  const next = setState(ctx, l, 'countdown', { countdown_until: new Timestamp(micros(ctx.timestamp) + us) });
  schedule(ctx, 'begin', l.id, us);
  return next;
}

// Rank everyone who played the round just ended (people and bots) by points or profit and store one row each.
export function recordResults(ctx: any, l: any, mode: string, day: string) {
  const rows: { identity: any; name: string; is_bot: boolean; points: number }[] = [];
  if (mode === 'battery') {
    for (const p of ctx.db.battery_player.lobby_id.filter(l.id)) rows.push({ identity: p.identity, name: p.name, is_bot: p.is_agent, points: p.pnl });
  } else {
    for (const a of ctx.db.market_account.lobby_id.filter(l.id)) rows.push({ identity: a.identity, name: a.name, is_bot: a.is_model, points: a.points });
  }
  rows.sort((a, b) => b.points - a.points);
  rows.forEach((r, i) => {
    const key = lk(l.id, `${l.round_no}|${r.identity.toHexString()}`);
    const row = { key, lobby_id: l.id, round_no: l.round_no, identity: r.identity, name: r.name, is_bot: r.is_bot, mode, day, rank: i + 1, n_players: rows.length, points: r.points, ended_at: ctx.timestamp };
    if (ctx.db.game_result.key.find(key)) ctx.db.game_result.key.update(row);
    else ctx.db.game_result.insert(row);
  });
}
