// The page code the browser runs (web/js) is plain ES modules, so its logic can be tested in Node. These tests
// pin the parts that must agree with the server, and the countdown wording rules, without touching any page text.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { gameStatus } = require('../../api/lib/gamestate.js');
const { formatScore: serverFormatScore } = require('../../api/lib/scoring.js');

const load = (file) => import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', file)).href);

const CONFIG = { name: 'T', timeZone: 'Australia/Perth', day: '2026-11-14', start: '10:00', end: '12:00' };
const START = Date.UTC(2026, 10, 14, 2, 0);
const END = Date.UTC(2026, 10, 14, 4, 0);

test('the page works out the same phase as the server at every boundary', async () => {
  const { phaseOf } = await load('time.js');
  const game = { status: 'whatever', startMs: START, endMs: END };
  for (const now of [START - 86_400_000, START - 1, START, START + 1, END - 1, END, END + 1, END + 86_400_000]) {
    assert.equal(phaseOf(game, now), gameStatus(CONFIG, now), `now=${now - START}`);
  }
  assert.equal(phaseOf({ status: 'unconfigured' }, START), 'unconfigured');
  assert.equal(phaseOf(null, START), 'unconfigured');
});

test('the countdown runs to the start before the game, the end during it, and nowhere after', async () => {
  const { countdownTarget } = await load('time.js');
  const game = { startMs: START, endMs: END };
  assert.equal(countdownTarget(game, 'pre'), START);
  assert.equal(countdownTarget(game, 'active'), END);
  assert.equal(countdownTarget(game, 'post'), null);
  assert.equal(countdownTarget(game, 'unconfigured'), null);
});

test('the countdown shows minutes, then minutes and seconds for the last 5 minutes', async () => {
  const { formatCountdown, secondsUntil } = await load('time.js');
  assert.equal(formatCountdown(42 * 60), '42 min');
  assert.equal(formatCountdown(42 * 60 - 10), '42 min'); // never shows 0 min before it is over
  assert.equal(formatCountdown(301), '6 min');
  assert.equal(formatCountdown(300), '5:00');
  assert.equal(formatCountdown(299), '4:59');
  assert.equal(formatCountdown(61), '1:01');
  assert.equal(formatCountdown(0), '0:00');
  assert.equal(secondsUntil(10_000, 9_001), 1); // part of a second counts as a second
  assert.equal(secondsUntil(10_000, 20_000), 0); // never negative
});

test('scores are formatted exactly as the server formats them', async () => {
  const { formatScore } = await load('format.js');
  for (const n of [0, 1, 12, 12.5, 0.1 + 0.2, 7.25, 100, 99.99, 2.675]) {
    assert.equal(formatScore(n), serverFormatScore(n), String(n));
  }
});

test('number fields keep only digits, and decimal fields one decimal point', async () => {
  const { sanitizeAnswer } = await load('answer-input.js');
  assert.equal(sanitizeAnswer('whole-number', '4a-2.x'), '42');
  assert.equal(sanitizeAnswer('whole-number', ''), '');
  assert.equal(sanitizeAnswer('decimal', '2.5.1x'), '2.51');
  assert.equal(sanitizeAnswer('decimal', '.5'), '.5');
  assert.equal(sanitizeAnswer('decimal', '-3,5'), '35');
  assert.equal(sanitizeAnswer('string', 'Any text: 1.2!'), 'Any text: 1.2!'); // text questions are not touched
});
