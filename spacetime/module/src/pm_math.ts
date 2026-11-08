// Pricing for solo markets, no SpacetimeDB imports so engine/tests/test_pm.py can run this file with node against its
// own Python reference. Prices are whole cents (1 to 99) of a 100-cent share; a share pays 100 cents if it is right.
//
// The model is the market maker: the YES price is its probability. Everyone trades at the quote, never against each
// other, so there is no price impact, only a spread: you buy at the ask and sell at the bid, HALF_SPREAD cents either
// side of the price. NO is the mirror image of YES (its ask is 100 minus the YES bid), so a round trip costs the
// spread and nothing else.

export const HALF_SPREAD = 1;
export const START_POINTS = 1000;
export const MAX_SHARES = 500;
export const MIN_PRICE = 1;
export const MAX_PRICE = 99;

export const clampPrice = (cents: number): number => Math.min(MAX_PRICE, Math.max(MIN_PRICE, Math.round(cents)));

export type Quote = { yes_bid: number; yes_ask: number; no_bid: number; no_ask: number };

export function quote(price: number): Quote {
  const p = clampPrice(price);
  const yes_bid = Math.max(MIN_PRICE, p - HALF_SPREAD);
  const yes_ask = Math.min(MAX_PRICE, p + HALF_SPREAD);
  return { yes_bid, yes_ask, no_bid: 100 - yes_ask, no_ask: 100 - yes_bid };
}

// Cents per share you pay to buy, or receive to sell, `side` at model price `price`.
export function fill(price: number, side: 'yes' | 'no', action: 'buy' | 'sell'): number {
  const q = quote(price);
  if (side === 'yes') return action === 'buy' ? q.yes_ask : q.yes_bid;
  return action === 'buy' ? q.no_ask : q.no_bid;
}

// Points for a trade of `shares` at `cents` per share, to the cent.
export const points = (shares: number, cents: number): number => Math.round(shares * cents) / 100;

// What a held share is worth at the model's price (mid), in cents.
export const mark = (price: number, side: 'yes' | 'no'): number => (side === 'yes' ? clampPrice(price) : 100 - clampPrice(price));

// A bot with belief `p` (probability of YES) trades once at the open: the side with an edge of at least MIN_EDGE after the
// spread, staking a fraction of its points that grows with the edge (capped), in whole shares.
export const MIN_EDGE = 0.03;
export const MAX_STAKE = 0.2;
export const BOT_MAX_SHARES = 300;
export function botOrder(p: number, price: number, cash: number): { side: 'yes' | 'no'; shares: number } | null {
  const yesEdge = p - fill(price, 'yes', 'buy') / 100;
  const noEdge = 1 - p - fill(price, 'no', 'buy') / 100;
  const side = yesEdge >= noEdge ? 'yes' : 'no';
  const edge = Math.max(yesEdge, noEdge);
  if (edge < MIN_EDGE) return null;
  const stake = cash * Math.min(MAX_STAKE, 1.5 * edge);
  const shares = Math.min(BOT_MAX_SHARES, Math.floor((stake * 100) / fill(price, side, 'buy')));
  return shares > 0 ? { side, shares } : null;
}
