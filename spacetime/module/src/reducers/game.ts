import { t, SenderError } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import spacetimedb from '../schema';

// Room game stubs. Settlement and scoring land in task #64.

const ACTIONS = new Set(['charge', 'hold', 'discharge']);

export const join = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const clean = name.trim().slice(0, 24);
  if (!clean) throw new SenderError('name required');
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
  if (!ACTIONS.has(action)) throw new SenderError('action must be charge, hold or discharge');
  const key = `${ctx.sender.toHexString()}|${slot_us}`;
  const row = {
    key,
    identity: ctx.sender,
    zone: p.zone,
    slot: new Timestamp(slot_us),
    action,
    settled: false,
    pnl: 0,
    decided_at: ctx.timestamp,
  };
  const prev = ctx.db.player_decision.key.find(key);
  if (prev?.settled) throw new SenderError('slot already settled');
  if (prev) ctx.db.player_decision.key.update(row);
  else ctx.db.player_decision.insert(row);
});
