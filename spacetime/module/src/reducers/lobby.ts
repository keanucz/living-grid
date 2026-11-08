import { t, SenderError, ScheduleAt } from 'spacetimedb/server';
import { Identity } from 'spacetimedb';
import spacetimedb from '../schema';
import { requireAdmin } from '../auth';
import { lobby_tick } from '../tables';
import { clearRound, lk, startRound, tickRound, type Answer, type DayQuestion, type FeedRow } from '../market_core';
import {
  DEFAULTS, MAX_PLAYERS, MODES, afterLeave, cancelSchedule, cleanAvatar, cleanName, deleteLobby, ensureSweep, hex, leaveOthers, micros,
  newCode, pkey, recordResults, removePlayer, schedule, setState, startCountdown,
} from '../lobby_core';
import { clearBeatForLobby, startBeat } from '../beat_core';
import { clearPmForLobby, startPmGame } from '../pm_core';
import { addBatteryPlayer, clearBattery, startBattery, tickBattery } from '../battery_core';

// Lobbies: a room with a 4-letter code and a host. The host starts the game; after a 5 s countdown the module picks a
// random mystery day from market_day_pool and runs the round itself, one game hour per seconds_per_hour, with a
// scheduled reducer (lobby_tick). No engine process is involved once the pool is loaded.

const STALE_US = 2n * 3_600_000_000n;
const LIMITS = { seconds_per_hour: [5, 120], n_questions: [1, 12] };
const TITLE = 'Mystery day';


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

