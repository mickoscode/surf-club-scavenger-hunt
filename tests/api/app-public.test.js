// Player-facing behaviour of the API through the app, against the in-memory store and a controllable clock.
// Assertions use status codes and error codes, never wording. Fixture game only (see helpers.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, configure, activeGame, answer, scoreOf, START, END } = require('./helpers.js');

const join = (p, name = 'Sea Dogs') => p.post('/api/join', { name });

// ------------------------------------------------------------------------------------------------ joining

test('nobody can join before a game is configured', async () => {
  const env = setup();
  const res = await join(env.player());
  assert.deepEqual([res.status, res.body.error], [409, 'not-joinable']);
});

test('joining before and during the game works, and sets a protected session cookie', async () => {
  for (const now of [START - 60_000, START + 60_000, END]) {
    const env = setup({ now });
    await configure(env);
    const res = await join(env.player());
    assert.equal(res.status, 200, `now=${now}`);
    assert.deepEqual(res.body.team, { number: 1, name: 'Sea Dogs' });
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api']) assert.ok(res.cookies[0].includes(attribute), attribute);
    assert.doesNotMatch(JSON.stringify(res.body), /[0-9a-f]{32}/); // the secret id only ever travels in the cookie
  }
});

test('nobody can join after the game ends', async () => {
  const env = setup({ now: END + 1 });
  await configure(env);
  assert.equal((await join(env.player())).status, 409);
});

test('bad and duplicate team names are refused with a code', async () => {
  const env = setup();
  await configure(env);
  assert.equal((await join(env.player(), 'Sea Dogs')).status, 200);
  const dup = await join(env.player(), '  SEA   dogs ');
  assert.deepEqual([dup.status, dup.body.error], [409, 'name-taken']);
  assert.equal((await join(env.player(), '   ')).body.error, 'empty');
  assert.equal((await join(env.player(), 'x'.repeat(31))).body.error, 'too-long');
  assert.equal((await join(env.player(), 'sh1t')).body.error, 'not-allowed');
  assert.equal((await env.player().post('/api/join', {})).status, 400);
});

test('joining again from the same browser returns the same team instead of making another', async () => {
  const env = setup();
  await configure(env);
  const p = env.player();
  await join(p, 'Sea Dogs');
  assert.deepEqual((await join(p, 'Another Name')).body.team, { number: 1, name: 'Sea Dogs' });
  assert.equal((await env.admin().get('/api/admin/teams')).body.teams.length, 1);
});

test('/api/me knows a team by its cookie only, and a removed team is forgotten', async () => {
  const env = setup();
  await configure(env);
  const p = env.player();
  assert.equal((await p.get('/api/me')).body.team, null);
  await join(p);
  assert.deepEqual((await p.get('/api/me')).body.team, { number: 1, name: 'Sea Dogs', score: 0 });
  assert.equal((await env.player().get('/api/me')).body.team, null); // a different browser
  await env.admin().del('/api/admin/teams/1');
  assert.equal((await p.get('/api/me')).body.team, null);
});

// ------------------------------------------------------------------------------------------------ playing

test('answers are refused before the game starts and after it ends, to the millisecond', async () => {
  const { env, p } = await activeGame();
  env.clock.now = START - 1;
  const early = await answer(p, 'zone 1', 'Q2', '42');
  assert.deepEqual([early.status, early.body.error], [409, 'not-playing']);
  env.clock.now = END + 1;
  assert.equal((await answer(p, 'zone 1', 'Q2', '42')).status, 409);
  env.clock.now = END;
  assert.equal((await answer(p, 'zone 1', 'Q2', '42')).status, 200);
});

test('a correct answer scores, the response never says whether it was right, and it counts once', async () => {
  const { env, p } = await activeGame();
  const first = await answer(p, 'zone 1', 'Q2', '42');
  assert.deepEqual([first.status, first.body], [200, { done: true }]);
  assert.equal(await scoreOf(env, 'Sea Dogs'), 20);
  const second = await answer(p, 'zone 1', 'Q2', '42');
  assert.deepEqual([second.status, second.body.error], [409, 'already-submitted']);
  assert.equal(await scoreOf(env, 'Sea Dogs'), 20);
});

test('a wrong answer looks identical to a right one but scores nothing and still uses the slot', async () => {
  const { env, p } = await activeGame();
  const wrong = await answer(p, 'zone 2', 'Q1', 'definitely not');
  assert.deepEqual([wrong.status, wrong.body], [200, { done: true }]);
  assert.equal(await scoreOf(env, 'Sea Dogs'), 0);
  assert.equal((await answer(p, 'zone 2', 'Q1', 'secret two')).status, 409);
  assert.equal(await scoreOf(env, 'Sea Dogs'), 0);
});

test('each answer type is checked on the server: alternates, typos, exact numbers', async () => {
  const { env, p } = await activeGame();
  await answer(p, 'zone 1', 'Q1', ' ALT   one '); // accepted alternate, tidied
  await answer(p, 'zone 1', 'Q3', '2.50'); // same decimal value
  assert.equal(await scoreOf(env, 'Sea Dogs'), 15);
  await answer(p, 'zone 2', 'Q1', 'secrt two'); // one typo in a long answer
  assert.equal(await scoreOf(env, 'Sea Dogs'), 25);
});

test('an input that cannot be an answer is rejected without using up the one submission', async () => {
  const { env, p } = await activeGame();
  for (const bad of ['abc', '4.2', '', '   ']) {
    const res = await answer(p, 'zone 1', 'Q2', bad);
    assert.deepEqual([res.status, res.body.error], [400, 'invalid-answer'], JSON.stringify(bad));
  }
  assert.equal((await answer(p, 'zone 1', 'Q2', '42')).status, 200);
  assert.equal(await scoreOf(env, 'Sea Dogs'), 20);
});

