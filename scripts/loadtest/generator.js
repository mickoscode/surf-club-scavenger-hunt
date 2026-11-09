'use strict';
// The load itself: simulated teams and spectators that behave the way the real pages do. Every request is recorded (when, what,
// the status, how long, whether CloudFront answered it from its cache) for the report. It also watches its OWN health (how late
// its event loop runs, how busy its CPU is), so the report can say when the test machine, not the site, was the limit.
//
//   a team:      loads the pages, joins as loadtest-NNN, then every ~5 s asks who it is (/api/me) and for the game (/api/game),
//                every other time for the scoreboard, and answers questions and sends photos at the rate asked for
//   a spectator: loads the scoreboard page, asks who it is once, then asks for the scoreboard every ~5 s
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');

const TEAM_PREFIX = 'loadtest-';
const POLL_MS = 5000; // what the real pages do
const LOOP_RESOLUTION_MS = 10;
const STATIC = {
  view: ['/view/', '/css/site.css', '/vendor/bootstrap/bootstrap.min.css', '/favicon.svg', '/js/view.js'],
  play: ['/play/', '/js/play.js'],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const answerFor = (type) => (type === 'whole-number' ? '1' : type === 'decimal' ? '1.5' : 'a test answer');

// One HTTP client for the run. Records every request; never throws.
function createHttp({ baseUrl, startedAt, records, fetchImpl = fetch, timeoutMs = 15000 }) {
  return async function request(label, method, path, { cookie, body } = {}) {
    const t = performance.now() - startedAt;
    const begun = performance.now();
    let status = 0;
    let json = null;
    let teamCookie = null;
    let cache = 'none';
    try {
      const res = await fetchImpl(new URL(path, baseUrl), {
        method,
        headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = res.status;
      const via = res.headers.get('x-cache') ?? '';
      cache = /^hit/i.test(via) ? 'hit' : /miss|refreshhit|error/i.test(via) ? 'miss' : 'none'; // RefreshHit went back to the API too
      const text = await res.text(); // read it all: the time includes the whole response
      try { json = JSON.parse(text); } catch { /* a page, not JSON */ }
      teamCookie = res.headers.getSetCookie?.().map((c) => c.split(';')[0]).find((c) => c.startsWith('hunt=')) ?? null;
    } catch {
      status = 0; // a timeout or a network error
    }
    records.push({ t, label, status, ms: performance.now() - begun, cache });
    return { status, json, cookie: teamCookie };
  };
}

// Samples how overloaded this machine is, every few seconds.
function watchGenerator(startedAt) {
  const loop = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
  loop.enable();
  const samples = [];
  let lastCpu = process.cpuUsage();
  let lastAt = performance.now();
  const timer = setInterval(() => {
    const nowAt = performance.now();
    const cpu = process.cpuUsage(lastCpu);
    samples.push({
      t: nowAt - startedAt,
      lagP99Ms: Math.max(0, loop.percentile(99) / 1e6 - LOOP_RESOLUTION_MS), // late by more than the timer's own resolution
      lagMaxMs: Math.max(0, loop.max / 1e6 - LOOP_RESOLUTION_MS),
      cpu: (cpu.user + cpu.system) / 1000 / (nowAt - lastAt), // share of ONE core
    });
    loop.reset();
    lastCpu = process.cpuUsage();
    lastAt = nowAt;
  }, POLL_MS);
  return { samples, stop: () => { clearInterval(timer); loop.disable(); } };
}

// params: { teams, spectators, durationSeconds, rampSeconds, answersPerMinute, mode }
async function runLoad({ baseUrl, params, fetchImpl = fetch, random = Math.random, pollMs = POLL_MS }) {
  const startedAt = performance.now();
  const records = [];
  const userEvents = [];
  const http = createHttp({ baseUrl, startedAt, records, fetchImpl });
  const durationMs = params.durationSeconds * 1000;
  const rampMs = params.rampSeconds * 1000;
  const watcher = watchGenerator(startedAt);
  const joined = [];
  const jitter = (ms) => ms * (0.9 + random() * 0.2);
  const elapsed = () => performance.now() - startedAt;
  const users = (delta) => userEvents.push({ t: elapsed(), delta });
  const startWallMs = Date.now();

  const pageLoad = (names) => Promise.all(names.map((path) => http(`GET ${path}`, 'GET', path)));

  async function spectator(offsetMs) {
    await sleep(offsetMs);
    if (elapsed() >= durationMs) return;
    users(+1);
    try {
      await pageLoad(STATIC.view);
      await http('GET /api/me', 'GET', '/api/me');
      while (elapsed() < durationMs) {
        await http('GET /api/scoreboard', 'GET', '/api/scoreboard');
        await sleep(jitter(pollMs));
      }
    } finally {
      users(-1);
    }
  }

  async function team(index, offsetMs) {
    await sleep(offsetMs);
    if (elapsed() >= durationMs) return;
    users(+1);
    try {
      await pageLoad(STATIC.view);
      const name = `${TEAM_PREFIX}${String(index + 1).padStart(3, '0')}`;
      const join = await http('POST /api/join', 'POST', '/api/join', { body: { name } });
      if (join.status !== 200) return;
      joined.push(name);
      const cookie = join.cookie;
      await pageLoad(STATIC.play);

      const answered = new Set();
      const photoSent = new Set();
      const answerChance = (params.answersPerMinute * pollMs) / 60000; // per refresh
      let tick = 0;
      while (elapsed() < durationMs) {
        await sleep(jitter(pollMs));
        if (elapsed() >= durationMs) break;
        tick += 1;
        const [, game] = await Promise.all([
          http('GET /api/me', 'GET', '/api/me', { cookie }),
          http('GET /api/game', 'GET', '/api/game'),
        ]);
        if (tick % 2 === 0) await http('GET /api/scoreboard', 'GET', '/api/scoreboard');
        const zones = game.json?.zones ?? []; // only sent while the game is in progress
        if (params.mode !== 'full' || zones.length === 0 || random() >= answerChance) continue;

        const next = zones.flatMap((zone) => zone.questions.filter((q) => q.type !== 'photo').map((q) => ({ zone, q }))).find(({ zone, q }) => !answered.has(`${zone.key}#${q.id}`));
        if (next) {
          answered.add(`${next.zone.key}#${next.q.id}`);
          await http('POST /api/answer', 'POST', '/api/answer', { cookie, body: { zone: next.zone.key, question: next.q.id, answer: answerFor(next.q.type) } });
        }
        if (answered.size % 4 === 0 && next) { // a photo now and then
          const photo = zones.flatMap((z) => z.questions.filter((q) => q.type === 'photo').map((q) => ({ zone: z, q }))).find(({ zone, q }) => !photoSent.has(`${zone.key}#${q.id}`));
          if (photo) { // a zone may have several photo challenges, or none
            photoSent.add(`${photo.zone.key}#${photo.q.id}`);
            await http('POST /api/photo', 'POST', '/api/photo', { cookie, body: { zone: photo.zone.key, question: photo.q.id } });
          }
        }
      }
    } finally {
      users(-1);
    }
  }

  const spread = (n, i) => (n <= 1 ? 0 : (rampMs * i) / n); // starts spread evenly over the ramp-up
  const crowd = [
    ...Array.from({ length: params.mode === 'full' ? params.teams : 0 }, (_, i) => team(i, spread(params.teams, i))),
    ...Array.from({ length: params.spectators }, (_, i) => spectator(spread(params.spectators, i))),
  ];
  await Promise.race([Promise.allSettled(crowd), sleep(durationMs + 30_000)]); // everybody stops at the end; a stuck request is cut off
  watcher.stop();

  return {
    records, userEvents, durationMs, startWallMs, endWallMs: Date.now(), joinedTeams: joined,
    generatorSamples: watcher.samples,
    generator: {
      maxLagP99Ms: Math.max(0, ...watcher.samples.map((s) => s.lagP99Ms)),
      maxLagMs: Math.max(0, ...watcher.samples.map((s) => s.lagMaxMs)),
      maxCpu: Math.max(0, ...watcher.samples.map((s) => s.cpu)),
    },
  };
}

module.exports = { runLoad, createHttp, TEAM_PREFIX, POLL_MS, STATIC };