export const lobby_create = spacetimedb.reducer({ name: t.string(), avatar: t.string(), mode: t.string() }, (ctx, { name, avatar, mode }) => {
  if (!MODES.includes(mode)) throw new SenderError('mode must be market, battery, beat or pm');
  const who = cleanName(name);
  leaveOthers(ctx, null);
  const l = ctx.db.lobby.insert({
    id: 0, code: newCode(ctx), host: ctx.sender, mode, state: 'waiting', kind: 'private', countdown_s: 0, ...DEFAULTS, seconds_per_hour: mode === 'battery' ? 10 : DEFAULTS.seconds_per_hour,
    created_at: ctx.timestamp, state_since: ctx.timestamp, round_no: 0, countdown_until: ctx.timestamp,
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
  if (l.state === 'countdown' && l.kind !== 'quick') throw new SenderError('the game is about to start');
  if (l.state === 'playing' && (l.mode === 'beat' || l.mode === 'pm')) throw new SenderError('this game has already started: join the next round');
  if ([...ctx.db.lobby_player.lobby_id.filter(l.id)].length >= MAX_PLAYERS) throw new SenderError('that lobby is full');
  leaveOthers(ctx, l.id);
  ctx.db.lobby_player.insert({ key: pkey(l.id, ctx.sender), lobby_id: l.id, identity: ctx.sender, name: who, avatar: cleanAvatar(avatar), ready: false, points: 0 });
  // Late joiners during a round start from the same points as everyone did.
  if (l.state === 'playing' && l.mode === 'battery') {
    addBatteryPlayer(ctx, l.id, ctx.sender, who);
  } else if (l.state === 'playing') {
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
    if (!MODES.includes(mode)) throw new SenderError('mode must be market, battery, beat or pm');
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
  const pool = l.mode === 'battery' ? ctx.db.battery_day : l.mode === 'beat' ? ctx.db.beat_day : l.mode === 'pm' ? ctx.db.pm_day : ctx.db.market_day_pool;
  if ([...pool.iter()].length === 0) throw new SenderError('no mystery days are loaded yet');
  startCountdown(ctx, l);
});

export const lobby_rematch = spacetimedb.reducer({}, ctx => {
  const l = hostLobby(ctx);
  if (l.state !== 'reveal') throw new SenderError('a rematch is possible once the reveal is showing');
  cancelSchedule(ctx, l.id);
  clearRound(ctx, l.id);
  clearBattery(ctx, l.id);
  clearBeatForLobby(ctx, l.id);
  clearPmForLobby(ctx, l.id);
  for (const p of [...ctx.db.lobby_player.lobby_id.filter(l.id)]) ctx.db.lobby_player.key.update({ ...p, ready: false, points: 0 });
  setState(ctx, l, 'waiting');
});

// Pick a random day this lobby has not played; when every day has been played, start the cycle again.
function pickDay(ctx: any, lobby: number, table: any) {
  const played = new Set([...ctx.db.lobby_day_played.lobby_id.filter(lobby)].map((d: any) => d.day));
  const all = [...table.iter()];
  const fresh = all.filter((d: any) => !played.has(d.day));
  const pool = fresh.length ? fresh : all;
  if (!fresh.length) for (const d of [...ctx.db.lobby_day_played.lobby_id.filter(lobby)]) ctx.db.lobby_day_played.key.delete(d.key);
  return pool.length ? pool[ctx.random.integerInRange(0, pool.length - 1)] : null;
}

function begin(ctx: any, lobbyId: number) {
  const l = ctx.db.lobby.id.find(lobbyId);
  if (!l || l.state !== 'countdown') return;
  const day = pickDay(ctx, lobbyId, l.mode === 'battery' ? ctx.db.battery_day : l.mode === 'beat' ? ctx.db.beat_day : l.mode === 'pm' ? ctx.db.pm_day : ctx.db.market_day_pool);
  if (day && l.mode === 'pm') {
    startPmGame(ctx, [...ctx.db.lobby_player.lobby_id.filter(lobbyId)].map((p: any) => ({ identity: p.identity, name: p.name })), l.host, lobbyId, day, l.bots);
    ctx.db.lobby_day_played.insert({ key: lk(lobbyId, day.day), lobby_id: lobbyId, day: day.day });
    setState(ctx, l, 'playing', { round_no: l.round_no + 1, countdown_until: ctx.timestamp });
    return;
  }
  if (day && l.mode === 'beat') {
    startBeat(ctx, lobbyId, [...ctx.db.lobby_player.lobby_id.filter(lobbyId)].map((p: any) => ({ identity: p.identity, name: p.name })), day, l.bots);
    ctx.db.lobby_day_played.insert({ key: lk(lobbyId, day.day), lobby_id: lobbyId, day: day.day });
    setState(ctx, l, 'playing', { round_no: l.round_no + 1, countdown_until: ctx.timestamp });
    return;
  }
  if (day && l.mode === 'battery') {
    startBattery(ctx, l, day);
    ctx.db.lobby_day_played.insert({ key: lk(lobbyId, day.day), lobby_id: lobbyId, day: day.day });
    setState(ctx, l, 'playing', { round_no: l.round_no + 1, countdown_until: ctx.timestamp });
    schedule(ctx, 'tick', lobbyId, BigInt(l.seconds_per_hour) * 1_000_000n);
    return;
  }
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
  setState(ctx, l, 'playing', { round_no: l.round_no + 1, countdown_until: ctx.timestamp });
  schedule(ctx, 'tick', lobbyId, BigInt(l.seconds_per_hour) * 1_000_000n);
}

function tick(ctx: any, lobbyId: number) {
  const l = ctx.db.lobby.id.find(lobbyId);
  if (l && l.mode === 'battery') {
    if (l.state !== 'playing') return;
    if (tickBattery(ctx, lobbyId)) {
      const done = setState(ctx, l, 'reveal');
      recordResults(ctx, done, 'battery', ctx.db.battery_secret.lobby_id.find(lobbyId)?.day ?? '');
    }
    else schedule(ctx, 'tick', lobbyId, BigInt(l.seconds_per_hour) * 1_000_000n);
    return;
  }
  const r = ctx.db.market_round.id.find(lobbyId);
  if (!l || l.state !== 'playing' || !r || r.status !== 'running') return;
  const hour = r.clock_hour + 1;
  const day = ctx.db.market_secret.round.find(lobbyId)?.day;
  const pooled = day ? ctx.db.market_day_pool.day.find(day) : null;
  const feeds: Record<string, FeedRow[]> = pooled ? JSON.parse(pooled.feed_json || '{}') : {};
  const done = tickRound(ctx, lobbyId, hour, feeds[String(hour - 1)] ?? []);
  if (done) {
    const over = setState(ctx, l, 'reveal');
    recordResults(ctx, over, 'market', day ?? '');
  } else schedule(ctx, 'tick', lobbyId, BigInt(l.seconds_per_hour) * 1_000_000n);
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
    if (qs.some(q => q.target_hour <= row.start_hour || q.target_hour > row.end_hour)) throw new SenderError('every question hour must fall after start_hour and by end_hour, or it never settles');
    if (ctx.db.market_day_pool.day.find(row.day)) ctx.db.market_day_pool.day.update(row);
    else ctx.db.market_day_pool.insert(row);
  }
);

export const pool_delete = spacetimedb.reducer({ day: t.string() }, (ctx, { day }) => {
  requireAdmin(ctx);
  ctx.db.market_day_pool.day.delete(day);
});
