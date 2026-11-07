import { t, SenderError, ScheduleAt } from 'spacetimedb/server';
import { Identity } from 'spacetimedb';
import spacetimedb from '../schema';
import { requireAdmin } from '../auth';
import { lobby_tick } from '../tables';
import { clearRound, lk, startRound, tickRound, type Answer, type DayQuestion, type FeedRow } from '../market_core';

// Lobbies: a room with a 4-letter code and a host. The host starts the game; after a 5 s countdown the module picks a
// random mystery day from market_day_pool and runs the round itself, one game hour per seconds_per_hour, with a
// scheduled reducer (lobby_tick). No engine process is involved once the pool is loaded.

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: they read as 1 and 0
const AVATARS = ['turbine', 'pylon', 'solar', 'flame', 'battery', 'wave'];
const MODES = ['market', 'battery'];
const COUNTDOWN_US = 5_000_000n;
const SWEEP_EVERY_US = 600_000_000n;
const STALE_US = 2n * 3_600_000_000n;
const MAX_PLAYERS = 40;
const DEFAULTS = { seconds_per_hour: 30, n_questions: 6, bots: true };
const LIMITS = { seconds_per_hour: [5, 120], n_questions: [1, 12] };
const TITLE = 'Mystery day';

const hex = (id: Identity) => id.toHexString();
const pkey = (lobby: number, id: Identity) => lk(lobby, hex(id));
const micros = (ts: any): bigint => ts.microsSinceUnixEpoch;

function findLobby(ctx: any, id: number) {
  const l = ctx.db.lobby.id.find(id);
  if (!l) throw new SenderError('that lobby no longer exists');
  return l;
}

function myLobby(ctx: any) {
  for (const p of ctx.db.lobby_player.identity.filter(ctx.sender)) return findLobby(ctx, p.lobby_id);
  throw new SenderError('you are not in a lobby');
}

function hostLobby(ctx: any) {
  const l = myLobby(ctx);
  if (!l.host.isEqual(ctx.sender)) throw new SenderError('only the host can do that');
  return l;
}

function setState(ctx: any, l: any, state: string) {
  const next = { ...l, state, state_since: ctx.timestamp };
  ctx.db.lobby.id.update(next);
  return next;
}

function schedule(ctx: any, kind: string, lobby: number, afterUs: bigint, every = false) {
  ctx.db.lobby_tick.insert({
    scheduled_id: 0n,
    scheduled_at: every ? ScheduleAt.interval(afterUs) : ScheduleAt.time(micros(ctx.timestamp) + afterUs),
    kind,
    lobby_id: lobby,
  });
}

function cancelSchedule(ctx: any, lobby: number) {
  for (const s of [...ctx.db.lobby_tick.iter()]) if (s.lobby_id === lobby && s.kind !== 'sweep') ctx.db.lobby_tick.scheduled_id.delete(s.scheduled_id);
}

function newCode(ctx: any): string {
  for (let i = 0; i < 200; i++) {
    let code = '';
    for (let k = 0; k < 4; k++) code += CODE_LETTERS[ctx.random.integerInRange(0, CODE_LETTERS.length - 1)];
    if (!ctx.db.lobby.code.find(code)) return code;
  }
  throw new SenderError('could not make a lobby code, try again');
}

function cleanName(name: string): string {
  const clean = name.trim().slice(0, 24);
  if (!clean) throw new SenderError('name required');
  return clean;
}

function cleanAvatar(avatar: string): string {
  return AVATARS.includes(avatar) ? avatar : AVATARS[0];
}

function removePlayer(ctx: any, lobby: number, id: Identity) {
  ctx.db.lobby_player.key.delete(pkey(lobby, id));
  ctx.db.market_account.key.delete(lk(lobby, hex(id)));
}

