// Events through the admin API: preparing games in the (in-memory) events bucket, and activating one, which loads the game
// from it. Status codes and error codes, never wording. Fixture games only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, CONFIG, START, END } = require('./helpers.js');

const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]).toString('base64');
const GAME = {
  'zone 1': { 'zone-name': 'Reef', 'zone-map': 'reef.png', questions: [{ Q1: 'first?', type: 'string', answer: 'secret reef', score: 10 }, { Q2: 'a photo', type: 'photo', score: 30 }] },
  'zone 2': { 'zone-name': 'Dunes', 'zone-map': 'dunes.png', questions: [{ Q1: 'second?', type: 'whole-number', answer: '7', score: 5 }] },
};
const jsonSize = (v) => Buffer.byteLength(JSON.stringify(v));

// A new environment before the game, and an event prepared completely through the API.
async function prepared(name = 'summer', game = GAME) {
  const env = setup({ now: START - 60_000 });
  const admin = env.admin();
  await upload(admin, name, game);
  return { env, admin };
}
async function upload(admin, name, game = GAME, { instructions = '# Be kind\n- have fun' } = {}) {
  assert.equal((await admin.put(`/api/admin/events/${name}/questions`, game)).status, 200);
  if (instructions) assert.equal((await admin.put(`/api/admin/events/${name}/instructions`, { text: instructions })).status, 200);
  for (const zone of Object.keys(game)) {
    const res = await admin.put(`/api/admin/events/${name}/maps/${zone.replace(' ', '-')}`, { thumb: WEBP, full: WEBP });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }
}
const activate = (admin, event, over = {}) => admin.put('/api/admin/config', { ...CONFIG, event, ...over });

test('events can be listed, and an incomplete one says what it still needs', async () => {
  const env = setup({ now: START - 60_000 });
  const admin = env.admin();
  assert.deepEqual((await admin.get('/api/admin/events')).body, { available: true, active: null, events: [] });
  await admin.put('/api/admin/events/summer/questions', GAME);
  const [summer] = (await admin.get('/api/admin/events')).body.events;
  assert.deepEqual([summer.name, summer.complete, summer.zoneCount, summer.questionCount, summer.missingMaps], ['summer', false, 2, 3, ['zone-1', 'zone-2']]);
  await upload(admin, 'summer');
  assert.equal((await admin.get('/api/admin/events/summer')).body.complete, true);
});

test('the questions are validated: a bad file is refused with the problems and nothing is stored', async () => {
  const env = setup();
  const res = await env.admin().put('/api/admin/events/bad/questions', { 'zone 1': { 'zone-name': 'x', 'photo-challenge': 'old style' } });
  assert.deepEqual([res.status, res.body.error], [422, 'invalid-game-data']);
  assert.ok(res.body.problems.length > 0);
  assert.deepEqual((await env.admin().get('/api/admin/events')).body.events, []);
});

test('maps and instructions are checked too: only real images, only for zones of the event, within the size limits', async () => {
  const env = setup();
  const admin = env.admin();
  await admin.put('/api/admin/events/summer/questions', GAME);
  const bad = async (body, map = 'zone-1') => admin.put(`/api/admin/events/summer/maps/${map}`, body);
  assert.deepEqual([(await bad({ thumb: Buffer.from('<svg/>').toString('base64'), full: WEBP })).body.error], ['invalid-image']);
  assert.equal((await bad({ thumb: WEBP, full: WEBP }, 'zone-9')).body.error, 'unknown-zone');
  assert.equal((await bad({ thumb: WEBP })).body.error, 'invalid-image'); // a part missing
  const huge = Buffer.concat([Buffer.from(WEBP, 'base64'), Buffer.alloc(600 * 1024)]).toString('base64');
  assert.equal((await bad({ thumb: WEBP, full: huge })).status, 413);
  assert.equal((await admin.put('/api/admin/events/summer/instructions', { text: 'x'.repeat(21 * 1024) })).status, 413);
  assert.equal((await admin.put('/api/admin/events/summer/instructions', { text: 5 })).body.error, 'invalid-instructions');
  assert.equal((await admin.get('/api/admin/events/summer')).body.missingMaps.length, 2); // nothing got stored
});

