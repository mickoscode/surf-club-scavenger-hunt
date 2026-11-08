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

test('places are written as 1st, 2nd, 3rd, 4th, including the teens and the twenties', async () => {
  const { ordinal, placeHeading } = await load('results-format.js');
  const cases = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 10: '10th', 11: '11th', 12: '12th', 13: '13th', 21: '21st', 22: '22nd', 23: '23rd', 101: '101st', 111: '111th', 112: '112th' };
  for (const [n, expected] of Object.entries(cases)) assert.equal(ordinal(Number(n)), expected, n);
  assert.equal(placeHeading(3, 12), 'You finished 3rd of 12');
});

test('1st, 2nd and 3rd get a gold, silver or bronze medal and nobody else does', async () => {
  const { medalFor } = await load('results-format.js');
  assert.deepEqual([1, 2, 3].map((p) => medalFor(p).symbol), ['🥇', '🥈', '🥉']);
  assert.deepEqual([1, 2, 3].map((p) => medalFor(p).label), ['Gold medal', 'Silver medal', 'Bronze medal']);
  assert.equal(medalFor(4), null);
  assert.equal(medalFor(0), null);
});

test('results wording: accepted answers, question outcome and the photo states', async () => {
  const { joinAnswers, outcomeOf, describePhoto } = await load('results-format.js');
  assert.equal(joinAnswers(['bike', 'bicycle']), 'bike or bicycle');
  assert.equal(joinAnswers(['paris']), 'paris');
  assert.equal(outcomeOf({ answered: false, correct: null }), 'unanswered');
  assert.equal(outcomeOf({ answered: true, correct: true }), 'correct');
  assert.equal(outcomeOf({ answered: true, correct: false }), 'wrong');

  const photo = (over) => ({ points: 30, submitted: true, scored: true, decision: 'half', percent: 50, earned: 15, ...over });
  assert.deepEqual(describePhoto(photo({})), { state: 'scored', text: 'Half: 50% - 15 of 30 points' });
  assert.equal(describePhoto(photo({ decision: 'full', percent: 100, earned: 30 })).text, 'Full: 100% - 30 of 30 points');
  assert.equal(describePhoto(photo({ decision: 'zero', percent: 0, earned: 0 })).text, 'Zero: 0% - 0 of 30 points');
  assert.equal(describePhoto(photo({ points: 25, decision: 'half', earned: 12.5 })).text, 'Half: 50% - 12.5 of 25 points'); // halves are not rounded
  assert.deepEqual(describePhoto(photo({ scored: false, decision: null, percent: 0, earned: 0 })), { state: 'not-scored', text: 'Photo sent, but not scored: 0% - 0 of 30 points' });
  assert.deepEqual(describePhoto(photo({ submitted: false, scored: false, decision: null, percent: null, earned: 0 })), { state: 'not-submitted', text: 'No photo submitted' });
});

test('every mention of WhatsApp, in any capitalisation, is found in a text', async () => {
  const { splitOnWhatsApp } = await load('whatsapp.js');
  assert.deepEqual(splitOnWhatsApp('upload to WhatsApp or whatsapp.'), [
    { text: 'upload to ', link: false }, { text: 'WhatsApp', link: true }, { text: ' or ', link: false }, { text: 'whatsapp', link: true }, { text: '.', link: false },
  ]);
  assert.deepEqual(splitOnWhatsApp('WhatsApp'), [{ text: 'WhatsApp', link: true }]);
  assert.deepEqual(splitOnWhatsApp('no mention here'), [{ text: 'no mention here', link: false }]);
  assert.deepEqual(splitOnWhatsApp(''), []);
});

test('pages only ever link to a WhatsApp group invite, whatever the server says', async () => {
  const { safeWhatsAppUrl } = await load('whatsapp.js');
  const good = 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv';
  assert.equal(safeWhatsAppUrl(good), good);
  for (const bad of [null, undefined, '', 42, 'javascript:alert(1)', 'https://example.org/', 'http://chat.whatsapp.com/AbCdEfGhIjKl', 'https://chat.whatsapp.com.evil.example/x', `${good} extra`, 'data:text/html,x']) {
    assert.equal(safeWhatsAppUrl(bad), null, String(bad));
  }
});
