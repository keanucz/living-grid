// The UI model of a Beat the model round, and pure helpers around it. Screens read only this shape; adapter.js builds it
// from the SpacetimeDB rows and demo.js from a script, so a change in table names touches one file.
//
//   {
//     rehearsal?: true                                     // invented content (demo.js), labelled on screen
//     status: 'idle' | 'running' | 'done',
//     nCalls, callNo, phase: 'answer' | 'reveal', phaseUntil (ms) | null,
//     call:   { n, kind, text, options: [{ id, label }], unit, hour, context } | null,
//     mine:   { option, confidence } | null              // my locked answer to the open call
//     reveal: { correct, actual, actualText, model: { option, confidence, reason, points },
//               mine: { option, confidence, points } | null,
//               bots: [{ id, title, option, confidence, points }] } | null
//     totals: [{ id, name, isBot, isMe, points }]          // ranked, best first
//     history: [{ n, right: bool | null, points }]         // my result per revealed call
//     end:    { day, regime, rank, nPlayers, beats: [{ title, beat }], meta: { rank, rating, delta } | null } | null
//   }

export const CONF_MIN = 50
export const CONF_MAX = 100
export const CONF_DEFAULT = 70

export const KINDS = {
  price_band: { label: 'Price', icon: '£' },
  battery: { label: 'Battery', icon: '⚡' },
  import_export: { label: 'Imports', icon: '⇄' },
  dearest_zone: { label: 'Dearest zone', icon: '▲' },
  wind_off: { label: 'Wind switched off', icon: '≋' },
}
export const kindInfo = (k) => KINDS[k] ?? { label: 'Call', icon: '?' }

// How sure the player says they are, in words (the slider shows the number too).
export function confidenceWord(c) {
  if (c >= 95) return 'Certain'
  if (c >= 85) return 'Very sure'
  if (c >= 70) return 'Fairly sure'
  if (c >= 60) return 'Leaning'
  return 'A guess'
}

export const clampConf = (c) => Math.max(CONF_MIN, Math.min(CONF_MAX, Math.round(Number(c) / 5) * 5 || CONF_DEFAULT))

// Seconds left on a soft timer; null when there is none.
export const secondsLeft = (until, now = Date.now()) => (until ? Math.max(0, Math.ceil((until - now) / 1000)) : null)

export const optionLabel = (call, id) => call?.options?.find((o) => o.id === id)?.label ?? id ?? '—'

// 'You beat The Engineer' lines for the end card; ties are not beats.
export function beatLines(totals) {
  const me = totals.find((t) => t.isMe)
  if (!me) return []
  return totals.filter((t) => t.isBot).map((b) => ({ title: b.name, beat: me.points > b.points, tie: me.points === b.points, diff: me.points - b.points }))
}

export const rankOf = (totals) => {
  const i = totals.findIndex((t) => t.isMe)
  return i < 0 ? null : i + 1
}

export const fmtPts = (v) => (v == null ? '—' : `${Math.round(v)}`)
export const signed = (v) => (v == null ? '' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`)
