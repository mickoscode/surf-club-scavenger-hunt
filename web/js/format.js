// Scores show as whole numbers, or with 1 decimal place when a total needs it (12.5). Mirrors formatScore() in
// api/lib/scoring.js; tests/unit/frontend.test.js checks the two agree.
export function formatScore(n) {
  const rounded = Math.round(n * 100) / 100; // removes floating point noise (0.1 + 0.2)
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
