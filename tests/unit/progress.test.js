// How many questions and photo challenges a game has and how many a team has attempted. Hand-checkable fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const { countQuestions, countDone } = require('../../api/lib/progress.js');

const game = {
  'zone 1': { questions: [{ Q1: 'a', type: 'string' }, { Q2: 'photo', type: 'photo' }, { Q3: 'photo', type: 'photo' }] },
  'zone 2': { questions: [{ Q1: 'b', type: 'decimal' }] },
  'zone 3': { questions: [] },
};

test('every question and photo challenge of every zone is counted', () => {
  assert.equal(countQuestions(game), 4);
  assert.equal(countQuestions({}), 0);
  assert.equal(countQuestions(null), 0);
});

test('a team has done a question once answered (right or wrong) and a photo challenge once sent', () => {
  const team = { subs: { 'zone 1#Q1': {}, 'zone 2#Q1': {} }, photos: { 'zone 1#Q3': { sentAt: 1 } } };
  assert.equal(countDone(team, game), 3);
  assert.equal(countDone({ subs: {}, photos: {} }, game), 0);
});

test('something done for a question that is no longer in the game does not count, nor does a photo under the wrong kind', () => {
  const team = { subs: { 'zone 1#Q9': {}, 'zone 1#Q2': {} }, photos: { 'zone 1#Q1': { sentAt: 1 }, 'zone 7#Q1': { sentAt: 1 } } };
  assert.equal(countDone(team, game), 0);
});
