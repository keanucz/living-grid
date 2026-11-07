// Pure rules of the bot league, mirrored from engine/market/bots.py (the reference, with the tests): no SpacetimeDB
// imports, so the same code is checked against Python in engine/tests/test_market_bots.py.

export const ORDER = ['bot_last_week', 'bot_yesterday', 'bot_engineer', 'lgbm_q', 'bot_committee', 'bot_nowcaster'];
export const NOWCASTER = 'bot_nowcaster';
export const OUR_MODEL = 'lgbm_q';
export const BOT_MAX_SHARES = 150;
const ERROR_DECAY_PER_HOUR = 0.9;
const LEAD_H = 12;
const MIN_BAND_SHARE = 0.25;
const P_FLOOR = 0.03;
const P_CEIL = 0.97;

export function lse(y: number, n: number, b: number): number {
  const m = Math.max(y, n);
  return m + b * Math.log(Math.exp((y - m) / b) + Math.exp((n - m) / b));
}
export const priceYes = (y: number, n: number, b: number) => 1 / (1 + Math.exp((n - y) / b));

export function tradeCost(y: number, n: number, side: string, shares: number, b: number): number {
  return side === 'yes' ? lse(y + shares, n, b) - lse(y, n, b) : lse(y, n + shares, b) - lse(y, n, b);
}

// The side and number of shares that move the yes price to p.
export function sharesToReach(y: number, n: number, p: number, b: number): [string, number] {
  const q = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
  const gap = b * Math.log(q / (1 - q)) - (y - n);
  return gap >= 0 ? ['yes', gap] : ['no', -gap];
}

// Shares of `side` maximising expected log wealth for a bettor who wins with probability pWin and pays the LMSR cost.
export function fullKellyShares(pWin: number, side: string, bankroll: number, y: number, n: number, b: number): number {
  const py = priceYes(y, n, b);
  const price = side === 'yes' ? py : 1 - py;
  if (pWin <= price || bankroll <= 0) return 0;
  const [reachSide, reach] = sharesToReach(y, n, side === 'yes' ? pWin : 1 - pWin, b);
  let hi = reachSide === side ? reach : 0;
  const slope = (shares: number): number => {
    const cost = tradeCost(y, n, side, shares, b);
    const after = priceYes(y + (side === 'yes' ? shares : 0), n + (side === 'no' ? shares : 0), b);
    const marginal = side === 'yes' ? after : 1 - after;
    const left = bankroll - cost;
    if (left <= 0) return -1;
    return (pWin * (1 - marginal)) / (left + shares) - ((1 - pWin) * marginal) / left;
  };
  let lo = 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (slope(mid) > 0) lo = mid;
    else hi = mid;
  }
  return lo;
}

// [side, shares]: `fraction` of the full-Kelly position, at most cap.
export function kellyShares(p: number, priceYesNow: number, bankroll: number, fraction: number, cap: number, b: number, y: number, n: number): [string, number] {
  const q = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
  const side = q >= priceYesNow ? 'yes' : 'no';
  const full = fullKellyShares(side === 'yes' ? q : 1 - q, side, bankroll, y, n, b);
  return [side, Math.max(0, Math.min(fraction * full, cap))];
}

export function bandProbability(x: number, p10: number, p50: number, p90: number): number {
  if (!(p10 < p50 && p50 < p90)) return x === p50 ? 0.5 : x > p50 ? P_FLOOR : P_CEIL;
  const cdf = x <= p50 ? 0.5 - (0.4 * (p50 - x)) / (p50 - p10) : 0.5 + (0.4 * (x - p50)) / (p90 - p50);
  return Math.min(Math.max(1 - cdf, P_FLOOR), P_CEIL);
}

export type Quantiles = { p10: number; p50: number; p90: number };

// The Nowcaster's P(above): Our model's hourly profile corrected by the latest hour already played. Reads only
// observed hours strictly before the clock.
export function nowcastProbability(
  threshold: number, targetHour: number, clock: number, profile: Map<number, Quantiles>, observed: Map<number, number>, fallback: number
): number {
  const played = [...observed.keys()].filter(h => h < clock && profile.has(h) && h <= targetHour).sort((a, b) => a - b);
  const target = profile.get(targetHour);
  if (!played.length || !target) return fallback;
  const h0 = played[played.length - 1];
  const miss = observed.get(h0)! - profile.get(h0)!.p50;
  const gap = Math.max(1, targetHour - h0);
  const centre = target.p50 + miss * ERROR_DECAY_PER_HOUR ** gap;
  const width = Math.min(1, Math.max(MIN_BAND_SHARE, Math.sqrt(gap / LEAD_H)));
  const lo = target.p50 - target.p10;
  const hi = target.p90 - target.p50;
  return bandProbability(threshold, centre - lo * width, centre, centre + hi * width);
}
