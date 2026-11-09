// Team names on or off (a game setting, on unless turned off). With names off a team is "Team <number>" everywhere and
// nothing is asked, stored or checked. Fixture game only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, configure, answer, START, END } = require('./helpers.js');

const joinNoName = (p, body = {}) => p.post('/api/join', body);
const noNames = async () => { const env = setup(); await configure(env, { teamNames: false }); return env; };

test('names are on by default, and the game says so', async () => {
  const env = setup();
  await configure(env);
  assert.equal((await env.admin().get('/api/admin/config')).body.config.teamNames, true);
  assert.equal((await env.player().get('/api/game')).body.game.teamNames, true);
  assert.equal((await env.player().get('/api/scoreboard')).body.game.teamNames, true);
});

test('an old configuration saved before this setting existed still has names on', async () => {
  const env = setup();
  await env.store.saveGame({ config: { name: 'Old', timeZone: 'Australia/Perth', day: '2026-11-14', start: '10:00', end: '12:00' }, game: { 'zone 1': { 'zone-name': 'A', 'zone-map': 'a.png', questions: [{ Q1: 'x', type: 'string', answer: 'a', score: 1 }] } }, configuredAt: 1 });
  assert.equal((await env.player().get('/api/game')).body.game.teamNames, true);
  assert.equal((await joinNoName(env.player(), { name: 'Sea Dogs' })).body.team.name, 'Sea Dogs');
});

test('the setting must be true or false', async () => {
  const env = setup();
  const res = await env.admin().put('/api/admin/config', { name: 'x', timeZone: 'Australia/Perth', day: '2026-11-14', start: '10:00', end: '12:00', teamNames: 'no' });
  assert.deepEqual([res.status, res.body.error, res.body.fields], [400, 'invalid-config', ['teamNames']]);
});

test('with names off nobody is asked for a name, and every team is "Team <number>"', async () => {
  const env = await noNames();
  assert.equal((await env.player().get('/api/game')).body.game.teamNames, false);
  const a = env.player();
  const joined = await joinNoName(a);
  assert.deepEqual([joined.status, joined.body.team], [200, { number: 1, name: 'Team 1' }]);
  const b = await joinNoName(env.player(), { name: 'Ignored Name' }); // a name sent anyway is not used
  assert.deepEqual(b.body.team, { number: 2, name: 'Team 2' });
  assert.equal(JSON.stringify((await env.player().get('/api/scoreboard')).body).includes('Ignored'), false);
  assert.deepEqual((await a.get('/api/me')).body.team, { number: 1, name: 'Team 1', score: 0 });
  assert.deepEqual((await env.admin().get('/api/admin/teams')).body.teams.map((t) => t.name), ['Team 1', 'Team 2']);
});

test('with names off the name rules do not apply: any number of teams join, with no clash', async () => {
  const env = await noNames();
  for (let i = 0; i < 12; i++) assert.equal((await joinNoName(env.player())).status, 200);
  assert.equal((await env.admin().get('/api/admin/teams')).body.teams.length, 12);
});

test('with names off the scoreboard lists teams on the same score by number, not alphabetically ("Team 10" after "Team 2")', async () => {
  const env = await noNames();
  const players = [];
  for (let i = 0; i < 11; i++) { const p = env.player(); await joinNoName(p); players.push(p); }
  await answer(players[10], 'zone 1', 'Q2', '42'); // team 11 leads
  const { teams } = (await env.player().get('/api/scoreboard')).body;
  assert.deepEqual(teams.map((t) => t.number), [11, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('a team that joined with a name is shown as Team <number> when names are off, and a nameless team as Team <number> when they are on again', async () => {
  const env = setup({ now: START - 60_000 });
  await configure(env);
  const named = env.player();
  await joinNoName(named, { name: 'Sea Dogs' });
  await configure(env, { teamNames: false });
  assert.equal((await env.player().get('/api/scoreboard')).body.teams[0].name, 'Team 1');
  const nameless = env.player();
  await joinNoName(nameless); // joins while names are off, so has no stored name
  await configure(env, { teamNames: true });
  const names = (await env.player().get('/api/scoreboard')).body.teams.map((t) => t.name).sort();
  assert.deepEqual(names, ['Sea Dogs', 'Team 2']);
});

test('the results page names the team the same way', async () => {
  const env = await noNames();
  const p = env.player();
  await joinNoName(p);
  env.clock.now = END + 1;
  assert.deepEqual((await p.get('/api/results')).body.team, { number: 1, name: 'Team 1' });
});

test('with names on, joining still needs a valid, unused name', async () => {
  const env = setup({ now: START + 1 });
  await configure(env);
  assert.equal((await joinNoName(env.player())).body.error, 'empty');
  assert.equal((await joinNoName(env.player(), { name: 'Sea Dogs' })).status, 200);
  assert.equal((await joinNoName(env.player(), { name: 'sea dogs' })).body.error, 'name-taken');
});
