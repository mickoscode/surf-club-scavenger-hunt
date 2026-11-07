// Admin behaviour and request safety of the API, plus the Lambda event adapter. Fixture game only (see helpers.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, configure, activeGame, scoreOf, CONFIG, START, END } = require('./helpers.js');
const { fromLambdaEvent, toLambdaResponse } = require('../../api/app/lambda.js');

// ------------------------------------------------------------------------------------------------ photo scoring

test('the admin scores photos: pending first in the order sent, decisions replace each other, applied ones go last', async () => {
  const env = setup();
  await configure(env);
  const a = env.player();
  const b = env.player();
  await a.post('/api/join', { name: 'Alpha' });
  await b.post('/api/join', { name: 'Bravo' });
  env.clock.now += 1000; await b.post('/api/photo', { zone: 'zone 1' });
  env.clock.now += 1000; await a.post('/api/photo', { zone: 'zone 2' });
  env.clock.now += 1000; await a.post('/api/photo', { zone: 'zone 1' });
  const admin = env.admin();
  const order = async () => (await admin.get('/api/admin/photos')).body.photos.map((r) => `${r.teamNumber}:${r.zone}:${r.decision}`);
  assert.deepEqual(await order(), ['2:zone 1:null', '1:zone 2:null', '1:zone 1:null']);

  const apply = (teamNumber, zone, decision) => admin.post('/api/admin/photos/apply', { teamNumber, zone, decision });
  assert.deepEqual((await apply(2, 'zone 1', 'full')).body, { delta: 30, score: 30 });
  assert.deepEqual(await order(), ['1:zone 2:null', '1:zone 1:null', '2:zone 1:full']);
  assert.deepEqual((await apply(2, 'zone 1', 'full')).body, { delta: 0, score: 30 }); // applied twice: no extra points
  assert.deepEqual((await apply(2, 'zone 1', 'half')).body, { delta: -15, score: 15 });
  assert.equal(await scoreOf(env, 'Bravo'), 15);
  assert.deepEqual((await apply(1, 'zone 2', 'half')).body, { delta: 12.5, score: 12.5 }); // halves are not rounded
});

test('photo decisions are checked: known decision, team, zone and a photo that was actually sent', async () => {
  const { env } = await activeGame();
  const apply = (b) => env.admin().post('/api/admin/photos/apply', b);
  assert.equal((await apply({ teamNumber: 1, zone: 'zone 1', decision: 'maybe' })).body.error, 'invalid-decision');
  assert.equal((await apply({ teamNumber: 9, zone: 'zone 1', decision: 'full' })).body.error, 'no-team');
  assert.equal((await apply({ teamNumber: 1, zone: 'zone 9', decision: 'full' })).body.error, 'unknown-zone');
  assert.equal((await apply({ teamNumber: 1, zone: '__proto__', decision: 'full' })).body.error, 'unknown-zone');
  assert.equal((await apply({ teamNumber: 1, zone: 'zone 1', decision: 'full' })).body.error, 'no-photo');
  assert.equal((await apply({ teamNumber: '1', zone: 'zone 1', decision: 'full' })).status, 400);
});

test('scoring is possible during and after the game, not before', async () => {
  const { env, p } = await activeGame();
  await p.post('/api/photo', { zone: 'zone 1' });
  const apply = () => env.admin().post('/api/admin/photos/apply', { teamNumber: 1, zone: 'zone 1', decision: 'full' });
  env.clock.now = START - 1;
  assert.equal((await apply()).status, 409);
  env.clock.now = END + 1;
  assert.equal((await apply()).status, 200);
});

// ------------------------------------------------------------------------------------------------ config and data

test('saving the config loads the game file, validates both, and is refused while the game is active', async () => {
  const env = setup({ now: START - 1000 });
  const admin = env.admin();
  assert.equal((await admin.get('/api/admin/config')).body.status, 'unconfigured');
  const bad = await admin.put('/api/admin/config', { ...CONFIG, end: '09:00' });
  assert.deepEqual([bad.status, bad.body.error, bad.body.fields], [400, 'invalid-config', ['end-before-start']]);
  const ok = await admin.put('/api/admin/config', { ...CONFIG, name: '  ' });
  assert.deepEqual([ok.status, ok.body.zoneCount, ok.body.config.name], [200, 2, 'Sorrento Youth Scavenger Hunt']); // default name
  const info = (await admin.get('/api/admin/config')).body;
  assert.deepEqual([info.status, info.zoneCount, info.timeZones.length > 0], ['pre', 2, true]);
  env.clock.now = START;
  const active = await admin.put('/api/admin/config', CONFIG);
  assert.deepEqual([active.status, active.body.error], [409, 'game-active']);
  env.clock.now = END + 1;
  assert.equal((await admin.put('/api/admin/config', CONFIG)).status, 200);
});

test('a broken game file is reported to the admin and does not replace the current game', async () => {
  const env = setup({ game: { 'zone 1': { 'zone-name': 'X' } } });
  const res = await env.admin().put('/api/admin/config', CONFIG);
  assert.deepEqual([res.status, res.body.error], [422, 'invalid-game-data']);
  assert.ok(res.body.problems.length > 0);
  assert.equal(await env.store.getGame(), null);
});

