// Test helpers for the app: a fixture game (never the real game file), a controllable clock, and "browsers"
// that keep their cookie like a real one does.
const assert = require('node:assert/strict');
const { createApp } = require('../../api/app/app.js');
const { mapId } = require('../../api/lib/gamedata.js');
const { createMemoryStore } = require('../../api/store/memory.js');
const { createMemoryBlobs } = require('../../api/store/blobs.js');
const { createEvents } = require('../../api/lib/events.js');

// A picture the events store accepts as a map (webp by content).
const TINY_IMAGE = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]).toString('base64');
const CONFIG = { name: 'Test game', timeZone: 'Australia/Perth', day: '2026-11-14', start: '10:00', end: '12:00' };
const START = Date.UTC(2026, 10, 14, 2, 0); // 10:00 AWST
const END = Date.UTC(2026, 10, 14, 4, 0); // 12:00 AWST

const GAME = {
  'zone 1': {
    'zone-name': 'Alpha', 'zone-map': 'a.png', questions: [
      { Q1: 'first?', type: 'string', answer: ['secret one', 'alt one'], score: 10 },
      { Q2: 'number?', type: 'whole-number', answer: '42', score: 20 },
      { Q3: 'decimal?', type: 'decimal', answer: '2.5', score: 5 },
      { Q4: 'photo one', type: 'photo', score: 30 },
    ],
  },
  'zone 2': {
    'zone-name': 'Bravo', 'zone-map': 'b.png', questions: [{ Q1: 'second?', type: 'string', answer: 'secret two', score: 10 }, { Q2: 'photo two', type: 'photo', score: 25 }],
  },
};

function setup({ now = START + 60_000, game = GAME, adminPasscodeHash = '' } = {}) {
  const clock = { now };
  const store = createMemoryStore();
  let ids = 0;
  const shared = {
    store, now: () => clock.now, cookieSecure: true,
    newId: () => (++ids).toString(16).padStart(32, '0'),
  };
  const publicApp = createApp({ ...shared, role: 'public' });
  // Events (games prepared in a private bucket) are only available to the admin app, as in AWS; the buckets are in memory.
  const blobs = createMemoryBlobs();
  const siteBlobs = createMemoryBlobs();
  let activations = 0;
  const events = createEvents({ blobs, siteBlobs, newId: () => `act${++activations}` });
  const adminApp = createApp({ ...shared, role: 'admin', adminPasscodeHash, events });

  // The fixture game is stored as an event, as a real game is; saving the configuration loads the game from it. A request to
  // save the configuration that names no event (`event` left out) gets this one, so tests need not repeat it.
  const FIXTURE = 'fixture';
  const prepared = new Set();
  async function prepareEvent(name = FIXTURE, eventGame = game) {
    if (prepared.has(name)) return name;
    const size = Buffer.byteLength(JSON.stringify(eventGame));
    assert.equal((await events.putQuestions(name, structuredClone(eventGame), size)).ok, true);
    for (const zone of Object.keys(eventGame)) assert.equal((await events.putMap(name, mapId(zone), { thumb: TINY_IMAGE, full: TINY_IMAGE })).ok, true);
    prepared.add(name);
    return name;
  }

  // A "browser": remembers the session cookie the way a real one does.
  const browser = (app) => {
    const jar = new Map(); // cookie name -> value, like a real browser (a team's cookie, the admin's cookie)
    const call = async (method, path, body, { type = 'application/json', raw } = {}) => {
      const headers = {};
      if (jar.size) headers.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
      if (body !== undefined || raw !== undefined) headers['content-type'] = type;
      if (app === adminApp && method === 'PUT' && path === '/api/admin/config' && body && body.event === undefined) body = { ...body, event: await prepareEvent() };
      const res = await app.handle({ method, path, headers, body: raw ?? (body === undefined ? null : JSON.stringify(body)) });
      for (const set of res.cookies) {
        const [pair] = set.split(';');
        const [name, value] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)];
        if (value === '' || /Max-Age=0\b/.test(set)) jar.delete(name); // an emptied cookie ends it
        else jar.set(name, value);
      }
      return res;
    };
    return {
      call, jar, get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), put: (p, b) => call('PUT', p, b), del: (p) => call('DELETE', p),
    };
  };
  return { clock, store, events, blobs, siteBlobs, prepareEvent, player: () => browser(publicApp), admin: () => browser(adminApp) };
}

// Saves the fixture config through the admin API, as the admin would.
async function configure(env, over = {}) {
  const res = await env.admin().put('/api/admin/config', { ...CONFIG, ...over });
  if (res.status !== 200) throw new Error(`configure failed: ${JSON.stringify(res.body)}`);
}

// The common starting point: a configured game, in progress, with one team ("Sea Dogs") joined.
async function activeGame() {
  const env = setup();
  await configure(env);
  const p = env.player();
  await p.post('/api/join', { name: 'Sea Dogs' });
  return { env, p };
}

const answer = (p, zone, question, value) => p.post('/api/answer', { zone, question, answer: value });
const scoreOf = async (env, name) => (await env.player().get('/api/scoreboard')).body.teams.find((t) => t.name === name)?.score;

module.exports = { setup, configure, activeGame, answer, scoreOf, CONFIG, GAME, START, END };
