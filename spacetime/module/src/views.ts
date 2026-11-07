import { t } from 'spacetimedb/server';
import spacetimedb from './schema';
import { forecast, battery_pending } from './tables';

// Newest forecast per (zone, target, ts).
export const latest_forecast = spacetimedb.anonymousView(
  { name: 'latest_forecast', public: true },
  t.array(forecast.rowType),
  ctx => {
    const best = new Map<string, ReturnType<typeof ctx.db.forecast.iter> extends Iterable<infer R> ? R : never>();
    for (const f of ctx.db.forecast.iter()) {
      const k = `${f.zone}|${f.target}|${f.ts.microsSinceUnixEpoch}`;
      const cur = best.get(k);
      if (!cur || cur.made_at.microsSinceUnixEpoch < f.made_at.microsSinceUnixEpoch) best.set(k, f);
    }
    return [...best.values()];
  }
);

const LeaderboardRow = t.row('LeaderboardRow', {
  rank: t.u32(),
  name: t.string(),
  zone: t.string(),
  score: t.f64(),
});

export const leaderboard = spacetimedb.anonymousView(
  { name: 'leaderboard', public: true },
  t.array(LeaderboardRow),
  ctx =>
    [...ctx.db.player.iter()]
      .sort((a, b) => b.score - a.score)
      .map((p, i) => ({ rank: i + 1, name: p.name, zone: p.zone, score: p.score }))
);

const MarketLeaderboardRow = t.row('MarketLeaderboardRow', {
  lobby_id: t.u32(),
  rank: t.u32(),
  name: t.string(),
  points: t.f64(),
  is_model: t.bool(),
});

// Points after settled questions (open positions are not valued), ranked within each lobby.
export const market_leaderboard = spacetimedb.anonymousView(
  { name: 'market_leaderboard', public: true },
  t.array(MarketLeaderboardRow),
  ctx => {
    const by = new Map<number, ReturnType<typeof ctx.db.market_account.iter> extends Iterable<infer R> ? R[] : never>();
    for (const a of ctx.db.market_account.iter()) (by.get(a.lobby_id) ?? by.set(a.lobby_id, []).get(a.lobby_id)!).push(a);
    return [...by.entries()].flatMap(([lobby_id, rows]) =>
      rows.sort((a, b) => b.points - a.points).map((a, i) => ({ lobby_id, rank: i + 1, name: a.name, points: a.points, is_model: a.is_model }))
    );
  }
);

// A player's own undecided battery slots. The table itself is private so rivals cannot copy a choice.
export const battery_my_pending = spacetimedb.view(
  { name: 'battery_my_pending', public: true },
  t.array(battery_pending.rowType),
  ctx => [...ctx.db.battery_pending.identity.filter(ctx.sender)]
);