test('event names and unknown events are refused with 400, never a 404 or a path trick', async () => {
  const env = setup();
  const admin = env.admin();
  for (const name of ['Summer', 'a%20b', '..', '%2e%2e', 'x'.repeat(41)]) {
    const res = await admin.put(`/api/admin/events/${name}/questions`, GAME);
    assert.deepEqual([res.status, res.body.error], [400, 'invalid-event-name'], name);
  }
  assert.deepEqual([(await admin.get('/api/admin/events/nothing')).status, (await admin.get('/api/admin/events/nothing')).body.error], [400, 'unknown-event']);
  assert.equal((await admin.del('/api/admin/events/nothing')).body.error, 'unknown-event');
  assert.equal((await admin.put('/api/admin/events/nothing/instructions', { text: 'x' })).body.error, 'unknown-event');
  assert.equal((await env.blobs.list('')).keys.length, 0);
});

test('activating an event loads its questions, instructions and maps into the live game', async () => {
  const { env, admin } = await prepared();
  const res = await activate(admin, 'summer');
  assert.deepEqual([res.status, res.body.event, res.body.zoneCount], [200, 'summer', 2]);
  assert.equal((await admin.get('/api/admin/config')).body.event, 'summer');
  assert.equal((await admin.get('/api/admin/events')).body.active, 'summer');

  env.clock.now = START + 60_000;
  const { body } = await env.player().get('/api/game');
  assert.deepEqual(body.zones.map((z) => z.name), ['Reef', 'Dunes']);
  assert.deepEqual(body.zones[0].map, { thumb: '/event-maps/act1/zone-1-thumb.webp', full: '/event-maps/act1/zone-1.webp' });
  assert.equal(body.instructions, '# Be kind\n- have fun');
  assert.equal(JSON.stringify(body).includes('secret reef'), false); // the answers still never go to players
  assert.notEqual(await env.siteBlobs.get('event-maps/act1/zone-1.webp'), null);
});

test('what was saved on the config page is written back to the event, so the event matches what was last used', async () => {
  const { env, admin } = await prepared();
  await activate(admin, 'summer', { name: 'Reef day', joinCode: 'reef1' });
  const stored = JSON.parse((await env.blobs.get('summer/game-config.json')).toString());
  assert.deepEqual([stored.name, stored.joinCode, stored.day], ['Reef day', 'REEF1', CONFIG.day]);
  assert.equal((await admin.get('/api/admin/events/summer')).body.config.name, 'Reef day');
});

test('only a complete and valid event can be activated, and the game is unchanged by a refusal', async () => {
  const env = setup({ now: START - 60_000 });
  const admin = env.admin();
  await admin.put('/api/admin/events/half/questions', GAME); // no maps
  const res = await activate(admin, 'half');
  assert.deepEqual([res.status, res.body.error, res.body.missing], [422, 'event-incomplete', ['zone-1', 'zone-2']]);
  assert.equal((await activate(admin, 'nothing')).body.error, 'unknown-event');
  assert.equal((await activate(admin, '../x')).body.error, 'unknown-event');
  assert.equal((await admin.get('/api/admin/config')).body.config, null);
});

test('switching to a different event is refused while teams exist, but saving the same event again keeps them', async () => {
  const { env, admin } = await prepared('summer');
  await upload(admin, 'winter');
  await activate(admin, 'summer');
  await env.player().post('/api/join', { name: 'Sea Dogs' });
  const other = await activate(admin, 'winter');
  assert.deepEqual([other.status, other.body.error], [409, 'players-exist']);
  assert.equal((await admin.get('/api/admin/config')).body.event, 'summer'); // unchanged
  assert.equal((await activate(admin, 'summer', { name: 'Same event, new name' })).status, 200);
  assert.equal((await admin.get('/api/admin/teams')).body.teams.length, 1);
  await admin.post('/api/admin/delete-all', { confirm: 'delete' });
  assert.equal((await activate(admin, 'winter')).status, 200); // no player data: free to switch
  assert.equal((await env.siteBlobs.list('event-maps/')).keys.every((k) => k.startsWith('event-maps/act3/')), true); // only the last activation's maps remain
});

