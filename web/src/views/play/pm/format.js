export const hh = (h) => `${String(h).padStart(2, '0')}:00`
export const pts = (v) => (v == null ? '—' : Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-GB') : (Math.round(v * 10) / 10).toFixed(1))
export const signedPts = (v) => (v == null ? '' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${pts(Math.abs(v))}`)
export const cents = (c) => `${c}¢`

// An icon for a market by its kind: day-ahead prices, wind switched off, imports and, later, weather markets.
const ICONS = [
  [/wind_off|ghost/, '≋'], [/wind|gust/, '≈'], [/rain|precip/, '☂'], [/temp|cold|frost|snow/, '❄'], [/solar|sun|cloud/, '☀'],
  [/import|export|flow/, '⇄'], [/neg/, '−'], [/price|day_ahead|gb_|system/, '£'],
]
export const iconFor = (kind) => ICONS.find(([re]) => re.test(String(kind)))?.[1] ?? '•'
export const isWeather = (kind) => /gust|rain|precip|temp|cold|frost|snow|cloud|sun|weather/.test(String(kind))
