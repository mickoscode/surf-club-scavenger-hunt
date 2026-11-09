// The optional join code: a new team must enter it, nothing is created without it, it is never in a public response, and
// it is validated and tidied when the admin saves it. Fixture game only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, configure, START, END } = require('./helpers.js');

const CODE = 'SURF24';
const join = (p, body) => p.post('/api/join', body);
const withCode = async (over = {}) => { const env = setup({ now: START - 60_000 }); await configure(env, { joinCode: CODE, ...over }); return env; };

test('with no code set nothing extra is needed, and the game says no code is needed', async () => {
  const env = setup();
  await configure(env);
  assert.equal((await env.player().get('/api/game')).body.game.joinCodeRequired, false);
  assert.equal((await join(env.player(), { name: 'Sea Dogs' })).status, 200);
});

test('with a code set the game says one is needed, but never what it is', async () => {
  const env = await withCode();
  assert.equal((await env.player().get('/api/game')).body.game.joinCodeRequired, true);
  assert.equal((await env.player().get('/api/scoreboard')).body.game.joinCodeRequired, true);
});

test('a missing or wrong code is refused, and nothing is created: the name is not used up and no team number is taken', async () => {
  const env = await withCode();
  for (const body of [{ name: 'Sea Dogs' }, { name: 'Sea Dogs', code: '' }, { name: 'Sea Dogs', code: 'SURF25' }, { name: 'Sea Dogs', code: 'SURF2' }, { name: 'Sea Dogs', code: 24 }, { name: 'Sea Dogs', code: 'x'.repeat(500) }]) {
    const res = await join(env.player(), body);
    assert.deepEqual([res.status, res.body.error], [400, 'wrong-code'], JSON.stringify(body).slice(0, 60));
    assert.equal(res.cookies.length, 0); // no session either
  }
  assert.equal((await env.admin().get('/api/admin/teams')).body.teams.length, 0);
  const ok = await join(env.player(), { name: 'Sea Dogs', code: CODE });
  assert.deepEqual([ok.status, ok.body.team.number], [200, 1]); // the first number and the same name: nothing was used up
});

test('the code is typed forgivingly: any capitals, spaces and dashes', async () => {
  const env = await withCode();
  let n = 0;
  for (const code of ['surf24', 'Surf24', '  SURF 24 ', 's-u-r-f-2-4', 'surf-24']) {
    const res = await join(env.player(), { name: `Team name ${++n}`, code });
    assert.equal(res.status, 200, code);
  }
});

test('the code is checked before anything about the name, so a stranger learns nothing else', async () => {
  const env = await withCode();
  await join(env.player(), { name: 'Sea Dogs', code: CODE });
  assert.equal((await join(env.player(), { name: 'Sea Dogs', code: 'WRONG1' })).body.error, 'wrong-code'); // not "name-taken"
  assert.equal((await join(env.player(), { name: '', code: 'WRONG1' })).body.error, 'wrong-code'); // not "empty"
  assert.equal((await join(env.player(), { name: 'Sea Dogs', code: CODE })).body.error, 'name-taken'); // with the code, the usual rules apply
});

test('a browser that has already joined is not asked for the code again', async () => {
  const env = await withCode();
  const p = env.player();
  await join(p, { name: 'Sea Dogs', code: CODE });
  const again = await join(p, { name: 'Sea Dogs' });
  assert.deepEqual([again.status, again.body.team.number], [200, 1]);
});

test('joining stays possible during the game, with the code', async () => {
  const env = await withCode();
  env.clock.now = START + 60_000;
  assert.equal((await join(env.player(), { name: 'Late', code: 'nope!' })).body.error, 'wrong-code');
  assert.equal((await join(env.player(), { name: 'Late', code: CODE })).status, 200);
});

test('it also works when team names are off', async () => {
  const env = await withCode({ teamNames: false });
  assert.equal((await join(env.player(), {})).body.error, 'wrong-code');
  assert.deepEqual((await join(env.player(), { code: CODE })).body.team, { number: 1, name: 'Team 1' });
});

test('the code is in no public response: not in the game, scoreboard, me, results, a join answer or an error', async () => {
  const env = await withCode();
  const p = env.player();
  const joined = await join(p, { name: 'Sea Dogs', code: CODE });
  env.clock.now = START + 60_000;
  const seen = [joined, await join(env.player(), { name: 'x', code: 'wrong' }), await p.get('/api/me'), await p.get('/api/results'),
    await env.player().get('/api/game'), await env.player().get('/api/scoreboard'), await env.player().get('/api/health')];
  env.clock.now = END + 1;
  seen.push(await p.get('/api/results'), await env.player().get('/api/scoreboard'));
  for (const res of seen) assert.equal(JSON.stringify([res.body, res.headers, res.cookies]).toUpperCase().includes(CODE), false);
});

test('the admin sees the code on the configuration (tidy, in capitals); an empty one removes it', async () => {
  const env = setup({ now: START - 60_000 });
  await configure(env, { joinCode: ' surf-24 ' });
  assert.equal((await env.admin().get('/api/admin/config')).body.config.joinCode, 'SURF24');
  await configure(env, { joinCode: '' });
  const config = (await env.admin().get('/api/admin/config')).body.config;
  assert.equal(config.joinCode, undefined);
  assert.equal((await env.player().get('/api/game')).body.game.joinCodeRequired, false);
});

test('only 5 to 12 letters and digits are accepted as a code', async () => {
  const env = setup({ now: START - 60_000 });
  const base = { name: 'x', timeZone: 'Australia/Perth', day: '2026-11-14', start: '10:00', end: '12:00' };
  for (const joinCode of ['abcd', 'a'.repeat(13), 'surf!24', 'surf_24', 'sürf24', 12345, 'ab cd']) {
    const res = await env.admin().put('/api/admin/config', { ...base, joinCode });
    assert.deepEqual([res.status, res.body.fields], [400, ['joinCode']], String(joinCode));
  }
  for (const joinCode of ['abcde', 'a'.repeat(12), 'AB-CD 12']) assert.equal((await env.admin().put('/api/admin/config', { ...base, joinCode })).status, 200, joinCode);
});

test('the code cannot be changed while the game is in progress, like the rest of the configuration', async () => {
  const env = await withCode();
  env.clock.now = START + 60_000;
  const res = await env.admin().put('/api/admin/config', { name: 'x', timeZone: 'Australia/Perth', day: '2026-11-14', start: '10:00', end: '12:00', joinCode: 'OTHER1' });
  assert.deepEqual([res.status, res.body.error], [409, 'game-active']);
});
