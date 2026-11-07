import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { playerTrade } from '../market_core';

// Player trades in a lobby's market round. The round rules, the start and the clock live in ../market_core.ts and
// reducers/lobby.ts; the question id is the one the client was given ('<lobby_id>|<id>').

export const market_buy = spacetimedb.reducer(
  { question_id: t.string(), side: t.string(), shares: t.f64() },
  (ctx, { question_id, side, shares }) => {
    if (!(shares > 0)) throw new SenderError('shares must be positive');
    playerTrade(ctx, question_id, side, shares);
  }
);

export const market_sell = spacetimedb.reducer(
  { question_id: t.string(), side: t.string(), shares: t.f64() },
  (ctx, { question_id, side, shares }) => {
    if (!(shares > 0)) throw new SenderError('shares must be positive');
    playerTrade(ctx, question_id, side, -shares);
  }
);

