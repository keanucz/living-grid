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

// Mystery-day prediction market (points only). Every market table carries lobby_id and every key is prefixed
// '<lobby_id>|' so several rooms play at once; market_round.id IS the lobby id. The module runs the clock
// itself (lobby_tick below), so no engine process is needed.
export const market_round = table(
  { name: 'market_round', public: true },
  {
    id: t.u32().primaryKey(), // = lobby.id
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
    id: t.string().primaryKey(), // '<lobby_id>|<question id>'
    lobby_id: t.u32().index('btree'),
    group_id: t.string(), // '' for a plain yes/no; questions sharing a group are the options of one multi-outcome question
    option_label: t.string(), // the option's label inside its group (a price band, a zone, import or export)
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
    lobby_id: t.u32().index('btree'),
    outcome: t.bool(),
    actual: t.f64(),
  }
);

export const market_secret = table(
  { name: 'market_secret' },
  {
    round: t.u32().primaryKey(), // = lobby.id
    day: t.string(),
  }
);

export const market_account = table(
  { name: 'market_account', public: true },
  {
    key: t.string().primaryKey(), // '<lobby_id>|<identity hex>'
    lobby_id: t.u32().index('btree'),
    identity: t.identity().index('btree'),
    name: t.string(),
    points: t.f64(),
    is_model: t.bool(),
  }
);

export const market_position = table(
  { name: 'market_position', public: true },
  {
    key: t.string().primaryKey(),
    lobby_id: t.u32().index('btree'),
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
    key: t.string().primaryKey(), // '<lobby_id>|<hour>|<label>'
    lobby_id: t.u32().index('btree'),
    hour: t.u32(),
    label: t.string(),
    value: t.f64(),
    unit: t.string(),
  }
);

// Bot league: one row per bot and lobby (Brier is the mean over the questions it priced, -1 before any settles;
// points are in market_account under the same identity), each bot's probability per question, and the
// Nowcaster's inputs.
export const market_bot = table(
  { name: 'market_bot', public: true },
  {
    key: t.string().primaryKey(), // '<lobby_id>|<name>'
    lobby_id: t.u32().index('btree'),
    name: t.string(),
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
    key: t.string().primaryKey(), // '<bot>|<question id>' (the question id carries the lobby prefix)
    lobby_id: t.u32().index('btree'),
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
    lobby_id: t.u32().index('btree'),
    series: t.string(),
    profile_json: t.string(),
  }
);

// ---------------------------------------------------------------------------------------------------------------
// Lobbies. A lobby is a room with a 4-letter code and a host; one market round runs inside it.
export const lobby = table(
  { name: 'lobby', public: true },
  {
    id: t.u32().primaryKey().autoInc(),
    code: t.string().unique(),
    host: t.identity(),
    mode: t.string(), // market | battery
    state: t.string(), // waiting | countdown | playing | reveal
    seconds_per_hour: t.u32(),
    n_questions: t.u32(),
    bots: t.bool(),
    created_at: t.timestamp(),
    state_since: t.timestamp(),
    round_no: t.u32(), // rounds begun in this lobby (rematches count up)
    countdown_until: t.timestamp(), // when the running countdown ends; equals state_since outside a countdown
  }
);

export const lobby_player = table(
  { name: 'lobby_player', public: true },
  {
    key: t.string().primaryKey(), // '<lobby_id>|<identity hex>'
    lobby_id: t.u32().index('btree'),
    identity: t.identity().index('btree'),
    name: t.string(),
    avatar: t.string(),
    ready: t.bool(),
    points: t.f64(),
  }
);

// Private pool of mystery days (filled by the engine with pool_put). The day is never sent to clients; it is
// copied to market_secret and shown only when a round ends.
export const market_day_pool = table(
  { name: 'market_day_pool' },
  {
    day: t.string().primaryKey(),
    regime: t.string(), // calm | windy
    start_hour: t.u32(),
    end_hour: t.u32(),
    questions_json: t.string(), // MarketLeagueQuestionIn[]
    answers_json: t.string(), // {question_id, outcome, actual}[]
    feed_json: t.string(), // {"<hour>": [{label, value, unit}]}
    clues_json: t.string(), // owned by the clue shop (#167); the lobby code never reads it
  }
);

