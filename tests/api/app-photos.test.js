// A zone may have no photo challenge, one, or several: a photo challenge is a question of type "photo". Each is sent once and
// scored on its own. Fixture game only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, configure, scoreOf, START, END } = require('./helpers.js');

const GAME = {
  'zone 1': {
    'zone-name': 'Many', 'zone-map': 'a.png',
    questions: [
      { Q1: 'q?', type: 'string', answer: 'a', score: 5 },
      { Q2: 'first photo', type: 'photo', score: 30 },
      { Q3: 'second photo', type: 'photo', score: 10 },
    ],
  },
  'zone 2': { 'zone-name': 'None', 'zone-map': 'b.png', questions: [{ Q1: 'q?', type: 'string', answer: 'a', score: 5 }] },
};

async function game() {
  const env = setup({ now: START + 60_000, game: GAME });
  await configure(env);
  const p = env.player();
  await p.post('/api/join', { name: 'Sea Dogs' });
  return { env, p, admin: env.admin() };
}
const send = (p, zone, question) => p.post('/api/photo', { zone, question });
const apply = (admin, question, decision, zone = 'zone 1') => admin.post('/api/admin/photos/apply', { teamNumber: 1, zone, question, decision });

test('the game lists photo challenges among the questions, with their type, and never an answer', async () => {
  const { env } = await game();
  const { zones } = (await env.player().get('/api/game')).body;
  assert.deepEqual(zones[0].questions.map((q) => [q.id, q.type, q.score]), [['Q1', 'string', 5], ['Q2', 'photo', 30], ['Q3', 'photo', 10]]);
  assert.equal(zones[1].questions.some((q) => q.type === 'photo'), false);
  assert.doesNotMatch(JSON.stringify(zones), /"answer"/);
});

test('each photo challenge is sent once, separately from the others in its zone', async () => {
  const { p } = await game();
  assert.equal((await send(p, 'zone 1', 'Q2')).status, 200);
  assert.equal((await send(p, 'zone 1', 'Q2')).status, 409);
  assert.equal((await send(p, 'zone 1', 'Q3')).status, 200);
  assert.deepEqual((await p.get('/api/me')).body.done.photos.sort(), ['zone 1#Q2', 'zone 1#Q3']);
});

test('only a photo challenge can be sent as a photo, and a photo challenge cannot be answered with text', async () => {
  const { p } = await game();
  for (const [zone, question] of [['zone 1', 'Q1'], ['zone 1', 'Q9'], ['zone 1', undefined], ['zone 2', 'Q2'], ['zone 1', '__proto__']]) {
    const res = await send(p, zone, question);
    assert.deepEqual([res.status, res.body.error], [400, 'unknown-question'], `${zone} ${question}`);
  }
  assert.equal((await send(p, 'zone 9', 'Q2')).body.error, 'unknown-zone');
  const typed = await p.post('/api/answer', { zone: 'zone 1', question: 'Q2', answer: 'a photo' });
  assert.deepEqual([typed.status, typed.body.error], [400, 'unknown-question']);
});

test('the admin scores each photo challenge on its own, with its own points, and re-applying replaces', async () => {
  const { env, p, admin } = await game();
  await send(p, 'zone 1', 'Q2');
  env.clock.now += 1000;
  await send(p, 'zone 1', 'Q3');
  const listed = (await admin.get('/api/admin/photos')).body.photos;
  assert.deepEqual(listed.map((r) => [r.zone, r.question, r.challenge, r.photoScore]), [['zone 1', 'Q2', 'first photo', 30], ['zone 1', 'Q3', 'second photo', 10]]);

  assert.equal((await apply(admin, 'Q2', 'full')).body.score, 30);
  assert.equal((await apply(admin, 'Q3', 'half')).body.score, 35); // 30 + half of 10
  assert.equal((await apply(admin, 'Q2', 'half')).body.score, 20); // replaced: 15 + 5, never added to
  assert.equal(await scoreOf(env, 'Sea Dogs'), 20);
  assert.equal((await apply(admin, 'Q1', 'full')).body.error, 'unknown-question'); // not a photo challenge
  assert.equal((await apply(admin, 'Q2', 'full', 'zone 2')).body.error, 'unknown-question');
});

test('results list every photo challenge of a zone separately from its questions, and none for a zone without any', async () => {
  const { env, p, admin } = await game();
  await send(p, 'zone 1', 'Q3');
  await apply(admin, 'Q3', 'full');
  env.clock.now = END + 1;
  await admin.post('/api/admin/results/publish', { confirm: true });
  const { results } = (await p.get('/api/results')).body;
  const [many, none] = results.zones;
  assert.deepEqual(many.questions.map((q) => q.id), ['Q1']);
  assert.deepEqual(many.photos.map((x) => [x.id, x.submitted, x.earned]), [['Q2', false, 0], ['Q3', true, 10]]);
  assert.deepEqual(none.photos, []);
  assert.equal(results.total, 10);
});

test('a game file with the old single photo fields is refused when the admin saves the configuration', async () => {
  const old = { 'zone 1': { 'zone-name': 'Old', 'zone-map': 'a.png', 'photo-challenge': 'x', 'photo-score': 5, questions: [{ Q1: 'q?', type: 'string', answer: 'a', score: 5 }] } };
  const env = setup({ game: old });
  const res = await env.admin().put('/api/admin/config', { name: 'Test game', timeZone: 'Australia/Perth', day: '2026-11-14', start: '10:00', end: '12:00' });
  assert.deepEqual([res.status, res.body.error], [422, 'invalid-game-data']);
});
