// Ease-out count from `from` to `to` after `elapsed` ms of `ms`. The first animation frame's timestamp can come
// slightly before the start time; unclamped, that negative elapsed time pushes the cubic ease past `from` (a cost
// counting up from zero briefly shows below zero), so progress is clamped to [0, 1].
export function countUpValue(from, to, elapsed, ms) {
  const t = ms > 0 ? Math.min(1, Math.max(0, elapsed / ms)) : 1
  if (t >= 1) return to
  return from + (to - from) * (1 - Math.pow(1 - t, 3))
}