test('unknown questions and zones, and missing sessions, are refused', async () => {
  const { env, p } = await activeGame();
  assert.equal((await answer(p, 'zone 9', 'Q1', 'x')).status, 400);
  assert.equal((await answer(p, 'zone 1', 'Q9', 'x')).status, 400);
  assert.equal((await answer(p, '__proto__', 'Q1', 'x')).status, 400);
  assert.equal((await answer(env.player(), 'zone 1', 'Q2', '42')).status, 401);
  assert.equal((await env.player().post('/api/photo', { zone: 'zone 1', question: 'Q4' })).status, 401);
});

test('/api/me lists what is done, not what was submitted', async () => {
  const { p } = await activeGame();
  await answer(p, 'zone 1', 'Q1', 'my private guess');
  await p.post('/api/photo', { zone: 'zone 2', question: 'Q2' });
  const me = (await p.get('/api/me')).body;
  assert.deepEqual(me.done, { answers: ['zone 1#Q1'], photos: ['zone 2#Q2'] });
  assert.doesNotMatch(JSON.stringify(me), /private guess/);
});

test('a photo challenge is sent once, and nothing scores until the admin applies a decision', async () => {
  const { env, p } = await activeGame();
  assert.deepEqual((await p.post('/api/photo', { zone: 'zone 1', question: 'Q4' })).body, { done: true });
  assert.equal((await p.post('/api/photo', { zone: 'zone 1', question: 'Q4' })).status, 409);
  assert.equal((await p.post('/api/photo', { zone: 'zone 7', question: 'Q4' })).status, 400);
  assert.equal(await scoreOf(env, 'Sea Dogs'), 0);
});

// ------------------------------------------------------------------------------------------------ nothing leaks

test('no public response ever contains an official answer, a submitted answer or a team secret', async () => {
  const { env, p } = await activeGame();
  await answer(p, 'zone 1', 'Q1', 'my private guess');
  const secretId = (await env.store.listTeams())[0].playerId;
  const bodies = [];
  for (const path of ['/api/game', '/api/scoreboard', '/api/me', '/api/health']) bodies.push(JSON.stringify((await p.get(path)).body));
  bodies.push(JSON.stringify((await answer(p, 'zone 1', 'Q1', 'again')).body));
  const all = bodies.join('\n');
  for (const forbidden of ['secret one', 'alt one', 'secret two', '"answer"', 'my private guess', secretId]) {
    assert.ok(!all.includes(forbidden), `leaked: ${forbidden}`);
  }
});

test('questions are not available before the game is active', async () => {
  const env = setup({ now: START - 1 });
  await configure(env);
  const pre = (await env.player().get('/api/game')).body;
  assert.deepEqual([pre.game.status, pre.zones], ['pre', []]);
  env.clock.now = START;
  const live = (await env.player().get('/api/game')).body;
  assert.deepEqual([live.game.status, live.zones.length], ['active', 2]);
  assert.deepEqual(Object.keys(live.zones[0].questions[0]).sort(), ['id', 'score', 'text', 'type']);
  env.clock.now = END + 1;
  assert.deepEqual((await env.player().get('/api/game')).body.zones, []);
});

test('the scoreboard is sorted and carries what the countdown needs', async () => {
  const env = setup();
  await configure(env);
  for (const name of ['bravo', 'Alpha', 'Zulu']) await join(env.player(), name);
  const leader = env.player();
  await join(leader, 'Yankee');
  await answer(leader, 'zone 1', 'Q2', '42');
  const { body } = await env.player().get('/api/scoreboard');
  assert.deepEqual(body.teams.map((t) => t.name), ['Yankee', 'Alpha', 'bravo', 'Zulu']);
  assert.deepEqual(Object.keys(body.teams[0]).sort(), ['done', 'name', 'number', 'rank', 'score']);
  assert.deepEqual([body.game.status, body.game.startMs, body.game.endMs], ['active', START, END]);
});

test('public pages are shared briefly; everything personal is never cached', async () => {
  const env = setup();
  await configure(env);
  assert.match((await env.player().get('/api/scoreboard')).headers['cache-control'], /public, max-age=3/);
  assert.match((await env.player().get('/api/game')).headers['cache-control'], /public, max-age=3/);
  assert.equal((await env.player().get('/api/me')).headers['cache-control'], 'no-store');
});

test('the scoreboard gives each team its place (ties share one) and how many questions and photo challenges it has attempted', async () => {
  const env = setup();
  await configure(env);
  const [a, b, c] = [env.player(), env.player(), env.player()];
  for (const [p, name] of [[a, 'Alpha'], [b, 'Bravo'], [c, 'Charlie']]) await join(p, name);
  await answer(a, 'zone 1', 'Q2', '42'); // right: 20
  await answer(a, 'zone 1', 'Q1', 'wrong'); // wrong still counts as attempted
  await a.post('/api/photo', { zone: 'zone 1', question: 'Q4' });
  await answer(b, 'zone 1', 'Q2', '42'); // 20, the same score as Alpha
  const { body } = await env.player().get('/api/scoreboard');
  assert.equal(body.questionTotal, 6); // zone 1: three questions and a photo challenge; zone 2: one question and a photo challenge
  const by = Object.fromEntries(body.teams.map((t) => [t.name, t]));
  assert.deepEqual([by.Alpha.rank, by.Bravo.rank, by.Charlie.rank], [1, 1, 3]);
  assert.deepEqual([by.Alpha.done, by.Bravo.done, by.Charlie.done], [3, 1, 0]);
  assert.equal(JSON.stringify(body).includes('wrong'), false); // what was submitted is never in it
});