test('the live game cannot be changed while it is in progress, whichever event it is', async () => {
  const { env, admin } = await prepared();
  await activate(admin, 'summer');
  env.clock.now = START + 60_000;
  assert.equal((await activate(admin, 'summer')).body.error, 'game-active');
});

test('an event can be deleted, except the one the live game was loaded from', async () => {
  const { env, admin } = await prepared('summer');
  await upload(admin, 'winter');
  await activate(admin, 'summer');
  assert.deepEqual([(await admin.del('/api/admin/events/summer')).status, (await admin.del('/api/admin/events/summer')).body.error], [409, 'event-active']);
  assert.equal((await admin.del('/api/admin/events/winter')).status, 200);
  assert.deepEqual((await admin.get('/api/admin/events')).body.events.map((e) => e.name), ['summer']);
  assert.equal((await env.blobs.list('winter/')).keys.length, 0);
});

test('an event can be downloaded, and its config saved on its own', async () => {
  const { admin } = await prepared();
  assert.equal((await admin.put('/api/admin/events/summer/config', { ...CONFIG, name: 'Prepared' })).status, 200);
  const res = await admin.get('/api/admin/events/summer/download');
  assert.match(res.headers['content-disposition'], /event-summer\.json/);
  assert.deepEqual([res.body.config.name, Object.keys(res.body.questions), res.body.instructions], ['Prepared', ['zone 1', 'zone 2'], '# Be kind\n- have fun']);
  const bad = await admin.put('/api/admin/events/summer/config', { name: 'x', day: 'not a day' });
  assert.deepEqual([bad.status, bad.body.error], [400, 'invalid-config']);
});

test('every event route needs the admin session, and the public function has none of them', async () => {
  const env = setup({ adminPasscodeHash: 'scrypt$16$8$1$AAAA$AAAA' });
  for (const [method, path, body] of [['GET', '/api/admin/events'], ['GET', '/api/admin/events/summer'], ['DELETE', '/api/admin/events/summer'], ['PUT', '/api/admin/events/summer/questions', GAME],
    ['PUT', '/api/admin/events/summer/instructions', { text: 'x' }], ['PUT', '/api/admin/events/summer/maps/zone-1', { thumb: WEBP, full: WEBP }], ['GET', '/api/admin/events/summer/download']]) {
    const res = await env.admin().call(method, path, body);
    assert.deepEqual([res.status, res.body.error], [401, 'not-authenticated'], `${method} ${path}`);
  }
  const open = setup();
  assert.equal((await open.player().get('/api/admin/events')).status, 404); // not a route of the public function
});

test('without an events store (events not available) the routes say so and activating by event is refused', async () => {
  const { createApp } = require('../../api/app/app.js');
  const { createMemoryStore } = require('../../api/store/memory.js');
  const app = createApp({ store: createMemoryStore(), role: 'admin', loadGameData: () => GAME, now: () => START - 1 });
  const call = (method, path, body) => app.handle({ method, path, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : null });
  assert.deepEqual((await call('GET', '/api/admin/events')).body, { available: false, active: null, events: [] });
  assert.equal((await call('PUT', '/api/admin/events/summer/questions', GAME)).body.error, 'events-unavailable');
  assert.equal((await call('PUT', '/api/admin/config', { ...CONFIG, event: 'summer' })).body.error, 'events-unavailable');
});

test('the questions file can be as large as allowed but no larger', async () => {
  const env = setup();
  const admin = env.admin();
  const padded = { ...GAME, 'zone 1': { ...GAME['zone 1'], questions: [{ Q1: 'x'.repeat(300 * 1024), type: 'photo', score: 1 }] } };
  assert.ok(jsonSize(padded) > 256 * 1024);
  assert.equal((await admin.put('/api/admin/events/big/questions', padded)).status, 413);
});

test('a configuration saved without an event still loads the repository game file, as before', async () => {
  const env = setup({ now: START - 60_000 });
  const res = await env.admin().put('/api/admin/config', CONFIG);
  assert.deepEqual([res.status, res.body.event, res.body.zoneCount], [200, null, 2]);
  env.clock.now = END - 1;
  assert.equal((await env.player().get('/api/game')).body.instructions, null); // no event: the page keeps its built-in instructions
});