// A lobby with nobody in it is gone; if the host left, the longest-waiting player takes over.
function afterLeave(ctx: any, l: any) {
  const rest = [...ctx.db.lobby_player.lobby_id.filter(l.id)];
  if (!rest.length) return deleteLobby(ctx, l.id);
  if (l.host.isEqual(rest[0].identity) || rest.some((p: any) => p.identity.isEqual(l.host))) return;
  ctx.db.lobby.id.update({ ...l, host: rest[0].identity });
}

function deleteLobby(ctx: any, id: number) {
  cancelSchedule(ctx, id);
  clearRound(ctx, id);
  for (const p of [...ctx.db.lobby_player.lobby_id.filter(id)]) ctx.db.lobby_player.key.delete(p.key);
  for (const d of [...ctx.db.lobby_day_played.lobby_id.filter(id)]) ctx.db.lobby_day_played.key.delete(d.key);
  ctx.db.lobby.id.delete(id);
}

function leaveOthers(ctx: any, except: number | null) {
  for (const p of [...ctx.db.lobby_player.identity.filter(ctx.sender)]) {
    if (p.lobby_id === except) continue;
    const l = ctx.db.lobby.id.find(p.lobby_id);
    removePlayer(ctx, p.lobby_id, ctx.sender);
    if (l) afterLeave(ctx, l);
  }
}

function ensureSweep(ctx: any) {
  for (const s of ctx.db.lobby_tick.iter()) if (s.kind === 'sweep') return;
  schedule(ctx, 'sweep', 0, SWEEP_EVERY_US, true);
}

export const lobby_create = spacetimedb.reducer({ name: t.string(), avatar: t.string(), mode: t.string() }, (ctx, { name, avatar, mode }) => {
  if (!MODES.includes(mode)) throw new SenderError('mode must be market or battery');
  const who = cleanName(name);
  leaveOthers(ctx, null);
  const l = ctx.db.lobby.insert({
    id: 0, code: newCode(ctx), host: ctx.sender, mode, state: 'waiting', ...DEFAULTS, created_at: ctx.timestamp, state_since: ctx.timestamp,
  });
  ctx.db.lobby_player.insert({ key: pkey(l.id, ctx.sender), lobby_id: l.id, identity: ctx.sender, name: who, avatar: cleanAvatar(avatar), ready: false, points: 0 });
  ensureSweep(ctx);
});

export const lobby_join = spacetimedb.reducer({ code: t.string(), name: t.string(), avatar: t.string() }, (ctx, { code, name, avatar }) => {
  const l = ctx.db.lobby.code.find(code.trim().toUpperCase());
  if (!l) throw new SenderError('no lobby with that code');
  const who = cleanName(name);
  const existing = ctx.db.lobby_player.key.find(pkey(l.id, ctx.sender));
  if (existing) {
    ctx.db.lobby_player.key.update({ ...existing, name: who, avatar: cleanAvatar(avatar) });
    return;
  }
  if (l.state === 'countdown') throw new SenderError('the game is about to start');
  if ([...ctx.db.lobby_player.lobby_id.filter(l.id)].length >= MAX_PLAYERS) throw new SenderError('that lobby is full');
  leaveOthers(ctx, l.id);
  ctx.db.lobby_player.insert({ key: pkey(l.id, ctx.sender), lobby_id: l.id, identity: ctx.sender, name: who, avatar: cleanAvatar(avatar), ready: false, points: 0 });
  // Late joiners during a round start from the same points as everyone did.
  if (l.state === 'playing') {
    ctx.db.market_account.insert({ key: lk(l.id, hex(ctx.sender)), lobby_id: l.id, identity: ctx.sender, name: who, points: 1000, is_model: false });
    ctx.db.lobby_player.key.update({ ...ctx.db.lobby_player.key.find(pkey(l.id, ctx.sender))!, points: 1000 });
  }
});

