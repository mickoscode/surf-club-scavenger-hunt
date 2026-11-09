// The load test end to end against the real site code (the real site code and in-memory store): safety guards, cleanup, the passcode, the
// verdict when the API refuses requests, the report files, and the report's escaping. Short runs with fast polling.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSiteServer } = require('../../scripts/dev-server.js');
const { createMemoryStore } = require('../../api/store/memory.js');
const { createMemoryBlobs } = require('../../api/store/blobs.js');
const { createEvents } = require('../../api/lib/events.js');
const { hashPasscode } = require('../../api/lib/passcode.js');
const { GAME, CONFIG, START } = require('../api/helpers.js');
const { main, parseArgs, validateParams } = require('../../scripts/loadtest/cli.js');
const { runLoad } = require('../../scripts/loadtest/generator.js');
const { renderHtml, renderMarkdown } = require('../../scripts/loadtest/report.js');
const { fetchServerMetrics, summarise } = require('../../scripts/loadtest/cloudwatch.js');

const root = path.join(__dirname, '..', '..');
const PASSCODE = 'k7m2q-xd93p-wn4tr-h8jcf';

// The pages the load test asks for, without running build.sh (other test files rebuild dist/ at the same time).
let files;
function siteFiles() {
  if (files) return files;
  files = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'loadtest-site-'));
  fs.cpSync(path.join(root, 'web'), files, { recursive: true });
  fs.mkdirSync(path.join(files, 'vendor', 'bootstrap'), { recursive: true });
  fs.writeFileSync(path.join(files, 'vendor', 'bootstrap', 'bootstrap.min.css'), '/* stub */');
  fs.writeFileSync(path.join(files, '404.html'), '<!doctype html><title>404</title>');
  return files;
}

async function startSite({ now = START + 60_000, intercept, passcode = false } = {}) {
  const distDir = siteFiles();
  const clock = { now };
  const adminPasscodeHash = passcode ? await hashPasscode(PASSCODE, { cost: { N: 1024, r: 8, p: 1 } }) : '';
  const store = createMemoryStore();
  // The game is stored as an event, as a real one is; saving the configuration (below) loads the game from it.
  const events = createEvents({ blobs: createMemoryBlobs(), siteBlobs: createMemoryBlobs(), newId: () => Math.random().toString(16).slice(2, 10) });
  const server = createSiteServer({ store, now: () => clock.now, distDir, intercept, adminPasscodeHash, events });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, p, body, cookie) => {
    const res = await fetch(url + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json(), cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('hunt')) };
  };
  let adminCookie;
  if (passcode) adminCookie = (await api('POST', '/api/admin/login', { passcode: PASSCODE })).cookie;
  let prepared = false;
  const admin = async (method, p, body) => {
    if (method === 'PUT' && p === '/api/admin/config' && body.event === undefined) { // the fixture event, made once
      if (!prepared) {
        const picture = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]).toString('base64');
        assert.equal((await events.putQuestions('fixture', structuredClone(GAME), Buffer.byteLength(JSON.stringify(GAME)))).ok, true);
        for (const zone of Object.keys(GAME)) assert.equal((await events.putMap('fixture', zone.replace(/\s+/g, '-'), { thumb: picture, full: picture })).ok, true);
        prepared = true;
      }
      body = { ...body, event: 'fixture' };
    }
    return api(method, p, body, adminCookie);
  };
  return { url, clock, api, admin, configure: () => admin('PUT', '/api/admin/config', CONFIG), teams: async () => (await admin('GET', '/api/admin/teams')).json.teams, close: () => new Promise((r) => server.close(r)) };
}

const outDir = () => fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'loadtest-'));
const FAST = ['--duration', '10', '--ramp', '2', '--metrics-delay', '0'];
async function run(site, extra = [], env = {}) {
  const out = outDir();
  const lines = [];
  const code = await main({
    argv: ['--site', site.url, ...FAST, '--out', out, ...extra], env,
    log: (m) => lines.push(m), sleep: async () => {},
    generate: (o) => runLoad({ ...o, pollMs: 200 }),
  });
  const read = (f) => fs.readFileSync(path.join(out, f), 'utf8');
  return { code, lines, out, json: () => JSON.parse(read('report.json')), read };
}

