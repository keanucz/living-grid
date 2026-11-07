import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { requireAdmin } from '../auth';
import { beat_tick } from '../tables';
import { ensureProfile } from '../profile_core';
import { cleanAvatar, cleanName } from '../lobby_core';
import { MAX_CONFIDENCE, MIN_CONFIDENCE } from '../beat_math';
import { answerBeat, clearBeat, openNext, reveal, startBeat, BEAT_BOTS, type Call } from '../beat_core';

// Beat the model. Solo: beat_start() plays five calls against the bots. In a lobby of mode 'beat' the host's Start
// does the same for everyone in the room (reducers/lobby.ts). beat_answer sends or changes your answer to the open
// call; the module opens, reveals and ends the game on its own timer (beat_tick_run).

export const beat_start = spacetimedb.reducer({ name: t.string(), avatar: t.string() }, (ctx, { name, avatar }) => {
  const who = cleanName(name);
  const face = cleanAvatar(avatar);
  const days = [...ctx.db.beat_day.iter()];
  if (!days.length) throw new SenderError('no mystery days are loaded yet');
  for (const old of [...ctx.db.beat_player.identity.filter(ctx.sender)]) {
    const g = ctx.db.beat_game.id.find(old.game_id);
    if (g && g.lobby_id === 0) clearBeat(ctx, g.id); // one solo game at a time
  }
  const profile = ensureProfile(ctx, ctx.sender, who, face, false);
  ctx.db.profile.identity.update({ ...profile, name: who, avatar: face, updated_at: ctx.timestamp });
  // Prefer a day this person has not played.
  const seen = new Set([...ctx.db.game_result.identity.filter(ctx.sender)].map((r: any) => r.day));
  const fresh = days.filter(d => !seen.has(d.day));
  const pool = fresh.length ? fresh : days;
  const day = pool[ctx.random.integerInRange(0, pool.length - 1)];
  startBeat(ctx, 0, [{ identity: ctx.sender, name: who }], day, true);
});

export const beat_answer = spacetimedb.reducer(
  { game_id: t.u32(), idx: t.u32(), choice: t.string(), confidence: t.u32() },
  (ctx, { game_id, idx, choice, confidence }) => answerBeat(ctx, game_id, ctx.sender, idx, choice, confidence)
);

// Runs when a beat_tick row comes due: reveal the open call, or open the next one. Only the database may call it.
export const beat_tick_run = spacetimedb.reducer({ onSchedule: beat_tick }, { arg: beat_tick.rowType }, (ctx, { arg }) => {
  if (!ctx.senderAuth.isInternal) throw new SenderError('scheduled reducer');
  if (arg.kind === 'reveal') reveal(ctx, arg.game_id);
  else if (arg.kind === 'open') openNext(ctx, arg.game_id);
});

// Admin: load or replace one mystery day's five calls (engine/beat/build.py makes them).
export const beat_day_put = spacetimedb.reducer({ day: t.string(), regime: t.string(), calls_json: t.string() }, (ctx, row) => {
  requireAdmin(ctx);
  if (row.regime !== 'calm' && row.regime !== 'windy') throw new SenderError('regime must be calm or windy');
  const calls: Call[] = JSON.parse(row.calls_json);
  if (!Array.isArray(calls) || calls.length < 1 || calls.length > 10) throw new SenderError('a day needs 1 to 10 calls');
  const bad = (m: string) => { throw new SenderError(`call ${m}`); };
  for (const c of calls) {
    const ids = (c.options ?? []).map(o => o.id);
    if (ids.length < 2 || new Set(ids).size !== ids.length) bad(`${c.id}: needs 2 or more distinct options`);
    if (!ids.includes(c.answer)) bad(`${c.id}: the answer is not one of the options`);
    if (!c.text || !c.model || !ids.includes(c.model.choice) || !c.model.reason) bad(`${c.id}: needs text and a model call with a reason`);
    for (const [name, a] of Object.entries(c.bots ?? {})) {
      if (!BEAT_BOTS.includes(name) || !ids.includes(a.choice) || !Number.isInteger(a.confidence) || a.confidence < MIN_CONFIDENCE || a.confidence > MAX_CONFIDENCE) {
        bad(`${c.id}: bad answer for ${name}`);
      }
    }
  }
  if (ctx.db.beat_day.day.find(row.day)) ctx.db.beat_day.day.update(row);
  else ctx.db.beat_day.insert(row);
});

export const beat_day_delete = spacetimedb.reducer({ day: t.string() }, (ctx, { day }) => {
  requireAdmin(ctx);
  ctx.db.beat_day.day.delete(day);
});
