'use strict';
// Points and totals. Pure functions. The database layer stores each team's running total and applies the
// DELTAS computed here, so re-applying a photo decision can never count twice.

const FRACTION = { full: 1, half: 0.5, zero: 0 };

// Removes floating point noise (0.1 + 0.2) without rounding real values: 12.5 stays 12.5.
const roundScore = (n) => Math.round(n * 100) / 100;

// Whole numbers as they are, anything else with 1 decimal place (docs/requirements.md, "Scoreboard").
function formatScore(n) {
  const r = roundScore(n);
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

const isDecision = (d) => typeof d === 'string' && Object.hasOwn(FRACTION, d);

function photoPoints(photoScore, decision) {
  if (!isDecision(decision)) throw new Error(`unknown decision: ${decision}`);
  return roundScore(photoScore * FRACTION[decision]);
}

// Change to a team's total when the admin applies `next` to a photo that previously had `previous` (or none).
// The previous decision is deducted, then the new one added.
function decisionDelta(photoScore, previous, next) {
  const before = previous == null ? 0 : photoPoints(photoScore, previous);
  return roundScore(photoPoints(photoScore, next) - before);
}

const questionPoints = (question, correct) => (correct ? question.score : 0);

module.exports = { roundScore, formatScore, isDecision, photoPoints, decisionDelta, questionPoints };
