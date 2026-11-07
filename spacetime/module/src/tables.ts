import { table, t } from 'spacetimedb/server';

// Every publishable table is keyed by a string `key` built in the reducer from its natural key,
// so the Python publisher can resend rows idempotently. All timestamps are UTC.

export const zone = table(
  { name: 'zone', public: true },
  {
    code: t.string().primaryKey(),
    name: t.string(),
    currency: t.string(),
    lat: t.f64(),
    lon: t.f64(),
    updated_at: t.timestamp(),
  }
);

export const actual = table(
  { name: 'actual', public: true },
  {
    key: t.string().primaryKey(),
    ts: t.timestamp().index('btree'),
    zone: t.string().index('btree'),
    series: t.string(),
    value: t.f64(),
    unit: t.string(),
  }
);

export const forecast = table(
  { name: 'forecast', public: true },
  {
    key: t.string().primaryKey(),
    made_at: t.timestamp().index('btree'),
    zone: t.string().index('btree'),
    target: t.string(),
    ts: t.timestamp().index('btree'),
    horizon_h: t.i32(),
    p10: t.f64(),
    p50: t.f64(),
    p90: t.f64(),
    model_version: t.string(),
  }
);

export const score = table(
  { name: 'score', public: true },
  {
    key: t.string().primaryKey(),
    window_start: t.timestamp(),
    window_end: t.timestamp(),
    zone: t.string(),
    target: t.string(),
    metric: t.string(),
    model: t.string(),
    value: t.f64(),
    n: t.u32(),
  }
);

// One row per slot ('main' is the shared screen); the latest event replaces the previous one.
export const intervention = table(
  { name: 'intervention', public: true },
  {
    slot: t.string().primaryKey(),
    seq: t.u32(),
    type: t.string(),
    target: t.string(),
    magnitude: t.f64(),
    hours: t.u32(),
    triggered_at: t.timestamp(),
    triggered_by: t.string(),
    cost_total: t.f64(),
    currency: t.string(),
    explanation: t.string(),
    result_json: t.string(),
  }
);

export const ghost_wind = table(
  { name: 'ghost_wind', public: true },
  {
    key: t.string().primaryKey(),
    ts: t.timestamp().index('btree'),
    region: t.string(),
    method: t.string(),
    mwh: t.f64(),
    cost_gbp: t.f64(),
  }
);

export const carbon = table(
  { name: 'carbon', public: true },
  {
    key: t.string().primaryKey(),
    ts: t.timestamp().index('btree'),
    zone: t.string(),
    production_gco2_kwh: t.f64(),
    consumption_gco2_kwh: t.f64(),
    imports_share: t.f64(),
  }
);

export const battery = table(
  { name: 'battery', public: true },
  {
    key: t.string().primaryKey(),
    zone: t.string(),
    strategy: t.string(),
    soc_mwh: t.f64(),
    profit: t.f64(),
    currency: t.string(),
    share_of_perfect: t.f64(),
    updated_at: t.timestamp(),
  }
);

export const battery_action = table(
  { name: 'battery_action', public: true },
  {
    key: t.string().primaryKey(),
    ts: t.timestamp().index('btree'),
    zone: t.string(),
    strategy: t.string(),
    action: t.string(),
    mw: t.f64(),
    soc_mwh: t.f64(),
    price: t.f64(),
  }
);

export const player = table(
  { name: 'player', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    zone: t.string(),
    score: t.f64(),
    joined_at: t.timestamp(),
  }
);

export const player_decision = table(
  { name: 'player_decision', public: true },
  {
    key: t.string().primaryKey(),
    identity: t.identity().index('btree'),
    zone: t.string(),
    slot: t.timestamp().index('btree'),
    action: t.string(),
    settled: t.bool(),
    pnl: t.f64(),
    decided_at: t.timestamp(),
  }
);
