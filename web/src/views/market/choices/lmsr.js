// LMSR over several options, the same rule as spacetime/module/src/market_core.ts (b is the liquidity).
const lse = (q, b) => {
  const ids = Object.keys(q)
  const m = Math.max(...ids.map((i) => q[i]))
  return m + b * Math.log(ids.reduce((z, i) => z + Math.exp((q[i] - m) / b), 0))
}

export const parse = (json, fallback) => {
  try {
    return json ? JSON.parse(json) : fallback
  } catch {
    return fallback
  }
}

// Points paid to buy `shares` of option `side` (negative when selling).
export function tradeCostN(q, side, shares, b) {
  const before = parse(q.qJson, {})
  if (!(side in before)) return NaN
  return lse({ ...before, [side]: before[side] + shares }, b) - lse(before, b)
}

// What a share is worth to you if our model is right: its probability minus the price, and what you lose if wrong.
export function edge(p, price) {
  return { expected: p - price, risk: price }
}
