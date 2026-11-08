import { SenderError, ScheduleAt } from 'spacetimedb/server';
import { Identity, Timestamp } from 'spacetimedb';
import { clearRound, lk } from './market_core';
import { clearBattery } from './battery_core';
import { clearBeatForLobby } from './beat_core';
import { clearPmForLobby } from './pm_core';
import { applyResults } from './profile_core';

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
  deleteVotes(ctx, l.id);
  const us = BigInt(Math.round(seconds * 1_000_000));
  const next = setState(ctx, l, 'countdown', { countdown_s: Math.round(seconds), countdown_until: new Timestamp(micros(ctx.timestamp) + us) });
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
  const avatars: Record<string, string> = {};
  for (const p of ctx.db.lobby_player.lobby_id.filter(l.id)) avatars[p.identity.toHexString()] = p.avatar;
  rows.forEach((r, i) => {
    const key = lk(l.id, `${l.round_no}|${r.identity.toHexString()}`);
    const row = { key, lobby_id: l.id, round_no: l.round_no, identity: r.identity, name: r.name, is_bot: r.is_bot, mode, day, rank: i + 1, n_players: rows.length, points: r.points, ended_at: ctx.timestamp };
    if (ctx.db.game_result.key.find(key)) ctx.db.game_result.key.update(row);
    else ctx.db.game_result.insert(row);
  });
  applyResults(ctx, rows.map((r, i) => ({ ...r, rank: i + 1 })), avatars);
}

export const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: they read as 1 and 0
export const AVATARS = ['turbine', 'pylon', 'solar', 'flame', 'battery', 'wave'];
export const MODES = ['market', 'battery', 'beat', 'pm'];
export const SWEEP_EVERY_US = 600_000_000n;
export const MAX_PLAYERS = 40;
export const DEFAULTS = { seconds_per_hour: 30, n_questions: 6, bots: true };
export const hex = (id: Identity) => id.toHexString();
export const pkey = (lobby: number, id: Identity) => lk(lobby, hex(id));

export function deleteVotes(ctx: any, lobby: number) {
  for (const v of [...ctx.db.lobby_ballot.lobby_id.filter(lobby)]) ctx.db.lobby_ballot.key.delete(v.key);
}

export function newCode(ctx: any): string {
  for (let i = 0; i < 200; i++) {
    let code = '';
    for (let k = 0; k < 4; k++) code += CODE_LETTERS[ctx.random.integerInRange(0, CODE_LETTERS.length - 1)];
    if (!ctx.db.lobby.code.find(code)) return code;
  }
  throw new SenderError('could not make a lobby code, try again');
}

export function cleanName(name: string): string {
  const clean = name.trim().slice(0, 24);
  if (!clean) throw new SenderError('name required');
  return clean;
}

export function cleanAvatar(avatar: string): string {
  return AVATARS.includes(avatar) ? avatar : AVATARS[0];
}

export function removePlayer(ctx: any, lobby: number, id: Identity) {
  ctx.db.lobby_player.key.delete(pkey(lobby, id));
  ctx.db.market_account.key.delete(lk(lobby, hex(id)));
}

// A lobby with nobody in it is gone; if the host left, the longest-waiting player takes over.
export function afterLeave(ctx: any, l: any) {
  const rest = [...ctx.db.lobby_player.lobby_id.filter(l.id)];
  if (!rest.length) return deleteLobby(ctx, l.id);
  if (l.host.isEqual(rest[0].identity) || rest.some((p: any) => p.identity.isEqual(l.host))) return;
  ctx.db.lobby.id.update({ ...l, host: rest[0].identity });
}

export function deleteLobby(ctx: any, id: number) {
  cancelSchedule(ctx, id);
  clearRound(ctx, id);
  clearBattery(ctx, id);
  clearBeatForLobby(ctx, id);
  clearPmForLobby(ctx, id);
  for (const p of [...ctx.db.lobby_player.lobby_id.filter(id)]) ctx.db.lobby_player.key.delete(p.key);
  for (const d of [...ctx.db.lobby_day_played.lobby_id.filter(id)]) ctx.db.lobby_day_played.key.delete(d.key);
  deleteVotes(ctx, id);
  ctx.db.lobby.id.delete(id);
}

export function leaveOthers(ctx: any, except: number | null) {
  for (const p of [...ctx.db.lobby_player.identity.filter(ctx.sender)]) {
    if (p.lobby_id === except) continue;
    const l = ctx.db.lobby.id.find(p.lobby_id);
    removePlayer(ctx, p.lobby_id, ctx.sender);
    if (l) afterLeave(ctx, l);
  }
}

export function ensureSweep(ctx: any) {
  for (const s of ctx.db.lobby_tick.iter()) if (s.kind === 'sweep') return;
  schedule(ctx, 'sweep', 0, SWEEP_EVERY_US, true);
}

