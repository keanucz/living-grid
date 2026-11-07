import { CaseConversionPolicy, schema } from 'spacetimedb/server';
import {
  admin, actual, battery, battery_action, carbon, forecast, ghost_wind, intervention, player, player_decision, score, zone,
} from './tables';

// Wire names are exactly as written here (snake_case), matching the parquet contracts.
const spacetimedb = schema(
  { admin, zone, actual, forecast, score, intervention, ghost_wind, carbon, battery, battery_action, player, player_decision },
  { CASE_CONVERSION_POLICY: CaseConversionPolicy.None }
);
export default spacetimedb;
