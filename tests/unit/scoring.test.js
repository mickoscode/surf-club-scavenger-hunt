// Scoring must never let a team gain points by applying a decision twice, and totals must display sensibly.
const test = require('node:test');
const assert = require('node:assert/strict');
const { photoPoints, decisionDelta, questionPoints, formatScore, roundScore } = require('../../api/lib/scoring.js');

test('photo decisions are worth full, half or nothing, without rounding', () => {
  assert.equal(photoPoints(30, 'full'), 30);
  assert.equal(photoPoints(30, 'half'), 15);
  assert.equal(photoPoints(25, 'half'), 12.5);
  assert.equal(photoPoints(30, 'zero'), 0);
  assert.throws(() => photoPoints(30, 'constructor'));
  assert.throws(() => photoPoints(30, 'maybe'));
});

test('a question is worth its score only when correct', () => {
  assert.equal(questionPoints({ score: 20 }, true), 20);
  assert.equal(questionPoints({ score: 20 }, false), 0);
});

test('applying decisions in any order always leaves the total at the value of the last decision', () => {
  const decisions = ['full', 'half', 'zero'];
  let seed = 12345; // fixed seed: a failure reproduces
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  for (const photoScore of [30, 25, 7.5]) {
    for (let run = 0; run < 50; run++) {
      let total = 100; // points already earned elsewhere
      let previous = null;
      const length = 1 + (next() % 8);
      for (let i = 0; i < length; i++) {
        const decision = decisions[next() % 3]; // includes the same decision repeated
        total = roundScore(total + decisionDelta(photoScore, previous, decision));
        previous = decision;
      }
      assert.equal(total, roundScore(100 + photoPoints(photoScore, previous)));
    }
  }
});

test('re-applying the same decision changes nothing', () => {
  assert.equal(decisionDelta(30, 'full', 'full'), 0);
  assert.equal(decisionDelta(30, null, 'zero'), 0);
  assert.equal(decisionDelta(30, null, 'full'), 30);
  assert.equal(decisionDelta(30, 'full', 'half'), -15);
});

test('scores show as whole numbers, or with 1 decimal place when needed', () => {
  assert.equal(formatScore(12), '12');
  assert.equal(formatScore(12.5), '12.5');
  assert.equal(formatScore(0.1 + 0.2), '0.3'); // floating point noise is removed
  assert.equal(formatScore(0), '0');
});