export const lobby_ready = spacetimedb.reducer({ ready: t.bool() }, (ctx, { ready }) => {
  const l = myLobby(ctx);
  const p = ctx.db.lobby_player.key.find(pkey(l.id, ctx.sender));
  if (p) ctx.db.lobby_player.key.update({ ...p, ready });
});

export const lobby_leave = spacetimedb.reducer({}, ctx => {
  const l = myLobby(ctx);
  removePlayer(ctx, l.id, ctx.sender);
  afterLeave(ctx, l);
});

export const lobby_kick = spacetimedb.reducer({ identity_hex: t.string() }, (ctx, { identity_hex }) => {
  const l = hostLobby(ctx);
  const target = Identity.fromString(identity_hex);
  if (target.isEqual(ctx.sender)) throw new SenderError('use leave to leave your own lobby');
  if (!ctx.db.lobby_player.key.find(pkey(l.id, target))) throw new SenderError('that player is not in this lobby');
  removePlayer(ctx, l.id, target);
});

export const lobby_settings = spacetimedb.reducer(
  { seconds_per_hour: t.u32(), n_questions: t.u32(), bots: t.bool(), mode: t.string() },
  (ctx, { seconds_per_hour, n_questions, bots, mode }) => {
    const l = hostLobby(ctx);
    if (l.state !== 'waiting') throw new SenderError('settings can only change while waiting');
    if (!MODES.includes(mode)) throw new SenderError('mode must be market or battery');
    const [sLo, sHi] = LIMITS.seconds_per_hour;
    const [nLo, nHi] = LIMITS.n_questions;
    if (seconds_per_hour < sLo || seconds_per_hour > sHi) throw new SenderError(`seconds per hour must be ${sLo} to ${sHi}`);
    if (n_questions < nLo || n_questions > nHi) throw new SenderError(`questions must be ${nLo} to ${nHi}`);
    ctx.db.lobby.id.update({ ...l, seconds_per_hour, n_questions, bots, mode });
  }
);

export const lobby_start = spacetimedb.reducer({}, ctx => {
  const l = hostLobby(ctx);
  if (l.state !== 'waiting') throw new SenderError('the game has already started');
  if (l.mode !== 'market') throw new SenderError('battery mode is not available yet');
  if ([...ctx.db.market_day_pool.iter()].length === 0) throw new SenderError('no mystery days are loaded yet');
  setState(ctx, l, 'countdown');
  schedule(ctx, 'begin', l.id, COUNTDOWN_US);
});

export const lobby_rematch = spacetimedb.reducer({}, ctx => {
  const l = hostLobby(ctx);
  if (l.state !== 'reveal') throw new SenderError('a rematch is possible once the reveal is showing');
  cancelSchedule(ctx, l.id);
  clearRound(ctx, l.id);
  for (const p of [...ctx.db.lobby_player.lobby_id.filter(l.id)]) ctx.db.lobby_player.key.update({ ...p, ready: false, points: 0 });
  setState(ctx, l, 'waiting');
});

// Pick a random day this lobby has not played; when every day has been played, start the cycle again.
function pickDay(ctx: any, lobby: number) {
  const played = new Set([...ctx.db.lobby_day_played.lobby_id.filter(lobby)].map((d: any) => d.day));
  const all = [...ctx.db.market_day_pool.iter()];
  const fresh = all.filter((d: any) => !played.has(d.day));
  const pool = fresh.length ? fresh : all;
  if (!fresh.length) for (const d of [...ctx.db.lobby_day_played.lobby_id.filter(lobby)]) ctx.db.lobby_day_played.key.delete(d.key);
  return pool.length ? pool[ctx.random.integerInRange(0, pool.length - 1)] : null;
}