test('parameters are validated and capped, and the site is required', () => {
  assert.equal(validateParams({}).teams, 50);
  for (const bad of [{ teams: 301 }, { spectators: 1501 }, { durationSeconds: 901 }, { rampSeconds: 400, durationSeconds: 300 }, { answersPerMinute: 13 }, { teams: -1 }, { mode: 'nope' }, { teams: 0, spectators: 0 }, { mode: 'spectators-only', spectators: 0 }]) {
    assert.throws(() => validateParams(bad), /Cannot run/, JSON.stringify(bad));
  }
  assert.throws(() => parseArgs([], {}), /No site/);
  assert.equal(parseArgs(['--teams', '7', '--cloudwatch'], { SITE_URL: 'https://x.test' }).params.teams, 7);
  assert.throws(() => parseArgs(['--teams', 'abc'], { SITE_URL: 'https://x.test' }), /Cannot run/);
});

test('a healthy full run joins teams, answers, cleans up after itself and writes the report', async () => {
  const site = await startSite();
  try {
    await site.configure();
    const r = await run(site, ['--teams', '6', '--spectators', '4', '--answers-per-minute', '12']);
    assert.equal(r.code, 0, r.lines.join('\n'));
    const report = r.json();
    assert.equal(report.verdict.level, 'good', report.verdict.details.join(' '));
    assert.equal(report.cleanup.remaining, 0);
    assert.ok(report.cleanup.removed >= 1 && report.cleanup.removed <= 6);
    assert.deepEqual(await site.teams(), []); // nothing left behind
    assert.ok(report.endpoints.some((e) => e.label === 'POST /api/join'));
    for (const f of ['report.html', 'summary.md', 'records.json']) assert.ok(r.read(f).length > 100, f);
    assert.match(r.read('report.html'), /<svg/);
  } finally { await site.close(); }
});

test('it refuses to run when a real team exists, and leaves everything untouched', async () => {
  const site = await startSite();
  try {
    await site.configure();
    await site.api('POST', '/api/join', { name: 'Sea Dogs' });
    await site.api('POST', '/api/join', { name: 'loadtest-001' });
    const r = await run(site, ['--teams', '3']);
    assert.equal(r.code, 1);
    assert.match(r.lines.join('\n'), /real team/);
    assert.deepEqual((await site.teams()).map((t) => t.name).sort(), ['Sea Dogs', 'loadtest-001']);
  } finally { await site.close(); }
});

test('leftover test teams from an earlier run are removed first, and only those', async () => {
  const site = await startSite();
  try {
    await site.configure();
    await site.api('POST', '/api/join', { name: 'loadtest-001' });
    await site.api('POST', '/api/join', { name: 'loadtest-002' });
    const r = await run(site, ['--teams', '2']);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.match(r.lines.join('\n'), /Removing 2 leftover/);
    assert.deepEqual(await site.teams(), []);
  } finally { await site.close(); }
});

test('with a join code set the test reads it through its admin session and joins with it, and the code is not in the report', async () => {
  const site = await startSite();
  try {
    await site.admin('PUT', '/api/admin/config', { ...CONFIG, joinCode: 'LOAD99' });
    const r = await run(site, ['--teams', '3']);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.ok(r.json().endpoints.find((e) => e.label === 'POST /api/join').ok >= 1); // the joins were accepted
    assert.equal(r.json().verdict.level, 'good');
    for (const file of ['report.json', 'report.html', 'summary.md', 'records.json']) assert.equal(r.read(file).toUpperCase().includes('LOAD99'), false, file);
    assert.deepEqual(await site.teams(), []);
  } finally { await site.close(); }
});

test('full mode refuses to run when team names are off, and spectators-only still works', async () => {
  const site = await startSite();
  try {
    await site.admin('PUT', '/api/admin/config', { ...CONFIG, teamNames: false });
    const full = await run(site, ['--teams', '2']);
    assert.equal(full.code, 1);
    assert.match(full.lines.join('\n'), /team names/);
    assert.deepEqual(await site.teams(), []);
    assert.equal((await run(site, ['--mode', 'spectators-only', '--spectators', '3'])).code, 0);
  } finally { await site.close(); }
});

test('full mode needs a game in progress; spectators-only works any time and joins no teams', async () => {
  const site = await startSite();
  try {
    const none = await run(site, ['--teams', '2']); // not configured at all
    assert.equal(none.code, 1);
    assert.match(none.lines.join('\n'), /needs the game to be in progress/);
    const spectators = await run(site, ['--mode', 'spectators-only', '--spectators', '5']);
    assert.equal(spectators.code, 0, spectators.lines.join('\n'));
    assert.ok(!spectators.json().endpoints.some((e) => e.label === 'POST /api/join'));
  } finally { await site.close(); }
});

