// Pure rules for ratings and quick-play votes. No SpacetimeDB imports, so engine/tests/test_matchmaking.py can run
// this file with node and compare it with its own Python reference.

export const START_RATING = 1000;
export const K = 32;

export type Entry = { id: string; rating: number; points: number };

// Elo change for everyone in one round. Each pair plays one game (more points wins, equal points draw); a player's
// change is k/(n-1) times the sum of (score - expected) over the other n-1 entrants, so a bigger room does not move
// ratings further, and the changes sum to zero. People and bots are entrants alike.
export function eloDeltas(entries: Entry[], k: number = K): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(entries.map(e => [e.id, 0]));
  const n = entries.length;
  if (n < 2) return out;
  for (const a of entries) {
    for (const b of entries) {
      if (a.id === b.id) continue;
      const score = a.points > b.points ? 1 : a.points < b.points ? 0 : 0.5;
      const expected = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
      out[a.id] += (k / (n - 1)) * (score - expected);
    }
  }
  return out;
}

export type VoteOutcome = 'start' | 'wait' | 'none';

// More than half of the players voting start begins the game; half or more voting wait asks for longer (ties go
// to wait); otherwise nothing changes yet.
export function tally(votes: string[], players: number): VoteOutcome {
  const start = votes.filter(v => v === 'start').length;
  const wait = votes.filter(v => v === 'wait').length;
  if (start * 2 > players) return 'start';
  if (wait > 0 && wait * 2 >= players) return 'wait';
  return 'none';
}

export const WAIT_S = 30;
export const MAX_TOTAL_WAIT_S = 120;
export const START_NOW_S = 1;

// Seconds to wait after a 'wait' vote: WAIT_S, trimmed so the lobby never waits more than MAX_TOTAL_WAIT_S in all
// since it was created; 0 when too little is left to be worth it.
export function waitSeconds(sinceCreatedS: number): number {
  const left = MAX_TOTAL_WAIT_S - sinceCreatedS;
  return left < 5 ? 0 : Math.min(WAIT_S, Math.floor(left));
}
