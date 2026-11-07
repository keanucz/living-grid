import { SenderError, ScheduleAt } from 'spacetimedb/server';
import { Identity } from 'spacetimedb';
import { MAX_CONFIDENCE, MIN_CONFIDENCE, callScore } from './beat_math';
import { BOT_SPECS, botId, lk } from './market_core';
import { applyResults } from './profile_core';

// "Beat the model": a game is five concrete calls on a mystery day. Each call is open for ANSWER_S, then revealed for
// REVEAL_S (the model's call, its top reason, what happened, everyone's score); the game ends after the fifth reveal.
// It reveals early once every person has answered. Players are scored like the bots (beat_math.ts). Nothing that
// would give an answer away is public before its reveal: the day's calls live in the private beat_day table, picks
// in the private beat_pick table, and beat_call carries the answer fields only after the reveal.

export const ANSWER_S = 14;
export const REVEAL_S = 4;
export const BEAT_BOTS = ['bot_yesterday', 'bot_engineer', 'lgbm_q', 'bot_committee'];

type BotAnswer = { choice: string; confidence: number };
export type Call = {
  id: string; kind: string; text: string; hour?: number; unit?: string;
  options: { id: string; label: string }[];
  answer: string; actual_text: string;
  model: { choice: string; confidence: number; reason: string };
  bots: Record<string, BotAnswer>;
};

const hex = (id: Identity) => id.toHexString();
const pk = (game: number, id: Identity) => lk(game, hex(id));
const ck = (game: number, idx: number) => lk(game, String(idx));
const pickKey = (game: number, id: Identity, idx: number) => lk(game, `${hex(id)}|${idx}`);

function schedule(ctx: any, kind: string, game: number, seconds: number) {
  ctx.db.beat_tick.insert({ scheduled_id: 0n, scheduled_at: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + BigInt(Math.round(seconds * 1e6))), kind, game_id: game });
}

function cancelTicks(ctx: any, game: number) {
  for (const s of [...ctx.db.beat_tick.iter()]) if (s.game_id === game) ctx.db.beat_tick.scheduled_id.delete(s.scheduled_id);
}

export function clearBeat(ctx: any, game: number) {
  cancelTicks(ctx, game);
  const PK: Record<string, string> = { beat_call: 'key', beat_pick: 'key', beat_result: 'key', beat_player: 'key' };
  for (const tbl of Object.keys(PK)) for (const row of [...ctx.db[tbl].game_id.filter(game)]) ctx.db[tbl][PK[tbl]].delete(row[PK[tbl]]);
  ctx.db.beat_secret.game_id.delete(game);
  ctx.db.beat_game.id.delete(game);
}

export function clearBeatForLobby(ctx: any, lobby: number) {
  if (lobby === 0) return;
  for (const g of [...ctx.db.beat_game.lobby_id.filter(lobby)]) clearBeat(ctx, g.id);
}

// Start a game for `players` (identity, name) on `day` (a beat_day row). lobby = 0 for a solo game.
export function startBeat(ctx: any, lobby: number, players: { identity: Identity; name: string }[], day: any, bots: boolean): number {
  const calls: Call[] = JSON.parse(day.calls_json);
  const game = ctx.db.beat_game.insert({
    id: 0, lobby_id: lobby, state: 'answering', call_no: 0, n_calls: calls.length, answer_s: ANSWER_S, reveal_s: REVEAL_S,
    opened_at: ctx.timestamp, day_revealed: '', started_at: ctx.timestamp,
  });
  ctx.db.beat_secret.insert({ game_id: game.id, day: day.day });
  calls.forEach((c, i) => ctx.db.beat_call.insert({
    key: ck(game.id, i), game_id: game.id, idx: i, kind: c.kind, text: c.text, hour: c.hour ?? 0, unit: c.unit ?? '',
    options_json: JSON.stringify(c.options), revealed: false, answer: '', actual_text: '', model_choice: '', model_confidence: 0,
    model_reason: '', bots_json: '',
  }));
  for (const p of players) ctx.db.beat_player.insert({ key: pk(game.id, p.identity), game_id: game.id, identity: p.identity, name: p.name, score: 0, is_bot: false });
  if (bots) for (const name of BEAT_BOTS) {
    const spec = BOT_SPECS.find(b => b.name === name)!;
    ctx.db.beat_player.insert({ key: pk(game.id, botId(name)), game_id: game.id, identity: botId(name), name: spec.title, score: 0, is_bot: true });
  }
  schedule(ctx, 'reveal', game.id, ANSWER_S);
  return game.id;
}