test('a site with a passcode: the right one works, a wrong or missing one stops before any load', async () => {
  const site = await startSite({ passcode: true });
  try {
    await site.configure();
    const ok = await run(site, ['--teams', '2'], { ADMIN_PASSCODE: PASSCODE });
    assert.equal(ok.code, 0, ok.lines.join('\n'));
    const wrong = await run(site, ['--teams', '2'], { ADMIN_PASSCODE: 'wrong' });
    assert.equal(wrong.code, 1);
    assert.match(wrong.lines.join('\n'), /not accepted/);
    const missing = await run(site, ['--teams', '2'], {});
    assert.equal(missing.code, 1);
    assert.match(missing.lines.join('\n'), /needs the admin passcode/);
    assert.ok(!fs.existsSync(path.join(wrong.out, 'report.json'))); // aborted: no report, no load
  } finally { await site.close(); }
});

test('when the API refuses requests with 429 the verdict says a limit was reached', async () => {
  let count = 0;
  const site = await startSite({ intercept: (req) => (req.path === '/api/scoreboard' && ++count > 3 ? { status: 429, headers: {}, cookies: [], body: { error: 'throttled' } } : undefined) });
  try {
    await site.configure();
    const r = await run(site, ['--mode', 'spectators-only', '--spectators', '5']);
    assert.equal(r.code, 0);
    assert.equal(r.json().verdict.level, 'limits');
    assert.ok(r.json().totals.throttled > 0);
    assert.match(r.read('summary.md'), /limit/i);
  } finally { await site.close(); }
});

test('the report escapes everything it prints', () => {
  const evil = '<script>alert(1)</script>';
  const base = {
    meta: { site: evil, params: { mode: 'full', teams: 1, spectators: 1, durationSeconds: 10, rampSeconds: 1, answersPerMinute: 1 }, startedAt: evil, finishedAt: evil, runUrl: 'x"><b>', commit: evil },
    verdict: { level: 'good', headline: evil, details: [evil] },
    totals: { requests: 1, ok: 1, throttled: 0, serverError: 0, network: 0, other: 0, byStatus: { 200: 1 }, peakRps: 1, peakOriginRps: 1, latency: { p50: 1, p95: 1, p99: 1, max: 1 } },
    endpoints: [{ label: evil, requests: 1, ok: 1, failures: 0, latency: { p50: 1, p95: 1, p99: 1, max: 1 } }],
    timeline: [{ t: 0, requests: 1, ok: 1, throttled: 0, serverError: 0, network: 0, other: 0, rps: 0.2, originRps: 0.2, p50: 1, p95: 1, activeUsers: 1 }],
    cache: { hit: 0, miss: 1, none: 0, hitRate: 0 }, firstEvents: { throttled: null, serverError: null, slow: null },
    generator: { maxLagP99Ms: 0, maxCpu: 0, saturated: false },
    server: { available: false, errors: [evil] }, cost: { lines: [{ name: evil, count: 1, usd: 0 }], totalUsd: 0, note: evil }, cleanup: { skipped: evil },
  };
  const html = renderHtml(base);
  assert.ok(!html.includes('<script>alert') && !html.includes('<b>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(renderMarkdown(base).length > 100);
});

test('CloudWatch numbers are totalled, and a failure only leaves a gap', async () => {
  const s = summarise([
    { Id: 'api_count', Values: [10, 20] }, { Id: 'api_4xx', Values: [3] }, { Id: 'api_latency', Values: [80, 120.44] },
    { Id: 'fn_public_invocations', Values: [5, 5] }, { Id: 'fn_public_concurrency', Values: [2, 7] },
  ]);
  assert.equal(s.apiGateway.requests, 30);
  assert.equal(s.apiGateway.clientErrors, 3);
  assert.equal(s.apiGateway.latencyP95Ms, 120.4);
  assert.deepEqual([s.lambda.public.invocations, s.lambda.public.peakConcurrency], [10, 7]);

  const calls = [];
  const runAws = async (args) => {
    calls.push(args[0] + ' ' + args[1]);
    if (args[0] === 'apigatewayv2' && args[1] === 'get-apis') return { Items: [{ Name: 'scavenger-hunt', ApiId: 'abc' }] };
    if (args[1] === 'get-stage') return { DefaultRouteSettings: { ThrottlingRateLimit: 50, ThrottlingBurstLimit: 200 } };
    throw new Error('AccessDenied');
  };
  const m = await fetchServerMetrics({ runAws, startMs: 0, endMs: 1000 });
  assert.equal(m.available, true);
  assert.deepEqual(m.stage, { rateLimit: 50, burstLimit: 200 });
  assert.equal(m.apiGateway, null);
  assert.equal(m.errors.length, 2);
  assert.equal((await fetchServerMetrics({ runAws: async () => { throw new Error('no credentials'); }, startMs: 0, endMs: 1 })).available, false);
});
