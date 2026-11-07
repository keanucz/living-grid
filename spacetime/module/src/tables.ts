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

// Identities allowed to call the publish reducers. Private: never sent to subscribers.
export const admin = table(
  { name: 'admin' },
  {
    identity: t.identity().primaryKey(),
    note: t.string(),
    added_at: t.timestamp(),
  }
);

// Mystery-day prediction market (points only). One round at a time; engine/market drives the clock.
export const market_round = table(
  { name: 'market_round', public: true },
  {
    id: t.u32().primaryKey(),
    status: t.string(), // running | done
    title: t.string(),
    day_revealed: t.string(), // empty until the round is over
    clock_hour: t.u32(),
    start_hour: t.u32(),
    end_hour: t.u32(),
    seconds_per_hour: t.u32(),
    b: t.f64(),
    room_brier: t.f64(), // mean over settled questions; -1 before any settle
    model_brier: t.f64(),
    n_settled: t.u32(),
    started_at: t.timestamp(),
  }
);

export const market_question = table(
  { name: 'market_question', public: true },
  {
    id: t.string().primaryKey(),
    text: t.string(),
    kind: t.string(),
    target_hour: t.u32(),
    unit: t.string(),
    threshold: t.f64(),
    q_yes: t.f64(),
    q_no: t.f64(),
    price_yes: t.f64(),
    model_p: t.f64(),
    model_note: t.string(),
    status: t.string(), // open | settled
    outcome: t.string(), // '' until settled, then yes | no
    actual: t.f64(),
    room_p_close: t.f64(),
  }
);

// Outcomes stay private until their question settles.
export const market_answer = table(
  { name: 'market_answer' },
  {
    question_id: t.string().primaryKey(),
    outcome: t.bool(),
    actual: t.f64(),
  }
);

export const market_secret = table(
  { name: 'market_secret' },
  {
    round: t.u32().primaryKey(),
    day: t.string(),
  }
);

export const market_account = table(
  { name: 'market_account', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    points: t.f64(),
    is_model: t.bool(),
  }
);

export const market_position = table(
  { name: 'market_position', public: true },
  {
    key: t.string().primaryKey(),
    identity: t.identity().index('btree'),
    question_id: t.string().index('btree'),
    yes: t.f64(),
    no: t.f64(),
    spent: t.f64(),
  }
);

export const market_feed = table(
  { name: 'market_feed', public: true },
  {
    key: t.string().primaryKey(),
    hour: t.u32(),
    label: t.string(),
    value: t.f64(),
    unit: t.string(),
  }
);

// Bot league: one row per bot (Brier is the mean over the questions it priced, -1 before any settles; points are
// in market_account under the same identity), each bot's probability per question, and the Nowcaster's inputs.
export const market_bot = table(
  { name: 'market_bot', public: true },
  {
    name: t.string().primaryKey(),
    title: t.string(),
    method: t.string(),
    kelly: t.f64(),
    identity: t.identity(),
    brier: t.f64(),
    n: t.u32(),
  }
);

export const market_bot_p = table(
  { name: 'market_bot_p', public: true },
  {
    key: t.string().primaryKey(),
    bot: t.string(),
    question_id: t.string().index('btree'),
    p: t.f64(),
    note: t.string(),
    updated_hour: t.u32(),
  }
);

// Our model's hourly quantiles for a question's series: forecasts made before the day, no outcomes.
export const market_profile = table(
  { name: 'market_profile' },
  {
    question_id: t.string().primaryKey(),
    series: t.string(),
    profile_json: t.string(),
  }
);
