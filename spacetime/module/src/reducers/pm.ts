import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { requireAdmin } from '../auth';
import { pm_tick } from '../tables';
import { ensureProfile } from '../profile_core';
import { cleanAvatar, cleanName } from '../lobby_core';
import { MAX_PRICE, MIN_PRICE } from '../pm_math';
import { PM_BOTS, clearPm, startPm, tickPm, tradePm, type PmMarket } from '../pm_core';

// Solo markets. pm_start begins a game on a random mystery day from pm_day; pm_buy and pm_sell trade at the model's
// current quote; the module advances the clock itself (pm_tick_run). See pm_core.ts.

export const pm_start = spacetimedb.reducer({ name: t.string(), avatar: t.string() }, (ctx, { name, avatar }) => {
  const who = cleanName(name);
  const face = cleanAvatar(avatar);
  const days = [...ctx.db.pm_day.iter()];
  if (!days.length) throw new SenderError('no mystery days are loaded yet');
  for (const old of [...ctx.db.pm_game.owner.filter(ctx.sender)]) clearPm(ctx, old.id); // one solo game at a time
  const profile = ensureProfile(ctx, ctx.sender, who, face, false);
  ctx.db.profile.identity.update({ ...profile, name: who, avatar: face, updated_at: ctx.timestamp });
  const seen = new Set([...ctx.db.game_result.identity.filter(ctx.sender)].map((r: any) => r.day));
  const fresh = days.filter(d => !seen.has(d.day));
  const pool = fresh.length ? fresh : days;
  startPm(ctx, ctx.sender, who, pool[ctx.random.integerInRange(0, pool.length - 1)]);
});

export const pm_buy = spacetimedb.reducer({ game_id: t.u32(), market_id: t.string(), side: t.string(), shares: t.u32() }, (ctx, a) =>
  tradePm(ctx, a.game_id, ctx.sender, a.market_id, a.side, 'buy', a.shares));

export const pm_sell = spacetimedb.reducer({ game_id: t.u32(), market_id: t.string(), side: t.string(), shares: t.u32() }, (ctx, a) =>
  tradePm(ctx, a.game_id, ctx.sender, a.market_id, a.side, 'sell', a.shares));

// Give up a running game (or clear a finished one).
export const pm_leave = spacetimedb.reducer({ game_id: t.u32() }, (ctx, { game_id }) => {
  const g = ctx.db.pm_game.id.find(game_id);
  if (g && g.owner.isEqual(ctx.sender)) clearPm(ctx, game_id);
});

export const pm_tick_run = spacetimedb.reducer({ onSchedule: pm_tick }, { arg: pm_tick.rowType }, (ctx, { arg }) => {
  if (!ctx.senderAuth.isInternal) throw new SenderError('scheduled reducer');
  tickPm(ctx, arg.game_id);
});

// Admin: load or replace one mystery day's markets (engine/pm/build.py makes them).
export const pm_day_put = spacetimedb.reducer(
  { day: t.string(), regime: t.string(), start_hour: t.u32(), end_hour: t.u32(), markets_json: t.string() },
  (ctx, row) => {
    requireAdmin(ctx);
    if (row.regime !== 'calm' && row.regime !== 'windy') throw new SenderError('regime must be calm or windy');
    if (row.end_hour <= row.start_hour || row.end_hour > 23) throw new SenderError('end_hour must be after start_hour, within the day');
    const ms: PmMarket[] = JSON.parse(row.markets_json);
    if (!Array.isArray(ms) || ms.length < 1 || ms.length > 12) throw new SenderError('a day needs 1 to 12 markets');
    const ids = new Set<string>();
    for (const m of ms) {
      const bad = (why: string) => { throw new SenderError(`market ${m.id}: ${why}`); };
      if (!m.id || ids.has(m.id) || m.id.includes('|')) bad('needs a unique id without |');
      ids.add(m.id);
      if (!m.text || (m.outcome !== 'yes' && m.outcome !== 'no') || !m.actual_text) bad('needs text, an outcome and actual_text');
      if (!(m.close_hour > row.start_hour && m.close_hour <= row.end_hour)) bad('close_hour must be after start_hour and by end_hour, or it never closes');
      for (let h = row.start_hour; h < m.close_hour; h++) {
        const p = m.prices?.[String(h)];
        if (!Number.isInteger(p) || p < MIN_PRICE || p > MAX_PRICE) bad(`needs a price of ${MIN_PRICE} to ${MAX_PRICE} cents for hour ${h}`);
      }
      for (const [b, p] of Object.entries(m.bots ?? {})) if (!PM_BOTS.includes(b) || !(p > 0 && p < 1)) bad(`bad belief for ${b}`);
    }
    if (ctx.db.pm_day.day.find(row.day)) ctx.db.pm_day.day.update(row);
    else ctx.db.pm_day.insert(row);
  }
);

export const pm_day_delete = spacetimedb.reducer({ day: t.string() }, (ctx, { day }) => {
  requireAdmin(ctx);
  ctx.db.pm_day.day.delete(day);
});
