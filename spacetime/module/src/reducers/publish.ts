import { t, SenderError } from 'spacetimedb/server';
import { Identity, Timestamp } from 'spacetimedb';
import spacetimedb from '../schema';
import { requireAdmin } from '../auth';

// Publish reducers, called by the Python publisher over HTTP. Every one starts with requireAdmin. Each takes a batch of rows and
// upserts by natural key, so resending is harmless. Timestamps arrive as integer microseconds
// since the Unix epoch (UTC) to keep the JSON plain.

const ts = (us: bigint) => new Timestamp(us);

interface Keyed<R> {
  insert(row: R): R;
  key: { find(key: string): R | null | undefined; update(row: R): R };
}

function upsert<R extends { key: string }>(tbl: Keyed<R>, row: R) {
  if (tbl.key.find(row.key)) tbl.key.update(row);
  else tbl.insert(row);
}

const ZoneIn = t.object('ZoneIn', {
  code: t.string(),
  name: t.string(),
  currency: t.string(),
  lat: t.f64(),
  lon: t.f64(),
});

export const upsert_zones = spacetimedb.reducer({ rows: t.array(ZoneIn) }, (ctx, { rows }) => {
  requireAdmin(ctx);
  for (const r of rows) {
    const row = { ...r, updated_at: ctx.timestamp };
    if (ctx.db.zone.code.find(r.code)) ctx.db.zone.code.update(row);
    else ctx.db.zone.insert(row);
  }
});

const ActualIn = t.object('ActualIn', {
  ts_us: t.i64(),
  zone: t.string(),
  series: t.string(),
  value: t.f64(),
  unit: t.string(),
});

export const upsert_actuals = spacetimedb.reducer({ rows: t.array(ActualIn) }, (ctx, { rows }) => {
  requireAdmin(ctx);
  for (const { ts_us, ...r } of rows) {
    upsert(ctx.db.actual, { ...r, key: `${r.zone}|${r.series}|${ts_us}`, ts: ts(ts_us) });
  }
});

const ForecastIn = t.object('ForecastIn', {
  made_at_us: t.i64(),
  zone: t.string(),
  target: t.string(),
  ts_us: t.i64(),
  horizon_h: t.i32(),
  p10: t.f64(),
  p50: t.f64(),
  p90: t.f64(),
  model_version: t.string(),
});

export const upsert_forecasts = spacetimedb.reducer({ rows: t.array(ForecastIn) }, (ctx, { rows }) => {
  requireAdmin(ctx);
  for (const { made_at_us, ts_us, ...r } of rows) {
    if (!(r.p10 <= r.p50 && r.p50 <= r.p90)) throw new SenderError('forecast quantiles must satisfy p10 <= p50 <= p90');
    upsert(ctx.db.forecast, {
      ...r,
      key: `${r.zone}|${r.target}|${ts_us}|${made_at_us}`,
      made_at: ts(made_at_us),
      ts: ts(ts_us),
    });
  }
});

const ScoreIn = t.object('ScoreIn', {
  window_start_us: t.i64(),
  window_end_us: t.i64(),
  zone: t.string(),
  target: t.string(),
  metric: t.string(),
  model: t.string(),
  value: t.f64(),
  n: t.u32(),
});

// Scores are current-window metrics: one row per (zone, target, metric, model).
export const upsert_scores = spacetimedb.reducer({ rows: t.array(ScoreIn) }, (ctx, { rows }) => {
  requireAdmin(ctx);
  for (const { window_start_us, window_end_us, ...r } of rows) {
    upsert(ctx.db.score, {
      ...r,
      key: `${r.zone}|${r.target}|${r.metric}|${r.model}`,
      window_start: ts(window_start_us),
      window_end: ts(window_end_us),
    });
  }
});

const GhostWindIn = t.object('GhostWindIn', {
  ts_us: t.i64(),
  region: t.string(),
  method: t.string(),
  mwh: t.f64(),
  cost_gbp: t.f64(),
});

export const upsert_ghost_wind = spacetimedb.reducer({ rows: t.array(GhostWindIn) }, (ctx, { rows }) => {
  requireAdmin(ctx);
  for (const { ts_us, ...r } of rows) {
    upsert(ctx.db.ghost_wind, { ...r, key: `${r.region}|${r.method}|${ts_us}`, ts: ts(ts_us) });
  }
});

const CarbonIn = t.object('CarbonIn', {
  ts_us: t.i64(),
  zone: t.string(),
  production_gco2_kwh: t.f64(),
  consumption_gco2_kwh: t.f64(),
  imports_share: t.f64(),
});

export const upsert_carbon = spacetimedb.reducer({ rows: t.array(CarbonIn) }, (ctx, { rows }) => {
  requireAdmin(ctx);
  for (const { ts_us, ...r } of rows) {
    upsert(ctx.db.carbon, { ...r, key: `${r.zone}|${ts_us}`, ts: ts(ts_us) });
  }
});

