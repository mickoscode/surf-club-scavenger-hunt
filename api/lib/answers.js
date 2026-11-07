'use strict';
// Checking a submitted answer against the official one. Rules: docs/requirements.md, "Answer rules".
// Pure functions. The result never contains the official answer.

const MAX_ANSWER_LENGTH = 200;

const normaliseText = (s) => String(s).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

// Typos allowed, by the length of the official answer: none under 4 characters, 1 for 4-7, 2 for 8 or more.
function typosAllowed(officialAnswer) {
  const length = [...officialAnswer].length;
  if (length < 4) return 0;
  return length < 8 ? 1 : 2;
}

// Edit distance where one added, missing or changed letter, or two neighbouring letters swapped, counts as 1.
function typoDistance(a, b) {
  const x = [...a];
  const y = [...b];
  const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
  for (let j = 0; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[x.length][y.length];
}

// Canonical form of a number, so "042", "42" and "42." are the same value (no floating point involved).
function canonicalWhole(s) {
  const t = String(s).trim();
  return /^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, '') : null;
}
function canonicalDecimal(s) {
  const t = String(s).trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const [whole, fraction = ''] = t.split('.');
  const w = whole.replace(/^0+(?=\d)/, '') || '0';
  const f = fraction.replace(/0+$/, '');
  return f ? `${w}.${f}` : w;
}

// -> { valid, correct }. valid=false means the input is not an acceptable answer for this question type (empty,
// too long, or not a number): the caller rejects it without using up the player's one submission.
function checkAnswer(question, submitted) {
  const invalid = { valid: false, correct: false };
  if (typeof submitted !== 'string' || submitted.length > MAX_ANSWER_LENGTH) return invalid;

  if (question.type === 'whole-number') {
    const given = canonicalWhole(submitted);
    return given === null ? invalid : { valid: true, correct: given === canonicalWhole(question.answer) };
  }
  if (question.type === 'decimal') {
    const given = canonicalDecimal(submitted);
    return given === null ? invalid : { valid: true, correct: given === canonicalDecimal(question.answer) };
  }
  if (question.type === 'string') {
    const given = normaliseText(submitted);
    if (given === '') return invalid;
    const accepted = Array.isArray(question.answer) ? question.answer : [question.answer];
    const correct = accepted.some((a) => {
      const official = normaliseText(a);
      return typoDistance(given, official) <= typosAllowed(official);
    });
    return { valid: true, correct };
  }
  throw new Error(`unknown question type: ${question.type}`);
}

module.exports = { MAX_ANSWER_LENGTH, normaliseText, typosAllowed, typoDistance, checkAnswer };
