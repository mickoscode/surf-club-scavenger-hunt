// Answer checking decides who scores, so these tests cover each question type, the typo limits and the numeric
// rules. They use made-up questions, never the real game file.
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkAnswer, typosAllowed } = require('../../api/lib/answers.js');

const text = (answer) => ({ type: 'string', answer });
const whole = (answer) => ({ type: 'whole-number', answer });
const decimal = (answer) => ({ type: 'decimal', answer });
const correct = (q, given) => checkAnswer(q, given).correct;

test('string answers ignore case, surrounding spaces and repeated spaces', () => {
  assert.equal(correct(text('red and yellow'), '  RED   and Yellow '), true);
  assert.equal(correct(text('paris'), 'london'), false);
});

test('typo allowance depends on the official answer length', () => {
  assert.deepEqual([3, 4, 7, 8, 20].map((n) => typosAllowed('x'.repeat(n))), [0, 1, 1, 2, 2]);
  assert.equal(correct(text('pup'), 'pap'), false); // short: exact only
  assert.equal(correct(text('pup'), 'pup'), true);
  assert.equal(correct(text('paris'), 'pariss'), true); // one extra letter
  assert.equal(correct(text('paris'), 'parus'), true); // one changed letter
  assert.equal(correct(text('paris'), 'pris'), true); // one missing letter
  assert.equal(correct(text('paris'), 'pairs'), true); // two neighbouring letters swapped
  assert.equal(correct(text('paris'), 'prss'), false); // two mistakes on a 5 letter answer
  assert.equal(correct(text('breakwater'), 'brekwatr'), true); // two mistakes on a 10 letter answer
  assert.equal(correct(text('breakwater'), 'brkwatr'), false); // three
});

test('any of the accepted answers will do, each with its own typo allowance', () => {
  const q = text(['bike', 'bicycle']);
  assert.equal(correct(q, 'bike'), true);
  assert.equal(correct(q, 'bicicle'), true); // one typo in the second alternative
  assert.equal(correct(q, 'car'), false);
});

test('whole numbers must match exactly and only accept digits', () => {
  assert.equal(correct(whole('42'), '42'), true);
  assert.equal(correct(whole('42'), ' 042 '), true); // same value
  assert.equal(correct(whole('42'), '43'), false);
  for (const bad of ['4 2', '4.2', '-42', 'forty two', '', '   ']) {
    assert.deepEqual(checkAnswer(whole('42'), bad), { valid: false, correct: false }, JSON.stringify(bad));
  }
});

test('decimals must match exactly as a number', () => {
  assert.equal(correct(decimal('2.5'), '2.5'), true);
  assert.equal(correct(decimal('2.5'), '2.50'), true);
  assert.equal(correct(decimal('2.5'), '02.5'), true);
  assert.equal(correct(decimal('2.5'), '2.51'), false);
  assert.equal(correct(decimal('0.5'), '.5'), true);
  assert.equal(correct(decimal('25'), '25.0'), true);
  for (const bad of ['2..5', '2.5.1', '-2.5', '2,5', '.', 'abc']) {
    assert.equal(checkAnswer(decimal('2.5'), bad).valid, false, bad);
  }
});

test('empty, oversized and non-text input is invalid, so it does not use up the one submission', () => {
  assert.equal(checkAnswer(text('paris'), '   ').valid, false);
  assert.equal(checkAnswer(text('paris'), 'x'.repeat(201)).valid, false);
  assert.equal(checkAnswer(text('paris'), 42).valid, false);
  assert.equal(checkAnswer(text('paris'), null).valid, false);
});

test('the result never includes the official answer', () => {
  const result = checkAnswer(text('secret'), 'wrong');
  assert.deepEqual(Object.keys(result).sort(), ['correct', 'valid']);
});