export const lobby_day_played = table(
  { name: 'lobby_day_played' },
  { key: t.string().primaryKey(), lobby_id: t.u32().index('btree'), day: t.string() }
);

// Scheduled work: kind 'begin' (countdown over, start the round), 'tick' (advance one game hour) or 'sweep'
// (delete lobbies idle for 2 h). Rows are only ever created by the module itself.
export const lobby_tick = table(
  { name: 'lobby_tick' },
  {
    scheduled_id: t.u64().primaryKey().autoInc(),
    scheduled_at: t.scheduleAt(),
    kind: t.string(),
    lobby_id: t.u32(),
  }
);

// ---------------------------------------------------------------------------------------------------------------
// Battery mode: one half-hour per tick on a mystery day's GB prices. Decisions stay private until their slot settles,
// so nobody can copy a rival; the day's prices and the agents' plans are private until each slot passes.
export const battery_day = table(
  { name: 'battery_day' },
  {
    day: t.string().primaryKey(),
    regime: t.string(), // calm | windy
    start_slot: t.u32(), // half-hour of the day the window starts at (0 to 47)
    n_slots: t.u32(),
    prices_json: t.string(), // number[n_slots], GBP/MWh actual
    plans_json: t.string(), // {"risk_aware": action[n_slots], "median_only": action[n_slots]} from as-of forecasts
  }
);

export const battery_round = table(
  { name: 'battery_round', public: true },
  {
    lobby_id: t.u32().primaryKey(),
    status: t.string(), // running | done
    slot: t.u32(), // the open slot: decisions for it are taken until the next tick
    n_slots: t.u32(),
    start_slot: t.u32(),
    seconds_per_slot: t.u32(),
    day_revealed: t.string(), // empty until the round is over
    started_at: t.timestamp(),
  }
);

export const battery_secret = table({ name: 'battery_secret' }, { lobby_id: t.u32().primaryKey(), day: t.string() });

export const battery_player = table(
  { name: 'battery_player', public: true },
  {
    key: t.string().primaryKey(), // '<lobby_id>|<identity hex>'
    lobby_id: t.u32().index('btree'),
    identity: t.identity().index('btree'),
    name: t.string(),
    soc_mwh: t.f64(),
    pnl: t.f64(), // GBP, settled slots only
    is_agent: t.bool(),
    kind: t.string(), // '' | risk_aware | median_only
  }
);

export const battery_pending = table(
  { name: 'battery_pending' },
  {
    key: t.string().primaryKey(), // '<lobby_id>|<identity hex>|<slot>'
    lobby_id: t.u32().index('btree'),
    identity: t.identity().index('btree'),
    slot: t.u32(),
    action: t.string(),
  }
);

export const battery_decision = table(
  { name: 'battery_decision', public: true },
  {
    key: t.string().primaryKey(), // '<lobby_id>|<identity hex>|<slot>'
    lobby_id: t.u32().index('btree'),
    identity: t.identity().index('btree'),
    slot: t.u32(),
    action: t.string(),
    price: t.f64(),
    grid_mwh: t.f64(),
    soc_mwh: t.f64(),
    pnl: t.f64(),
  }
);

export const battery_slot = table(
  { name: 'battery_slot', public: true },
  {
    key: t.string().primaryKey(), // '<lobby_id>|<slot>'
    lobby_id: t.u32().index('btree'),
    slot: t.u32(),
    price: t.f64(),
  }
);

// One row per participant (people and bots) when a round ends: the base for ratings and the meta leaderboard.
export const game_result = table(
  { name: 'game_result', public: true },
  {
    key: t.string().primaryKey(), // '<lobby_id>|<round_no>|<identity hex>'
    lobby_id: t.u32().index('btree'),
    round_no: t.u32(),
    identity: t.identity().index('btree'),
    name: t.string(),
    is_bot: t.bool(),
    mode: t.string(), // market | battery
    day: t.string(),
    rank: t.u32(),
    n_players: t.u32(),
    points: t.f64(), // market points or battery profit
    ended_at: t.timestamp(),
  }
);
