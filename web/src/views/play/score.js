// Per-call scoring, a copy of spacetime/module/src/beat_math.ts (the module is the source of truth; engine/tests and
// the web test compare the two). Brier score against a uniform guess, scaled to 100: a certain right call is 100, a
// guess is 0, a confident miss is negative (a certain miss on a two-way call is -300). No answer scores 0.
export function brier(n, confidence, correct) {
  const c = Math.min(1, Math.max(0, confidence))
  const q = n > 1 ? (1 - c) / (n - 1) : 0
  if (correct) return (1 - c) ** 2 + (n - 1) * q ** 2
  return c ** 2 + (1 - q) ** 2 + (n - 2) * q ** 2
}

export function callScore(n, confidencePct, correct) {
  if (n < 2) return 0
  const b = brier(n, confidencePct / 100, correct)
  const raw = 100 * (1 - b / ((n - 1) / n))
  return Math.round(raw * 10) / 10
}

// What the slider shows: the score if the pick is right and if it is wrong, at this confidence.
export const outcomes = (n, confidencePct) => ({ right: callScore(n, confidencePct, true), wrong: callScore(n, confidencePct, false) })
