// Pricing for the solo markets: a copy of spacetime/module/src/pm_math.ts (the module is the source of truth, a test
// compares the two). Prices are whole cents of a 100-cent share; a share pays 100 cents if it is right. The model is the
// market maker: you buy at the ask and sell at the bid, one cent either side of its price.
export const HALF_SPREAD = 1
export const START_POINTS = 1000
export const MAX_SHARES = 500
export const MIN_PRICE = 1
export const MAX_PRICE = 99

export const clampPrice = (cents) => Math.min(MAX_PRICE, Math.max(MIN_PRICE, Math.round(cents)))

export function quote(price) {
  const p = clampPrice(price)
  const yesBid = Math.max(MIN_PRICE, p - HALF_SPREAD)
  const yesAsk = Math.min(MAX_PRICE, p + HALF_SPREAD)
  return { yesBid, yesAsk, noBid: 100 - yesAsk, noAsk: 100 - yesBid }
}

// Cents per share you pay to buy, or get to sell, `side` at model price `price`.
export function fill(price, side, action) {
  const q = quote(price)
  if (side === 'yes') return action === 'buy' ? q.yesAsk : q.yesBid
  return action === 'buy' ? q.noAsk : q.noBid
}

export const points = (shares, cents) => Math.round(shares * cents) / 100

// What a held share is worth at the model's price (mid), in cents.
export const mark = (price, side) => (side === 'yes' ? clampPrice(price) : 100 - clampPrice(price))

// How many whole shares `amount` points buys at `cents` each (never more than MAX_SHARES).
export const sharesFor = (amount, cents) => Math.min(MAX_SHARES, Math.max(0, Math.floor((amount * 100) / cents + 1e-9)))
