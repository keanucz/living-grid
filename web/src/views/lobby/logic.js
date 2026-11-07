// Pure helpers for the lobby view (no React), so they can be checked on their own.
export const CODE_RE = /^[A-Z]{4}$/
export const COUNTDOWN_S = 5 // default; a lobby may carry its own (quick play uses 30 s)

export const normaliseCode = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)

// '#/play/ABCD?x=1' -> 'ABCD'; '#/play' -> ''. Anything that is not four letters is ignored.
export function routeCode(hash) {
  const m = String(hash ?? '').replace(/^#/, '').split('?')[0].match(/^\/play\/([^/]+)/)
  const code = normaliseCode(m?.[1])
  return CODE_RE.test(code) ? code : ''
}

export const playLink = (code, loc = location) => `${loc.origin}${loc.pathname}#/play/${code}`
export const screenLink = (code, loc = location) => `${loc.origin}${loc.pathname}#/screen/${code}`

// Whole seconds left on the 5 s countdown. The server stamps countdown_end; if this device's clock is far off
// (end more than a countdown away, or already long past) fall back to counting from when it first saw the state.
export function countdownLeft(endMs, nowMs, seenAtMs, total = COUNTDOWN_S) {
  const fromServer = (endMs - nowMs) / 1000
  const left = fromServer > total + 1 || fromServer < -2 ? total - (nowMs - seenAtMs) / 1000 : fromServer
  return Math.max(0, Math.ceil(left))
}

// The lobby this device is in: as a player, or as host before the host's own player row has arrived.
export function myLobby(s) {
  if (!s?.me) return null
  const member = s.lobbyPlayers?.find((p) => p.id === s.me)
  return s.lobbies?.find((l) => l.id === member?.lobbyId) ?? s.lobbies?.find((l) => l.host === s.me) ?? null
}

export function members(s, lobby) {
  return (s.lobbyPlayers ?? []).filter((p) => p.lobbyId === lobby.id).sort((a, b) => (a.id === lobby.host ? -1 : b.id === lobby.host ? 1 : a.name.localeCompare(b.name)))
}

export const SPEEDS = [
  { value: 20, label: 'Quick', note: '20 s per game hour' },
  { value: 30, label: 'Standard', note: '30 s per game hour' },
  { value: 45, label: 'Relaxed', note: '45 s per game hour' },
]
export const QUESTION_COUNTS = [4, 6, 8]
export const DEFAULT_SETTINGS = { mode: 'market', secondsPerHour: 30, nQuestions: 6, botsOn: true }

export function roundLength(secondsPerHour, hours = 7) {
  const s = secondsPerHour * hours
  return s >= 90 ? `about ${Math.round(s / 60)} min` : `${s} s`
}

// Which screen plays each game mode. The lobby decides by lobby.mode, so a new mode is one entry here.
export const hasMode = (modes, mode) => Object.prototype.hasOwnProperty.call(modes, mode)
