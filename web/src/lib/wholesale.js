// Wholesale electricity prices in the units people know from their bills. 1 MWh = 1,000 kWh and £1 = 100p, so
// £ per MWh ÷ 10 = pence per kWh. These are wholesale prices: never label them as what a household pays.
export const pencePerKwh = (gbpPerMwh) => gbpPerMwh / 10

// "3.8p" (one decimal below 10p, whole pence above); the caller adds "per kWh" and says it is wholesale.
export function fmtPence(gbpPerMwh) {
  const p = Math.abs(pencePerKwh(gbpPerMwh))
  return `${p >= 10 ? p.toFixed(0) : p.toFixed(1)}p`
}
