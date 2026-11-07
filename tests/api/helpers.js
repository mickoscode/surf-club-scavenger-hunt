// Test helpers for the app: a fixture game (never the real game file), a controllable clock, and "browsers"
// that keep their cookie like a real one does.
const { createApp } = require('../../api/app/app.js');
const { createMemoryStore } = require('../../api/store/memory.js');

const CONFIG = { name: 'Test game', timeZone: 'Australia/Perth', day: '2026-11-14', start: '10:00', end: '12:00' };
const START = Date.UTC(2026, 10, 14, 2, 0); // 10:00 AWST
const END = Date.UTC(2026, 10, 14, 4, 0); // 12:00 AWST

const GAME = {
  'zone 1': {
    'zone-name': 'Alpha', 'zone-map': 'a.png', 'photo-challenge': 'photo one', 'photo-score': 30,
    questions: [
      { Q1: 'first?', type: 'string', answer: ['secret one', 'alt one'], score: 10 },
      { Q2: 'number?', type: 'whole-number', answer: '42', score: 20 },
      { Q3: 'decimal?', type: 'decimal', answer: '2.5', score: 5 },
    ],
  },
  'zone 2': {
    'zone-name': 'Bravo', 'zone-map': 'b.png', 'photo-challenge': 'photo two', 'photo-score': 25,
    questions: [{ Q1: 'second?', type: 'string', answer: 'secret two', score: 10 }],
  },
};

function setup({ now = START + 60_000, game = GAME } = {}) {
  const clock = { now };
  const store = createMemoryStore();
  let ids = 0;
  const shared = {
    store, now: () => clock.now, loadGameData: () => structuredClone(game), cookieSecure: true,
    newId: () => (++ids).toString(16).padStart(32, '0'),
  };
  const publicApp = createApp({ ...shared, role: 'public' });
  const adminApp = createApp({ ...shared, role: 'admin' });

  // A "browser": remembers the session cookie the way a real one does.
  const browser = (app) => {
    let cookie = null;
    const call = async (method, path, body, { type = 'application/json', raw } = {}) => {
      const headers = {};
      if (cookie) headers.cookie = cookie;
      if (body !== undefined || raw !== undefined) headers['content-type'] = type;
      const res = await app.handle({ method, path, headers, body: raw ?? (body === undefined ? null : JSON.stringify(body)) });
      const set = res.cookies.find((c) => c.startsWith('hunt='));
      if (set) cookie = set.split(';')[0];
      return res;
    };
    return { call, get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), put: (p, b) => call('PUT', p, b), del: (p) => call('DELETE', p) };
  };
  return { clock, store, player: () => browser(publicApp), admin: () => browser(adminApp) };
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
