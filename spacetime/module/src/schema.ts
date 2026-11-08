import { CaseConversionPolicy, schema } from 'spacetimedb/server';
import {
  admin, actual, battery, battery_action, carbon, forecast, ghost_wind, intervention, player, player_decision, score, zone,
  market_round, market_question, market_answer, market_secret, market_account, market_position, market_feed,
  market_bot, market_bot_p, market_profile, lobby, lobby_player, market_day_pool, lobby_day_played, lobby_tick, clue_purchase,
  battery_day, battery_round, battery_secret, battery_player, battery_pending, battery_decision, battery_slot, game_result, quick_queue, lobby_ballot, profile,
  beat_day, beat_game, beat_secret, beat_call, beat_pick, beat_result, beat_player, beat_tick,
  pm_day, pm_game, pm_secret, pm_market, pm_price, pm_account, pm_position, pm_trade, pm_tick,
} from './tables';

// Wire names are exactly as written here (snake_case), matching the parquet contracts.
const spacetimedb = schema(
  { admin, zone, actual, forecast, score, intervention, ghost_wind, carbon, battery, battery_action, player, player_decision,
    market_round, market_question, market_answer, market_secret, market_account, market_position, market_feed,
    market_bot, market_bot_p, market_profile, lobby, lobby_player, market_day_pool, lobby_day_played, lobby_tick, clue_purchase,
    battery_day, battery_round, battery_secret, battery_player, battery_pending, battery_decision, battery_slot, game_result, quick_queue, lobby_ballot, profile,
    beat_day, beat_game, beat_secret, beat_call, beat_pick, beat_result, beat_player, beat_tick,
    pm_day, pm_game, pm_secret, pm_market, pm_price, pm_account, pm_position, pm_trade, pm_tick },
  { CASE_CONVERSION_POLICY: CaseConversionPolicy.None }
);
export default spacetimedb;