const BatteryIn = t.object('BatteryIn', {
  zone: t.string(),
  strategy: t.string(),
  soc_mwh: t.f64(),
  profit: t.f64(),
  currency: t.string(),
  share_of_perfect: t.f64(),
});

export const upsert_batteries = spacetimedb.reducer({ rows: t.array(BatteryIn) }, (ctx, { rows }) => {
  requireAdmin(ctx);
  for (const r of rows) {
    upsert(ctx.db.battery, { ...r, key: `${r.zone}|${r.strategy}`, updated_at: ctx.timestamp });
  }
});

const BatteryActionIn = t.object('BatteryActionIn', {
  ts_us: t.i64(),
  zone: t.string(),
  strategy: t.string(),
  action: t.string(),
  mw: t.f64(),
  soc_mwh: t.f64(),
  price: t.f64(),
});

export const upsert_battery_actions = spacetimedb.reducer({ rows: t.array(BatteryActionIn) }, (ctx, { rows }) => {
  requireAdmin(ctx);
  for (const { ts_us, ...r } of rows) {
    upsert(ctx.db.battery_action, { ...r, key: `${r.zone}|${r.strategy}|${ts_us}`, ts: ts(ts_us) });
  }
});

// The latest intervention for a screen slot ('main' unless stated). Replaces the previous one.
export const set_intervention = spacetimedb.reducer(
  {
    slot: t.string(),
    type: t.string(),
    target: t.string(),
    magnitude: t.f64(),
    hours: t.u32(),
    triggered_by: t.string(),
    cost_total: t.f64(),
    currency: t.string(),
    explanation: t.string(),
    result_json: t.string(),
  },
  (ctx, args) => {
    requireAdmin(ctx);
    const slot = args.slot || 'main';
    const prev = ctx.db.intervention.slot.find(slot);
    const row = { ...args, slot, seq: (prev?.seq ?? 0) + 1, triggered_at: ctx.timestamp };
    if (prev) ctx.db.intervention.slot.update(row);
    else ctx.db.intervention.insert(row);
  }
);

export const clear_intervention = spacetimedb.reducer({ slot: t.string() }, (ctx, { slot }) => {
  requireAdmin(ctx);
  ctx.db.intervention.slot.delete(slot || 'main');
});

// Drop time-series rows older than the cutoff so subscriptions stay small.
export const prune_before = spacetimedb.reducer({ before_us: t.i64() }, (ctx, { before_us }) => {
  requireAdmin(ctx);
  const old = (x: Timestamp) => x.microsSinceUnixEpoch < before_us;
  for (const r of [...ctx.db.actual.iter()]) if (old(r.ts)) ctx.db.actual.key.delete(r.key);
  for (const r of [...ctx.db.forecast.iter()]) if (old(r.ts)) ctx.db.forecast.key.delete(r.key);
  for (const r of [...ctx.db.ghost_wind.iter()]) if (old(r.ts)) ctx.db.ghost_wind.key.delete(r.key);
  for (const r of [...ctx.db.carbon.iter()]) if (old(r.ts)) ctx.db.carbon.key.delete(r.key);
  for (const r of [...ctx.db.battery_action.iter()]) if (old(r.ts)) ctx.db.battery_action.key.delete(r.key);
});

// Delete rows by primary key, admin only: publisher-owned tables, so the publisher can reconcile the database with
// its live sources (e.g. remove sample rows pushed before #84), and the leaderboards' game rows.
const DELETABLE: Record<string, (ctx: any, key: string) => void> = {
  zone: (ctx, k) => ctx.db.zone.code.delete(k),
  actual: (ctx, k) => ctx.db.actual.key.delete(k),
  forecast: (ctx, k) => ctx.db.forecast.key.delete(k),
  score: (ctx, k) => ctx.db.score.key.delete(k),
  ghost_wind: (ctx, k) => ctx.db.ghost_wind.key.delete(k),
  carbon: (ctx, k) => ctx.db.carbon.key.delete(k),
  battery: (ctx, k) => ctx.db.battery.key.delete(k),
  battery_action: (ctx, k) => ctx.db.battery_action.key.delete(k),
  // Game rows the leaderboards read, so the admin can remove QA and test players before judging.
  // Keys: game_result '<lobby>|<round>|<identity hex>', market_account '<lobby>|<identity hex>', profile and player
  // the identity hex.
  game_result: (ctx, k) => ctx.db.game_result.key.delete(k),
  market_account: (ctx, k) => ctx.db.market_account.key.delete(k),
  profile: (ctx, k) => ctx.db.profile.identity.delete(Identity.fromString(k)),
  player: (ctx, k) => ctx.db.player.identity.delete(Identity.fromString(k)),
};

export const delete_keys = spacetimedb.reducer({ table: t.string(), keys: t.array(t.string()) }, (ctx, { table, keys }) => {
  requireAdmin(ctx);
  const del = DELETABLE[table];
  if (!del) throw new SenderError(`delete_keys: table ${table} cannot be deleted by key`);
  for (const k of keys) del(ctx, k);
});
