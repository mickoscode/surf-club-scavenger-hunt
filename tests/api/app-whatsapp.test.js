// The WhatsApp group link: saved with the game configuration, given only to a team with a session, never to the public.
// Status codes and error codes only, never wording. Fixture game (tests/api/helpers.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, configure, activeGame, CONFIG, START, END } = require('./helpers.js');

const LINK = 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv';
const save = (admin, over) => admin.put('/api/admin/config', { ...CONFIG, ...over });

test('a valid group link is saved in its plain form, and shown to the admin', async () => {
  const env = setup();
  const res = await save(env.admin(), { whatsappUrl: `  ${LINK}?mode=ems_copy_t ` });
  assert.equal(res.status, 200);
  assert.equal(res.body.config.whatsappUrl, LINK); // tidied: spaces and the tracking query gone
  assert.equal((await env.admin().get('/api/admin/config')).body.config.whatsappUrl, LINK);
});

test('no link means the setting is simply absent, and saving again without one removes it', async () => {
  const env = setup({ now: START - 1000 }); // before the game, when the configuration can be saved again and again
  for (const empty of [undefined, null, '', '   ']) {
    const res = await save(env.admin(), { whatsappUrl: empty });
    assert.equal(res.status, 200);
    assert.equal('whatsappUrl' in res.body.config, false, JSON.stringify(empty));
  }
  await save(env.admin(), { whatsappUrl: LINK });
  await save(env.admin(), {}); // saved without a link: it is gone
  assert.equal('whatsappUrl' in (await env.admin().get('/api/admin/config')).body.config, false);
});

test('a link that is not a WhatsApp group invite is refused by name, and nothing is saved', async () => {
  const env = setup();
  for (const bad of ['https://example.org/x', 'http://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv', 'javascript:alert(1)', 'chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv', 42]) {
    const res = await save(env.admin(), { whatsappUrl: bad });
    assert.deepEqual([res.status, res.body.error, res.body.fields], [400, 'invalid-config', ['whatsappUrl']], String(bad));
  }
  assert.equal((await env.admin().get('/api/admin/config')).body.config, null);
});

test('a team with a session is given the link, and a browser with no team is not', async () => {
  const env = setup();
  await configure(env, { whatsappUrl: LINK });
  const p = env.player();
  assert.deepEqual((await p.get('/api/me')).body, { team: null }); // no session: nothing, not even the key
  await p.post('/api/join', { name: 'Sea Dogs' });
  const me = (await p.get('/api/me')).body;
  assert.equal(me.whatsappUrl, LINK);
  assert.equal((await env.player().get('/api/me')).body.whatsappUrl, undefined);
});

test('a team gets null when no link is set', async () => {
  const { p } = await activeGame();
  assert.equal((await p.get('/api/me')).body.whatsappUrl, null);
});

test('the link is in no public response: not the game, the scoreboard, the results, nor the health check', async () => {
  const env = setup();
  await configure(env, { whatsappUrl: LINK });
  const p = env.player();
  await p.post('/api/join', { name: 'Sea Dogs' });
  const spectator = env.player();
  env.clock.now = START + 1000; // during the game the questions are public, so check then too
  const bodies = [];
  for (const path of ['/api/game', '/api/scoreboard', '/api/results', '/api/health']) {
    bodies.push(JSON.stringify((await spectator.get(path)).body));
    bodies.push(JSON.stringify((await p.get(path)).body)); // even a team's own copies of the shared pages
  }
  env.clock.now = END + 1;
  await env.admin().post('/api/admin/results/publish', { confirm: true });
  bodies.push(JSON.stringify((await p.get('/api/results')).body));
  const all = bodies.join('\n');
  assert.ok(!all.includes('chat.whatsapp.com') && !all.includes('AbCdEfGhIj'), 'the link leaked into a public response');
});

test('the link is part of the configuration: it cannot be changed while the game is in progress', async () => {
  const env = setup({ now: START - 1000 });
  await save(env.admin(), { whatsappUrl: LINK });
  env.clock.now = START + 1000;
  const res = await save(env.admin(), { whatsappUrl: 'https://chat.whatsapp.com/ZyXwVuTsRqPoNmLkJiHgFe' });
  assert.deepEqual([res.status, res.body.error], [409, 'game-active']);
  assert.equal((await env.admin().get('/api/admin/config')).body.config.whatsappUrl, LINK);
});

test('an existing configuration saved before this setting existed still works', async () => {
  const env = setup();
  await env.store.saveGame({ config: { ...CONFIG }, game: { 'zone 1': { 'zone-name': 'A', 'zone-map': 'a.png', questions: [{ Q1: 'x', type: 'photo', score: 1 }] } }, configuredAt: 1 });
  assert.equal((await env.admin().get('/api/admin/config')).body.status, 'active'); // valid without the key
  const p = env.player();
  await p.post('/api/join', { name: 'Sea Dogs' });
  assert.equal((await p.get('/api/me')).body.whatsappUrl, null);
});
