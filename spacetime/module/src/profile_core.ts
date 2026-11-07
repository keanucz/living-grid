import { START_RATING, eloDeltas } from './rating_math';

// Profiles and ratings across games, fed by the rows recordResults writes at each reveal (lobby_core.ts).

type Result = { identity: any; name: string; is_bot: boolean; points: number; rank: number };
const R2 = (x: number) => Math.round(x * 100) / 100;

export function ensureProfile(ctx: any, identity: any, name: string, avatar: string, isBot: boolean) {
  const row = ctx.db.profile.identity.find(identity);
  if (row) return row;
  const fresh = {
    identity, name, avatar, is_bot: isBot, games: 0, wins: 0, points_total: 0, rating: START_RATING, badges_json: '[]',
    bot_record_json: '{}', updated_at: ctx.timestamp,
  };
  ctx.db.profile.insert(fresh);
  return fresh;
}

const BADGES: [string, string][] = [
  ['first-game', 'Played a first game'],
  ['beat-the-bots', 'Finished ahead of every bot'],
  ['room-champion', 'Won a room of two or more people'],
  ['ten-games', 'Played ten games'],
];
export const BADGE_TEXT = Object.fromEntries(BADGES);

// One finished round: update every entrant's rating (people and bots), and the people's games, wins, points, bot
// record and badges. `avatars` maps identity hex to the avatar the person chose in the lobby.
export function applyResults(ctx: any, results: Result[], avatars: Record<string, string>) {
  const rows = results.map(r => ({ r, p: ensureProfile(ctx, r.identity, r.name, avatars[r.identity.toHexString()] ?? '', r.is_bot) }));
  const deltas = eloDeltas(rows.map(({ r, p }) => ({ id: r.identity.toHexString(), rating: p.rating, points: r.points })));
  const people = results.filter(r => !r.is_bot);
  const bots = results.filter(r => r.is_bot);
  const bestPeople = people.length ? Math.max(...people.map(r => r.points)) : 0;
  for (const { r, p } of rows) {
    const next: any = { ...p, rating: R2(p.rating + deltas[r.identity.toHexString()]), games: p.games + 1, updated_at: ctx.timestamp };
    if (!r.is_bot) {
      const ahead = bots.filter(b => r.points > b.points);
      const record = JSON.parse(p.bot_record_json || '{}');
      for (const b of bots) {
        const cur = record[b.name] ?? { w: 0, l: 0 };
        if (r.points > b.points) cur.w += 1;
        else if (r.points < b.points) cur.l += 1;
        record[b.name] = cur;
      }
      const won = r.points === bestPeople && (people.length > 1 || (bots.length > 0 && ahead.length === bots.length));
      next.wins = p.wins + (won ? 1 : 0);
      next.points_total = R2(p.points_total + r.points);
      next.bot_record_json = JSON.stringify(record);
      const have = new Set<string>(JSON.parse(p.badges_json || '[]'));
      have.add('first-game');
      if (bots.length && ahead.length === bots.length) have.add('beat-the-bots');
      if (won && people.length > 1) have.add('room-champion');
      if (next.games >= 10) have.add('ten-games');
      next.badges_json = JSON.stringify([...have]);
    }
    ctx.db.profile.identity.update(next);
  }
}