test('removing a team works any time, by number, and frees its name', async () => {
  const { env } = await activeGame();
  assert.equal((await env.admin().del('/api/admin/teams/1')).status, 200);
  assert.equal((await env.admin().del('/api/admin/teams/1')).status, 400);
  assert.equal((await env.player().post('/api/join', { name: 'Sea Dogs' })).status, 200);
});

test('deleting all player data needs confirmation and is refused during the game', async () => {
  const { env } = await activeGame();
  const del = (body) => env.admin().post('/api/admin/delete-all', body);
  assert.equal((await del({ confirm: 'delete' })).body.error, 'game-active');
  env.clock.now = END + 1;
  assert.equal((await del({})).body.error, 'confirmation-required');
  assert.equal((await del({ confirm: 'delete' })).status, 200);
  assert.deepEqual((await env.admin().get('/api/admin/teams')).body.teams, []);
  assert.notEqual((await env.admin().get('/api/admin/config')).body.config, null); // the game stays
});

test('the export is a download containing the teams', async () => {
  const { env } = await activeGame();
  const res = await env.admin().get('/api/admin/export');
  assert.match(res.headers['content-disposition'], /^attachment; filename="scavenger-hunt-data-2026-11-14\.json"$/);
  assert.equal(res.body.teams.length, 1);
  assert.equal(res.body.game.config.name, CONFIG.name);
  assert.equal(res.headers['cache-control'], 'no-store');
});

// ------------------------------------------------------------------------------------------------ safety

test('the two roles only serve their own routes', async () => {
  const env = setup();
  await configure(env);
  assert.equal((await env.player().get('/api/admin/config')).status, 404);
  assert.equal((await env.player().post('/api/admin/delete-all', { confirm: 'delete' })).status, 404);
  assert.equal((await env.admin().get('/api/scoreboard')).status, 404);
  assert.equal((await env.admin().post('/api/join', { name: 'x' })).status, 404);
  assert.equal((await env.player().get('/nope')).status, 404);
});

test('application errors never use 403 or 404, which CloudFront would replace with the site 404 page', async () => {
  const { env, p } = await activeGame();
  const admin = env.admin();
  const calls = [
    () => p.post('/api/answer', { zone: 'nope', question: 'Q1', answer: 'x' }), () => p.post('/api/photo', { zone: 'nope' }),
    () => env.player().post('/api/answer', { zone: 'zone 1', question: 'Q1', answer: 'x' }), () => p.post('/api/join', {}),
    () => admin.put('/api/admin/config', CONFIG), () => admin.post('/api/admin/delete-all', { confirm: 'delete' }),
    () => admin.del('/api/admin/teams/99'), () => admin.post('/api/admin/photos/apply', { teamNumber: 1, zone: 'zone 1', decision: 'full' }),
    () => admin.post('/api/admin/photos/apply', { teamNumber: 1, zone: 'nope', decision: 'full' }),
  ];
  for (const now of [START - 1, START + 1000, END + 1]) { // before, during and after the game
    env.clock.now = now;
    for (const call of calls) {
      const { status } = await call();
      assert.ok(![403, 404].includes(status), `status ${status} at ${now}`);
    }
  }
});

test('POST bodies must be JSON sent as application/json, small and well formed', async () => {
  const env = setup();
  await configure(env);
  const p = env.player();
  assert.equal((await p.call('POST', '/api/join', undefined, { type: 'application/x-www-form-urlencoded', raw: 'name=Sharks' })).status, 415);
  assert.equal((await p.call('POST', '/api/join', undefined, { type: 'text/plain', raw: '{"name":"Sharks"}' })).status, 415);
  assert.equal((await p.call('POST', '/api/join', undefined, { raw: '{not json' })).status, 400);
  assert.equal((await p.call('POST', '/api/join', undefined, { raw: '[]' })).status, 400);
  assert.equal((await p.call('POST', '/api/join', undefined, { raw: JSON.stringify({ name: 'x'.repeat(5000) }) })).status, 413);
});

test('a failure inside the app is a plain 500 without details', async () => {
  const env = setup();
  env.store.getGame = async () => { throw new Error('database exploded: secret details'); };
  const original = console.error;
  console.error = () => {};
  try {
    const res = await env.player().get('/api/scoreboard');
    assert.deepEqual([res.status, res.body], [500, { error: 'server-error' }]);
  } finally {
    console.error = original;
  }
});

// ------------------------------------------------------------------------------------------------ Lambda adapter

test('API Gateway events become requests (cookies, base64 bodies) and responses become API Gateway responses', () => {
  const request = fromLambdaEvent({
    rawPath: '/api/join', headers: { 'Content-Type': 'application/json' }, cookies: ['a=1', 'hunt=abc'],
    isBase64Encoded: true, body: Buffer.from('{"name":"Sharks"}').toString('base64'),
    requestContext: { http: { method: 'POST' } },
  });
  assert.deepEqual(request, {
    method: 'POST', path: '/api/join', headers: { 'content-type': 'application/json', cookie: 'a=1; hunt=abc' }, body: '{"name":"Sharks"}',
  });
  assert.deepEqual(
    toLambdaResponse({ status: 200, headers: { x: 'y' }, cookies: ['c=1'], body: { ok: true } }),
    { statusCode: 200, headers: { x: 'y' }, body: '{"ok":true}', cookies: ['c=1'] },
  );
  assert.equal('cookies' in toLambdaResponse({ status: 200, headers: {}, cookies: [], body: {} }), false);
});
