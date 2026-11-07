// Scoring for "Beat the model": a proper scoring rule, no SpacetimeDB imports so engine/tests/test_beat.py can run
// this file with node against its own Python reference.
//
// A call has n options. A player picks one with a confidence c in [0.5, 1]; the pick gets probability c and the other
// options share 1 - c equally. The score is the Brier score relative to a uniform guess, scaled to 100:
//   score = 100 * (1 - B / B_uniform),   B = sum_i (p_i - y_i)^2,   B_uniform = (n - 1) / n
// so 100 is a certain, correct call, 0 is no better than guessing, and a confident wrong call is negative (a certain
// miss on a two-way call scores -300). There is deliberately no floor: Brier is a strictly proper scoring rule, so
// your expected score is highest when your confidence is your honest probability, and clipping the loss would make
// overconfidence pay. No answer scores 0.

export const MIN_CONFIDENCE = 50;
export const MAX_CONFIDENCE = 100;

export function brier(n: number, confidence: number, correct: boolean): number {
  const c = Math.min(1, Math.max(0, confidence));
  const q = n > 1 ? (1 - c) / (n - 1) : 0;
  if (correct) return (1 - c) ** 2 + (n - 1) * q ** 2;
  return c ** 2 + (1 - q) ** 2 + (n - 2) * q ** 2;
}

export function callScore(n: number, confidencePct: number, correct: boolean): number {
  if (n < 2) return 0;
  const b = brier(n, confidencePct / 100, correct);
  const raw = 100 * (1 - b / ((n - 1) / n));
  return Math.round(raw * 10) / 10;
}
