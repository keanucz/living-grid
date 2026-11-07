import { t } from 'spacetimedb/server';
import spacetimedb from './schema';
import { forecast } from './tables';

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
