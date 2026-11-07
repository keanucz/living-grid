import { SenderError } from 'spacetimedb/server';
import { Identity } from 'spacetimedb';
import { BATTERY, parseAction, step, slotPnl } from './battery_math';
import { lk } from './market_core';

// Battery rounds inside a lobby (see reducers/lobby.ts for start and ticks, reducers/game.ts for decisions).
// Two agents play every round: one plans with the median forecast, one with the risk-aware optimiser; their plans
// were made from as-of forecasts (before the day), stored in battery_day, and become visible when each slot settles.

const AGENT_HEX = { risk_aware: `${'0'.repeat(58)}a9e401`, median_only: `${'0'.repeat(58)}a9e402` };
const AGENT_NAME = { risk_aware: 'Risk-aware agent', median_only: 'Median-only agent' };
export const agentId = (kind: 'risk_aware' | 'median_only') => Identity.fromString(AGENT_HEX[kind]);
const pk = (lobby: number, id: Identity) => lk(lobby, id.toHexString());
const dk = (lobby: number, id: Identity, slot: number) => lk(lobby, `${id.toHexString()}|${slot}`);

export function clearBattery(ctx: any, lobby: number) {
  const PK: Record<string, string> = {
    battery_player: 'key', battery_pending: 'key', battery_decision: 'key', battery_slot: 'key',
  };
  for (const tbl of Object.keys(PK)) for (const row of [...ctx.db[tbl].lobby_id.filter(lobby)]) ctx.db[tbl][PK[tbl]].delete(row[PK[tbl]]);
  ctx.db.battery_secret.lobby_id.delete(lobby);
  ctx.db.battery_round.lobby_id.delete(lobby);
}

export function addBatteryPlayer(ctx: any, lobby: number, id: Identity, name: string, kind = '') {
  ctx.db.battery_player.insert({
    key: pk(lobby, id), lobby_id: lobby, identity: id, name, soc_mwh: BATTERY.soc0_mwh, pnl: 0, is_agent: kind !== '', kind,
  });
}

export function startBattery(ctx: any, lobby: { id: number; seconds_per_hour: number; bots: boolean }, day: any) {
  clearBattery(ctx, lobby.id);
  ctx.db.battery_round.insert({
    lobby_id: lobby.id, status: 'running', slot: 0, n_slots: day.n_slots, start_slot: day.start_slot,
    seconds_per_slot: lobby.seconds_per_hour, day_revealed: '', started_at: ctx.timestamp,
  });
  ctx.db.battery_secret.insert({ lobby_id: lobby.id, day: day.day });
  for (const p of [...ctx.db.lobby_player.lobby_id.filter(lobby.id)]) {
    addBatteryPlayer(ctx, lobby.id, p.identity, p.name);
    ctx.db.lobby_player.key.update({ ...p, points: 0, ready: false });
  }
  if (lobby.bots) for (const kind of ['risk_aware', 'median_only'] as const) addBatteryPlayer(ctx, lobby.id, agentId(kind), AGENT_NAME[kind], kind);
}

export function decideBattery(ctx: any, lobby: number, who: Identity, slot: number, action: string) {
  const r = ctx.db.battery_round.lobby_id.find(lobby);
  if (!r || r.status !== 'running') throw new SenderError('no battery round is running in this lobby');
  if (!parseAction(action)) throw new SenderError('unknown action: use charge, hold, discharge (optionally :1-100) or offer:discharge:<price>');
  if (!Number.isInteger(slot) || slot < r.slot || slot >= r.n_slots) throw new SenderError('that half-hour is closed or outside the round');
  if (!ctx.db.battery_player.key.find(pk(lobby, who))) throw new SenderError('you are not playing in this lobby');
  const key = dk(lobby, who, slot);
  const row = { key, lobby_id: lobby, identity: who, slot, action };
  if (ctx.db.battery_pending.key.find(key)) ctx.db.battery_pending.key.update(row);
  else ctx.db.battery_pending.insert(row);
}

// Settle the open slot for everyone (undecided means hold), publish its price, move to the next slot.
// Returns true when the round is over.
export function tickBattery(ctx: any, lobby: number): boolean {
  const r = ctx.db.battery_round.lobby_id.find(lobby);
  if (!r || r.status !== 'running') throw new SenderError('no battery round is running in this lobby');
  const day = ctx.db.battery_secret.lobby_id.find(lobby)?.day;
  const pooled = day ? ctx.db.battery_day.day.find(day) : null;
  if (!pooled) throw new SenderError('the day for this round is no longer in the pool');
  const price: number = JSON.parse(pooled.prices_json)[r.slot];
  const plans = JSON.parse(pooled.plans_json);
  for (const p of [...ctx.db.battery_player.lobby_id.filter(lobby)]) {
    const key = dk(lobby, p.identity, r.slot);
    const picked = p.is_agent ? plans[p.kind]?.[r.slot] : ctx.db.battery_pending.key.find(key)?.action;
    const action = typeof picked === 'string' && parseAction(picked) ? picked : 'hold';
    const [grid, soc] = step(p.soc_mwh, action, price);
    const pnl = slotPnl(price, grid);
    ctx.db.battery_decision.insert({ key, lobby_id: lobby, identity: p.identity, slot: r.slot, action, price, grid_mwh: grid, soc_mwh: soc, pnl });
    ctx.db.battery_player.key.update({ ...p, soc_mwh: soc, pnl: Math.round((p.pnl + pnl) * 100) / 100 });
    if (!p.is_agent) {
      const lp = ctx.db.lobby_player.key.find(pk(lobby, p.identity));
      if (lp) ctx.db.lobby_player.key.update({ ...lp, points: Math.round((p.pnl + pnl) * 100) / 100 });
    }
    ctx.db.battery_pending.key.delete(key);
  }
  ctx.db.battery_slot.insert({ key: lk(lobby, String(r.slot)), lobby_id: lobby, slot: r.slot, price });
  const next = r.slot + 1;
  const done = next >= r.n_slots;
  ctx.db.battery_round.lobby_id.update({ ...r, slot: next, status: done ? 'done' : 'running', day_revealed: done ? day : '' });
  return done;
}
