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
    qtype: t.string(), // binary | choice (several options, one wins)
    choices_json: t.string(), // [{id, label}] for a choice question; '' for binary
    q_json: t.string(), // LMSR shares per option, as {id: shares}
    prices_json: t.string(), // current probability per option, as {id: p}
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
    outcome: t.string(), // the winning option id: yes | no for a binary question
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
    key: t.string().primaryKey(), // '<identity hex>|<question id>|<side>'
    lobby_id: t.u32().index('btree'),
    identity: t.identity().index('btree'),
    question_id: t.string().index('btree'),
    side: t.string(), // an option id (yes or no for a binary question)
    shares: t.f64(),
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
    kind: t.string(), // private | quick
    countdown_s: t.u32(), // length of the countdown that is (or was last) running
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

// What a player has paid to see. Private: the text is the clue itself, so it reaches only the buyer, through
// the my_clues view. The catalogue lives in market_day_pool.clues_json (see reducers/clues.ts).
export const clue_purchase = table(
  { name: 'clue_purchase' },
  {
    key: t.string().primaryKey(), // '<question id>|<identity hex>|<clue id>' (the question id carries the lobby prefix)
    lobby_id: t.u32().index('btree'),
    identity: t.identity().index('btree'),
    question_id: t.string(),
    clue_id: t.string(),
    label: t.string(),
    body: t.string(),
    cost: t.f64(),
    bought_hour: t.u32(),
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

// ---------------------------------------------------------------------------------------------------------------
// Quick play: players wait in the queue until a second one arrives, then a lobby is made and its countdown starts.
export const quick_queue = table(
  { name: 'quick_queue', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    avatar: t.string(),
    mode: t.string(),
    joined_at: t.timestamp(),
  }
);

// 'Start now' / 'Wait for more' votes during a quick lobby's countdown.
export const lobby_ballot = table(
  { name: 'lobby_ballot', public: true },
  {
    key: t.string().primaryKey(), // '<lobby_id>|<identity hex>'
    lobby_id: t.u32().index('btree'),
    identity: t.identity(),
    vote: t.string(), // start | wait
  }
);

// Persistent player profile and rating, across every game. Bots have rows too (their rating moves like anyone's).
export const profile = table(
  { name: 'profile', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    avatar: t.string(),
    is_bot: t.bool(),
    games: t.u32(),
    wins: t.u32(), // rounds finished first among the people in the room
    points_total: t.f64(),
    rating: t.f64(), // Elo, starts at 1000
    badges_json: t.string(), // string[]
    bot_record_json: t.string(), // {bot name: {w, l}}: games this player finished ahead of / behind that bot
    updated_at: t.timestamp(),
  }
);

// ---------------------------------------------------------------------------------------------------------------
// Beat the model: five concrete calls on a mystery day, scored with a proper scoring rule (beat_math.ts).
// Everything that would give an answer away stays private until its call is revealed.
export const beat_day = table(
  { name: 'beat_day' },
  {
    day: t.string().primaryKey(),
    regime: t.string(), // calm | windy
    calls_json: t.string(), // Call[]: text, options, answer, the model's call and reason, each bot's call (engine/beat/build.py)
  }
);

export const beat_game = table(
  { name: 'beat_game', public: true },
  {
    id: t.u32().primaryKey().autoInc(),
    lobby_id: t.u32().index('btree'), // 0 for a solo game
    state: t.string(), // answering | revealing | done
    call_no: t.u32(), // the open (or just revealed) call, 0 based
    n_calls: t.u32(),
    answer_s: t.u32(),
    reveal_s: t.u32(),
    opened_at: t.timestamp(), // when the open call started: count answer_s down from here
    day_revealed: t.string(), // empty until the last reveal
    started_at: t.timestamp(),
  }
);

export const beat_secret = table({ name: 'beat_secret' }, { game_id: t.u32().primaryKey(), day: t.string() });

export const beat_call = table(
  { name: 'beat_call', public: true },
  {
    key: t.string().primaryKey(), // '<game_id>|<idx>'
    game_id: t.u32().index('btree'),
    idx: t.u32(),
    kind: t.string(), // price_band | battery | import_export | which_zone | wind_over
    text: t.string(),
    hour: t.u32(),
    unit: t.string(),
    options_json: t.string(), // [{id, label}]
    revealed: t.bool(),
    answer: t.string(), // the winning option id; empty until revealed
    actual_text: t.string(), // what happened, in words; empty until revealed
    model_choice: t.string(),
    model_confidence: t.f64(),
    model_reason: t.string(), // the model's top reason, from its explanation
    bots_json: t.string(), // {bot name: {choice, confidence}}, empty until revealed
  }
);

export const beat_pick = table(
  { name: 'beat_pick' },
  {
    key: t.string().primaryKey(), // '<game_id>|<identity hex>|<idx>'
    game_id: t.u32().index('btree'),
    identity: t.identity(),
    idx: t.u32(),
    choice: t.string(),
    confidence: t.u32(), // 50 to 100
  }
);

export const beat_result = table(
  { name: 'beat_result', public: true },
  {
    key: t.string().primaryKey(), // '<game_id>|<identity hex>|<idx>'
    game_id: t.u32().index('btree'),
    identity: t.identity().index('btree'),
    idx: t.u32(),
    choice: t.string(), // empty when nobody answered
    confidence: t.u32(),
    correct: t.bool(),
    score: t.f64(),
  }
);

export const beat_player = table(
  { name: 'beat_player', public: true },
  {
    key: t.string().primaryKey(), // '<game_id>|<identity hex>'
    game_id: t.u32().index('btree'),
    identity: t.identity().index('btree'),
    name: t.string(),
    score: t.f64(),
    is_bot: t.bool(),
  }
);

export const beat_tick = table(
  { name: 'beat_tick' },
  { scheduled_id: t.u64().primaryKey().autoInc(), scheduled_at: t.scheduleAt(), kind: t.string(), game_id: t.u32() }
);

// ---------------------------------------------------------------------------------------------------------------
// Solo markets ("Polymarket style"): yes/no markets on a mystery day. The model is the market maker: the YES price in
// cents is the model's probability, with a small spread, and it moves each game hour as the Nowcaster updates on the
// hours already played. You buy and sell YES or NO at the current quote; each share pays 1 point if right. The day,
// the outcomes and the future prices stay in private tables until each market closes (pm_math.ts, pm_core.ts).
export const pm_day = table(
  { name: 'pm_day' },
  {
    day: t.string().primaryKey(),
    regime: t.string(), // calm | windy
    start_hour: t.u32(),
    end_hour: t.u32(),
    markets_json: t.string(), // PmMarket[] (engine/pm/build.py): text, close_hour, outcome, price path by hour, bots' probabilities
  }
);

export const pm_game = table(
  { name: 'pm_game', public: true },
  {
    id: t.u32().primaryKey().autoInc(),
    owner: t.identity().index('btree'),
    state: t.string(), // running | done
    clock_hour: t.u32(),
    start_hour: t.u32(),
    end_hour: t.u32(),
    seconds_per_hour: t.u32(),
    opened_at: t.timestamp(), // the last tick: the next one comes seconds_per_hour later
    day_revealed: t.string(), // empty until the game is over
    started_at: t.timestamp(),
  }
);

export const pm_secret = table({ name: 'pm_secret' }, { game_id: t.u32().primaryKey(), day: t.string() });

export const pm_market = table(
  { name: 'pm_market', public: true },
  {
    key: t.string().primaryKey(), // '<game_id>|<market id>'
    game_id: t.u32().index('btree'),
    market_id: t.string(),
    text: t.string(),
    kind: t.string(),
    unit: t.string(),
    close_hour: t.u32(),
    model_note: t.string(),
    status: t.string(), // open | closed
    price_yes: t.u32(), // cents, 1 to 99: the model's probability now
    note: t.string(), // why the price last moved
    outcome: t.string(), // '' until closed, then yes | no
    actual_text: t.string(), // what happened; empty until closed
  }
);

export const pm_price = table(
  { name: 'pm_price' , public: true },
  {
    key: t.string().primaryKey(), // '<game_id>|<market id>|<hour>'
    game_id: t.u32().index('btree'),
    market_id: t.string(),
    hour: t.u32(),
    price_yes: t.u32(),
  }
);

export const pm_account = table(
  { name: 'pm_account', public: true },
  {
    key: t.string().primaryKey(), // '<game_id>|<identity hex>'
    game_id: t.u32().index('btree'),
    identity: t.identity().index('btree'),
    name: t.string(),
    is_bot: t.bool(),
    points: t.f64(), // cash
    equity: t.f64(), // cash plus open positions at the model's price
  }
);

export const pm_position = table(
  { name: 'pm_position', public: true },
  {
    key: t.string().primaryKey(), // '<game_id>|<identity hex>|<market id>|<side>'
    game_id: t.u32().index('btree'),
    identity: t.identity().index('btree'),
    market_id: t.string(),
    side: t.string(), // yes | no
    shares: t.f64(),
    cost: t.f64(), // points paid for the shares still held
    settled: t.bool(),
    payout: t.f64(),
  }
);

export const pm_trade = table(
  { name: 'pm_trade', public: true },
  {
    key: t.string().primaryKey(), // '<game_id>|<seq>'
    game_id: t.u32().index('btree'),
    seq: t.u32(),
    identity: t.identity(),
    market_id: t.string(),
    side: t.string(),
    action: t.string(), // buy | sell
    shares: t.f64(),
    price: t.u32(), // cents paid or received per share of that side
    hour: t.u32(),
  }
);

export const pm_tick = table(
  { name: 'pm_tick' },
  { scheduled_id: t.u64().primaryKey().autoInc(), scheduled_at: t.scheduleAt(), game_id: t.u32() }
);

// A pm_game played by a room: which lobby it belongs to (solo games have no row). Additive, so pm_game itself is unchanged.
export const pm_room = table(
  { name: 'pm_room', public: true },
  { game_id: t.u32().primaryKey(), lobby_id: t.u32().index('btree') }
);
