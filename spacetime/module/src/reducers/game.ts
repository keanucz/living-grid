import { t, SenderError } from 'spacetimedb/server';
import { Identity, Timestamp } from 'spacetimedb';
import spacetimedb from '../schema';
import { requireAdmin } from '../auth';
import { decideBattery } from '../battery_core';

// Room game. Players join, claim a zone battery (1 MW / 2 MWh) and choose charge, hold or discharge for
// upcoming half-hours. engine/game settles every decision on the GB system price (market index price as a
// provisional figure until the system price is out) and calls settle_decisions; score = sum of pnl.
// The agent is a player row with a fixed identity whose decisions come from our forecast (set_agent).

const ACTIONS = new Set(['charge', 'hold', 'discharge']);
const SLOT_US = 1_800_000_000n;
const AGENT_HEX = '0000000000000000000000000000000000000000000000000000000000a9e470';
const AGENT = Identity.fromString(AGENT_HEX);

const decisionKey = (identity: Identity, slot_us: bigint) => `${identity.toHexString()}|${slot_us}`;

function recordDecision(ctx: any, identity: Identity, zone: string, slot_us: bigint, action: string) {
  if (!ACTIONS.has(action)) throw new SenderError('action must be charge, hold or discharge');
  if (slot_us % SLOT_US !== 0n) throw new SenderError('slot must start on the half-hour');
  if (slot_us <= ctx.timestamp.microsSinceUnixEpoch) throw new SenderError('that half-hour has already started');
  const key = decisionKey(identity, slot_us);
  const prev = ctx.db.player_decision.key.find(key);
  if (prev?.settled) throw new SenderError('slot already settled');
  const row = { key, identity, zone, slot: new Timestamp(slot_us), action, settled: false, pnl: 0, decided_at: ctx.timestamp };
  if (prev) ctx.db.player_decision.key.update(row);
  else ctx.db.player_decision.insert(row);
}

function rescore(ctx: any, identity: Identity) {
  const p = ctx.db.player.identity.find(identity);
  if (!p) return;
  let score = 0;
  for (const d of ctx.db.player_decision.identity.filter(identity)) score += d.pnl;
  ctx.db.player.identity.update({ ...p, score: Math.round(score * 100) / 100 });
}

export const join = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const clean = name.trim().slice(0, 24);
  if (!clean) throw new SenderError('name required');
  if (ctx.sender.isEqual(AGENT)) throw new SenderError('reserved identity');
  const prev = ctx.db.player.identity.find(ctx.sender);
  if (prev) ctx.db.player.identity.update({ ...prev, name: clean });
  else ctx.db.player.insert({ identity: ctx.sender, name: clean, zone: '', score: 0, joined_at: ctx.timestamp });
});

export const claim_zone = spacetimedb.reducer({ zone: t.string() }, (ctx, { zone }) => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p) throw new SenderError('join first');
  if (!ctx.db.zone.code.find(zone)) throw new SenderError(`unknown zone ${zone}`);
  ctx.db.player.identity.update({ ...p, zone });
});

export const decide = spacetimedb.reducer({ slot_us: t.i64(), action: t.string() }, (ctx, { slot_us, action }) => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p || !p.zone) throw new SenderError('join and claim a zone first');
  recordDecision(ctx, ctx.sender, p.zone, slot_us, action);
});

const AgentDecision = t.object('AgentDecision', { slot_us: t.i64(), action: t.string() });

// Admin: create or rename the agent player and record its decisions for future slots (past ones are skipped).
export const set_agent = spacetimedb.reducer(
  { name: t.string(), zone: t.string(), decisions: t.array(AgentDecision) },
  (ctx, { name, zone, decisions }) => {
    requireAdmin(ctx);
    const prev = ctx.db.player.identity.find(AGENT);
    if (prev) ctx.db.player.identity.update({ ...prev, name, zone });
    else ctx.db.player.insert({ identity: AGENT, name, zone, score: 0, joined_at: ctx.timestamp });
    for (const d of decisions) {
      if (d.slot_us <= ctx.timestamp.microsSinceUnixEpoch) continue;
      const cur = ctx.db.player_decision.key.find(decisionKey(AGENT, d.slot_us));
      if (cur?.settled) continue;
      recordDecision(ctx, AGENT, zone, d.slot_us, d.action);
    }
  }
);

const Settlement = t.object('Settlement', { key: t.string(), pnl: t.f64(), final: t.bool() });

// Admin: write pnl for decisions. final=false is provisional (market index price) and may be revised;
// final=true (system price) locks the row. Scores of affected players are recomputed.
export const settle_decisions = spacetimedb.reducer({ rows: t.array(Settlement) }, (ctx, { rows }) => {
  requireAdmin(ctx);
  const touched = new Map<string, Identity>();
  for (const r of rows) {
    if (!Number.isFinite(r.pnl)) throw new SenderError(`pnl must be finite for ${r.key}`);
    const d = ctx.db.player_decision.key.find(r.key);
    if (!d || d.settled) continue;
    ctx.db.player_decision.key.update({ ...d, pnl: r.pnl, settled: r.final });
    touched.set(d.identity.toHexString(), d.identity);
  }
  for (const id of touched.values()) rescore(ctx, id);
});

// Admin: clear the room between demo rounds.
export const reset_game = spacetimedb.reducer({}, ctx => {
  requireAdmin(ctx);
  for (const d of [...ctx.db.player_decision.iter()]) ctx.db.player_decision.key.delete(d.key);
  for (const p of [...ctx.db.player.iter()]) ctx.db.player.identity.delete(p.identity);
});

// Battery mode inside a lobby: choose charge, hold or discharge for an open half-hour of the round. Undecided is hold.
export const battery_decide = spacetimedb.reducer({ slot: t.u32(), action: t.string() }, (ctx, { slot, action }) => {
  for (const p of ctx.db.lobby_player.identity.filter(ctx.sender)) return decideBattery(ctx, p.lobby_id, ctx.sender, slot, action);
  throw new SenderError('you are not in a lobby');
});

// Admin: load or replace one mystery day for battery rounds (see engine/game/battery_pool.py).
export const battery_pool_put = spacetimedb.reducer(
  { day: t.string(), regime: t.string(), start_slot: t.u32(), n_slots: t.u32(), prices_json: t.string(), plans_json: t.string() },
  (ctx, row) => {
    requireAdmin(ctx);
    if (row.regime !== 'calm' && row.regime !== 'windy') throw new SenderError('regime must be calm or windy');
    if (row.n_slots < 2 || row.start_slot + row.n_slots > 48) throw new SenderError('the window must fit inside one day (48 half-hours)');
    const prices = JSON.parse(row.prices_json);
    const plans = JSON.parse(row.plans_json);
    if (!Array.isArray(prices) || prices.length !== row.n_slots || prices.some((x: unknown) => typeof x !== 'number' || !Number.isFinite(x))) {
      throw new SenderError('prices_json needs one finite price per slot');
    }
    for (const kind of ['risk_aware', 'median_only']) {
      if (!Array.isArray(plans[kind]) || plans[kind].length !== row.n_slots) throw new SenderError(`plans_json needs a ${kind} action per slot`);
    }
    if (ctx.db.battery_day.day.find(row.day)) ctx.db.battery_day.day.update(row);
    else ctx.db.battery_day.insert(row);
  }
);
