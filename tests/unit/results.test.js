// The results shown to a team once the final results are published. Pure logic, with made-up teams and a made-up game.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildResults, summariseResults, placeOf } = require('../../api/lib/results.js');

const game = {
  'zone 1': {
    'zone-name': 'Alpha',
    questions: [
      { Q1: 'first?', type: 'string', answer: ['red', 'crimson'], score: 10 },
      { Q2: 'number?', type: 'whole-number', answer: '42', score: 20 },
      { Q3: 'photo one', type: 'photo', score: 30 },
    ],
  },
  'zone 2': { 'zone-name': 'Bravo', questions: [{ Q1: 'second?', type: 'string', answer: 'blue', score: 5 }, { Q2: 'photo two', type: 'photo', score: 25 }] },
};
const team = (number, score, subs = {}, photos = {}) => ({ playerId: `p${number}`, number, name: `Team ${number}`, score, subs, photos });

test('places: one more than the number of teams that scored higher, so ties share a place', () => {
  const teams = [team(1, 50), team(2, 50), team(3, 40), team(4, 10), team(5, 0)];
  assert.deepEqual(teams.map((t) => placeOf(t, teams)), [1, 1, 3, 4, 5]);
  assert.equal(placeOf(team(1, 0.1 + 0.2), [team(1, 0.3)]), 1); // floating point noise does not separate equal scores
  const alone = [team(1, 0)];
  assert.equal(placeOf(alone[0], alone), 1);
});

test('the breakdown covers every question, answered or not, with the official answers', () => {
  const me = team(1, 10, { 'zone 1#Q1': { answerGiven: 'RED', correct: true, points: 10 } });
  const { zones } = buildResults({ team: me, teams: [me], game });
  assert.deepEqual(zones.map((z) => [z.key, z.name, z.questions.length]), [['zone 1', 'Alpha', 2], ['zone 2', 'Bravo', 1]]);
  assert.deepEqual(zones[0].questions[0], {
    id: 'Q1', text: 'first?', type: 'string', points: 10, answered: true, yourAnswer: 'RED', correct: true, earned: 10, officialAnswers: ['red', 'crimson'],
  });
  assert.deepEqual(zones[0].questions[1], {
    id: 'Q2', text: 'number?', type: 'whole-number', points: 20, answered: false, yourAnswer: null, correct: null, earned: 0, officialAnswers: ['42'],
  });
  assert.deepEqual(zones[1].questions[0].officialAnswers, ['blue']); // a single answer is still a list
});

test('a wrong answer is shown as wrong with 0 points earned', () => {
  const me = team(1, 0, { 'zone 2#Q1': { answerGiven: 'green', correct: false, points: 0 } });
  const [, zone2] = buildResults({ team: me, teams: [me], game }).zones;
  assert.deepEqual([zone2.questions[0].answered, zone2.questions[0].correct, zone2.questions[0].earned, zone2.questions[0].yourAnswer], [true, false, 0, 'green']);
});

test('a photo is not submitted, submitted but not scored, or scored full, half or zero', () => {
  const photos = {
    'zone 1#Q3': { sentAt: 1, decision: 'half', points: 15, appliedAt: 2 },
    'zone 2#Q2': { sentAt: 1 }, // sent, never scored
  };
  const [one, two] = buildResults({ team: team(1, 15, {}, photos), teams: [], game }).zones.map((z) => z.photos[0]);
  assert.deepEqual(one, { id: 'Q3', challenge: 'photo one', points: 30, submitted: true, scored: true, decision: 'half', percent: 50, earned: 15 });
  assert.deepEqual(two, { id: 'Q2', challenge: 'photo two', points: 25, submitted: true, scored: false, decision: null, percent: 0, earned: 0 });

  const none = buildResults({ team: team(1, 0), teams: [], game }).zones[0].photos[0];
  assert.deepEqual(none, { id: 'Q3', challenge: 'photo one', points: 30, submitted: false, scored: false, decision: null, percent: null, earned: 0 });
  const full = buildResults({ team: team(1, 30, {}, { 'zone 1#Q3': { sentAt: 1, decision: 'full', points: 30 } }), teams: [], game }).zones[0].photos[0];
  const zero = buildResults({ team: team(1, 0, {}, { 'zone 1#Q3': { sentAt: 1, decision: 'zero', points: 0 } }), teams: [], game }).zones[0].photos[0];
  assert.deepEqual([full.percent, zero.percent, zero.scored], [100, 0, true]); // a scored zero is different from not scored
});

test('place, number of teams and total come with the breakdown', () => {
  const me = team(2, 30);
  const teams = [team(1, 50), me, team(3, 30), team(4, 5)];
  const results = buildResults({ team: me, teams, game });
  assert.deepEqual([results.place, results.teamCount, results.total], [2, 4, 30]);
});

test('it does not change what it is given', () => {
  const me = team(1, 10, { 'zone 1#Q1': { answerGiven: 'x', correct: false, points: 0 } });
  const snapshot = JSON.stringify([me, game]);
  const results = buildResults({ team: me, teams: [me], game });
  results.zones[0].questions[0].officialAnswers.push('hack'); // editing the result must not edit the game
  assert.equal(JSON.stringify([me, game]), snapshot);
});

test('the summary is the same results without any answer: the same places, points and outcomes, and never what was typed or the official answers', () => {
  const me = team(2, 30, { 'zone 1#Q1': { answerGiven: 'purple', correct: false, points: 0 }, 'zone 1#Q2': { answerGiven: '42', correct: true, points: 20 } }, { 'zone 1#Q3': { sentAt: 1, decision: 'half', points: 15 } });
  const full = buildResults({ team: me, teams: [team(1, 50), me], game });
  const summary = summariseResults(full);
  assert.deepEqual([summary.place, summary.teamCount, summary.total], [full.place, full.teamCount, full.total]);
  assert.deepEqual(summary.zones[0].photos, full.zones[0].photos);
  const [q1, q2] = summary.zones[0].questions;
  assert.deepEqual([q1.id, q1.points, q1.answered, q1.correct, q1.earned], ['Q1', 10, true, false, 0]);
  assert.deepEqual([q2.id, q2.points, q2.answered, q2.correct, q2.earned], ['Q2', 20, true, true, 20]);
  assert.ok(!/purple|crimson|"42"|yourAnswer|officialAnswers/.test(JSON.stringify(summary)));
  assert.ok(full.zones[0].questions[0].officialAnswers.includes('crimson')); // and the full results are untouched
});