// A person's answer to the open call. Changing it before the reveal is fine.
export function answerBeat(ctx: any, game: number, who: Identity, idx: number, choice: string, confidence: number) {
  const g = ctx.db.beat_game.id.find(game);
  if (!g || g.state !== 'answering') throw new SenderError('this game is not taking answers right now');
  if (idx !== g.call_no) throw new SenderError('that call is not the open one');
  if (!ctx.db.beat_player.key.find(pk(game, who))) throw new SenderError('you are not playing in this game');
  const call = ctx.db.beat_call.key.find(ck(game, idx));
  if (!call || !(JSON.parse(call.options_json) as { id: string }[]).some(o => o.id === choice)) throw new SenderError('not one of the options');
  if (!Number.isInteger(confidence) || confidence < MIN_CONFIDENCE || confidence > MAX_CONFIDENCE) throw new SenderError(`confidence must be ${MIN_CONFIDENCE} to ${MAX_CONFIDENCE}`);
  const key = pickKey(game, who, idx);
  const row = { key, game_id: game, identity: who, idx, choice, confidence };
  if (ctx.db.beat_pick.key.find(key)) ctx.db.beat_pick.key.update(row);
  else ctx.db.beat_pick.insert(row);
  const humans = [...ctx.db.beat_player.game_id.filter(game)].filter((p: any) => !p.is_bot);
  if (humans.every((p: any) => ctx.db.beat_pick.key.find(pickKey(game, p.identity, idx)))) {
    cancelTicks(ctx, game);
    reveal(ctx, game);
  }
}

// Score and publish the open call, then schedule the next one (or end the game).
export function reveal(ctx: any, game: number) {
  const g = ctx.db.beat_game.id.find(game);
  if (!g || g.state !== 'answering') return;
  const idx = g.call_no;
  const day = ctx.db.beat_secret.game_id.find(game)?.day;
  const pooled = day ? ctx.db.beat_day.day.find(day) : null;
  if (!pooled) return;
  const call: Call = JSON.parse(pooled.calls_json)[idx];
  const n = call.options.length;
  for (const p of [...ctx.db.beat_player.game_id.filter(game)]) {
    let choice = '';
    let confidence = 0;
    if (p.is_bot) {
      const name = BOT_SPECS.find(b => botId(b.name).isEqual(p.identity))?.name ?? '';
      const a = call.bots[name];
      if (a) ({ choice, confidence } = a);
    } else {
      const pick = ctx.db.beat_pick.key.find(pickKey(game, p.identity, idx));
      if (pick) ({ choice, confidence } = pick);
    }
    const answered = choice !== '';
    const correct = choice === call.answer;
    const score = answered ? callScore(n, confidence, correct) : 0;
    ctx.db.beat_result.insert({ key: pickKey(game, p.identity, idx), game_id: game, identity: p.identity, idx, choice, confidence: Math.round(confidence), correct: answered && correct, score });
    ctx.db.beat_player.key.update({ ...p, score: Math.round((p.score + score) * 10) / 10 });
  }
  for (const pick of [...ctx.db.beat_pick.game_id.filter(game)]) if (pick.idx === idx) ctx.db.beat_pick.key.delete(pick.key);
  const row = ctx.db.beat_call.key.find(ck(game, idx));
  ctx.db.beat_call.key.update({
    ...row, revealed: true, answer: call.answer, actual_text: call.actual_text, model_choice: call.model.choice,
    model_confidence: call.model.confidence, model_reason: call.model.reason, bots_json: JSON.stringify(call.bots),
  });
  const last = idx + 1 >= g.n_calls;
  ctx.db.beat_game.id.update({ ...g, state: last ? 'done' : 'revealing', day_revealed: last ? day : '' });
  if (last) finish(ctx, ctx.db.beat_game.id.find(game), day);
  else schedule(ctx, 'open', game, REVEAL_S);
}

export function openNext(ctx: any, game: number) {
  const g = ctx.db.beat_game.id.find(game);
  if (!g || g.state !== 'revealing') return;
  ctx.db.beat_game.id.update({ ...g, state: 'answering', call_no: g.call_no + 1, opened_at: ctx.timestamp });
  schedule(ctx, 'reveal', game, ANSWER_S);
}

// Final standings feed the same ratings and meta leaderboard as other modes: one game_result row per person and bot.
function finish(ctx: any, g: any, day: string) {
  const rows = [...ctx.db.beat_player.game_id.filter(g.id)].sort((a: any, b: any) => b.score - a.score);
  const avatars: Record<string, string> = {};
  for (const lp of ctx.db.lobby_player.lobby_id.filter(g.lobby_id)) avatars[hex(lp.identity)] = lp.avatar;
  if (g.lobby_id === 0) for (const r of rows) if (!r.is_bot) avatars[hex(r.identity)] = ctx.db.profile.identity.find(r.identity)?.avatar ?? '';
  rows.forEach((r: any, i: number) => {
    const key = lk(g.lobby_id, `beat${g.id}|${hex(r.identity)}`);
    ctx.db.game_result.insert({
      key, lobby_id: g.lobby_id, round_no: g.id, identity: r.identity, name: r.name, is_bot: r.is_bot, mode: 'beat', day,
      rank: i + 1, n_players: rows.length, points: r.score, ended_at: ctx.timestamp,
    });
  });
  const lobbyRow = g.lobby_id ? ctx.db.lobby.id.find(g.lobby_id) : null;
  if (lobbyRow) ctx.db.lobby.id.update({ ...lobbyRow, state: 'reveal', state_since: ctx.timestamp });
  applyResults(ctx, rows.map((r: any, i: number) => ({ identity: r.identity, name: r.name, is_bot: r.is_bot, points: r.score, rank: i + 1 })), avatars);
}