function begin(ctx: any, lobbyId: number) {
  const l = ctx.db.lobby.id.find(lobbyId);
  if (!l || l.state !== 'countdown') return;
  const day = pickDay(ctx, lobbyId);
  if (!day) {
    setState(ctx, l, 'waiting');
    return;
  }
  const all: DayQuestion[] = JSON.parse(day.questions_json);
  const answers: Answer[] = JSON.parse(day.answers_json);
  const open = all.filter(q => q.target_hour > day.start_hour).sort((a, b) => a.target_hour - b.target_hour || a.id.localeCompare(b.id));
  // Spread the picks over the day instead of taking only the earliest questions.
  const n = Math.min(l.n_questions, open.length);
  const picked = n ? Array.from({ length: n }, (_, i) => open[Math.floor((i * open.length) / n)]) : [];
  if (!picked.length) {
    setState(ctx, l, 'waiting');
    return;
  }
  startRound(ctx, l, day, picked, answers, TITLE);
  ctx.db.lobby_day_played.insert({ key: lk(lobbyId, day.day), lobby_id: lobbyId, day: day.day });
  setState(ctx, l, 'playing');
  schedule(ctx, 'tick', lobbyId, BigInt(l.seconds_per_hour) * 1_000_000n);
}

function tick(ctx: any, lobbyId: number) {
  const l = ctx.db.lobby.id.find(lobbyId);
  const r = ctx.db.market_round.id.find(lobbyId);
  if (!l || l.state !== 'playing' || !r || r.status !== 'running') return;
  const hour = r.clock_hour + 1;
  const day = ctx.db.market_secret.round.find(lobbyId)?.day;
  const pooled = day ? ctx.db.market_day_pool.day.find(day) : null;
  const feeds: Record<string, FeedRow[]> = pooled ? JSON.parse(pooled.feed_json || '{}') : {};
  const done = tickRound(ctx, lobbyId, hour, feeds[String(hour - 1)] ?? []);
  if (done) setState(ctx, l, 'reveal');
  else schedule(ctx, 'tick', lobbyId, BigInt(l.seconds_per_hour) * 1_000_000n);
}

function sweep(ctx: any) {
  const now = micros(ctx.timestamp);
  for (const l of [...ctx.db.lobby.iter()]) if (now - micros(l.state_since) > STALE_US) deleteLobby(ctx, l.id);
}

// Runs when a lobby_tick row comes due. Only the database itself may call it.
export const lobby_tick_run = spacetimedb.reducer({ onSchedule: lobby_tick }, { arg: lobby_tick.rowType }, (ctx, { arg }) => {
  if (!ctx.senderAuth.isInternal) throw new SenderError('scheduled reducer');
  if (arg.kind === 'begin') begin(ctx, arg.lobby_id);
  else if (arg.kind === 'tick') tick(ctx, arg.lobby_id);
  else if (arg.kind === 'sweep') sweep(ctx);
});

// Admin: load or replace one mystery day in the private pool.
export const pool_put = spacetimedb.reducer(
  {
    day: t.string(), regime: t.string(), start_hour: t.u32(), end_hour: t.u32(),
    questions_json: t.string(), answers_json: t.string(), feed_json: t.string(), clues_json: t.string(),
  },
  (ctx, row) => {
    requireAdmin(ctx);
    if (row.regime !== 'calm' && row.regime !== 'windy') throw new SenderError('regime must be calm or windy');
    if (row.end_hour <= row.start_hour) throw new SenderError('end_hour must be after start_hour');
    const qs: DayQuestion[] = JSON.parse(row.questions_json);
    const ans: Answer[] = JSON.parse(row.answers_json);
    JSON.parse(row.feed_json);
    if (!qs.length || qs.some(q => !ans.some(a => a.question_id === q.id))) throw new SenderError('every question needs an answer');
    if (ctx.db.market_day_pool.day.find(row.day)) ctx.db.market_day_pool.day.update(row);
    else ctx.db.market_day_pool.insert(row);
  }
);

export const pool_delete = spacetimedb.reducer({ day: t.string() }, (ctx, { day }) => {
  requireAdmin(ctx);
  ctx.db.market_day_pool.day.delete(day);
});
