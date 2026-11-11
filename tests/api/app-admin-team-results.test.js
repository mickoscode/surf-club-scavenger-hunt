// The admin's view of one team's results: the same breakdown the team gets when the results are published, but available at any
// time. Fixture game only (see helpers.js): zone 1 Alpha has Q1 text 10 (secret one / alt one), Q2 number 20 (42), Q3 decimal 5 (2.5),
// photo challenge Q4 30; zone 2 Bravo has Q1 text 10 (secret two) and photo Q2 25.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, configure, answer, START, END } = require('./helpers.js');

const adminResults = (env, number) => env.admin().get(`/api/admin/teams/${number}/results`);

async function twoTeams() {
  const env = setup();
  await configure(env);
  const [a, b] = [env.player(), env.player()];
  await a.post('/api/join', { name: 'Alpha' });
  await b.post('/api/join', { name: 'Bravo' });
  await answer(a, 'zone 1', 'Q1', 'alt one'); // right
  await answer(a, 'zone 1', 'Q2', '41'); // wrong
  await a.post('/api/photo', { zone: 'zone 1', question: 'Q4' });
  await answer(b, 'zone 1', 'Q2', '42');
  return { env, a, b };
}

test('during the game the admin sees what a team has submitted, with the official answers, before anything is published', async () => {
  const { env, a } = await twoTeams();
  const res = await adminResults(env, 1);
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.team, res.body.published], [{ number: 1, name: 'Alpha', score: 10 }, false]);
  const [q1, q2, q3] = res.body.results.zones[0].questions;
  assert.deepEqual([q1.yourAnswer, q1.correct, q1.officialAnswers], ['alt one', true, ['secret one', 'alt one']]);
  assert.deepEqual([q2.yourAnswer, q2.correct], ['41', false]);
  assert.deepEqual([q3.answered, q3.yourAnswer], [false, null]);
  assert.deepEqual([res.body.results.zones[0].photos[0].submitted, res.body.results.zones[0].photos[0].scored], [true, false]);
  assert.deepEqual([res.body.results.place, res.body.results.teamCount], [2, 2]); // Bravo has 20, Alpha 10
  // while the team itself is told nothing yet
  assert.deepEqual((await a.get('/api/results')).body, { published: false, team: { number: 1, name: 'Alpha' } });
});

test('it is exactly what the team gets once the results are published', async () => {
  const { env, a, b } = await twoTeams();
  const before = (await adminResults(env, 1)).body.results;
  env.clock.now = END + 1;
  assert.equal((await env.admin().post('/api/admin/results/publish', { confirm: true })).status, 200);
  for (const [number, player] of [[1, a], [2, b]]) {
    assert.deepEqual((await adminResults(env, number)).body.results, (await player.get('/api/results')).body.results, `team ${number}`);
  }
  assert.equal((await adminResults(env, 1)).body.published, true);
  assert.deepEqual(before, (await adminResults(env, 1)).body.results); // nothing changed by publishing
});

test('an unknown team is 400 (never 404, which CloudFront would replace), and other roles cannot reach the route', async () => {
  const { env } = await twoTeams();
  for (const number of ['9', 'x', '0', '1.5']) {
    const res = await adminResults(env, number);
    assert.deepEqual([res.status, res.body.error], [400, 'no-team'], number);
  }
  assert.equal((await env.player().get('/api/admin/teams/1/results')).status, 404); // not a route of the public function
});

test('a team that was removed is gone from it, and with team names off the team is Team <number>', async () => {
  const env = setup();
  await configure(env, { teamNames: false });
  await env.player().post('/api/join', {});
  assert.equal((await adminResults(env, 1)).body.team.name, 'Team 1');
  await env.admin().del('/api/admin/teams/1');
  assert.equal((await adminResults(env, 1)).body.error, 'no-team');
});
