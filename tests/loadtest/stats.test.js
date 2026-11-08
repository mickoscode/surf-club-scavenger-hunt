// The load test's numbers: percentiles, buckets, what counts as reaching the API, the moments limits were hit, the verdict and the
// cost. Hand-checkable figures, so a mistake in the maths shows up. Pure functions only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { percentile, latencySummary, categoryOf, reachedOrigin, timeline, firstEvents, aggregate } = require('../../scripts/loadtest/stats.js');
const { judge } = require('../../scripts/loadtest/verdict.js');
const { estimateCost } = require('../../scripts/loadtest/cost.js');

const rec = (t, status = 200, ms = 100, cache = 'miss', label = 'GET /api/me') => ({ t, label, status, ms, cache });

test('percentiles use the nearest rank and handle small and empty lists', () => {
  const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.deepEqual([50, 95, 99, 100].map((p) => percentile(hundred, p)), [50, 95, 99, 100]);
  assert.equal(percentile([7], 99), 7);
  assert.equal(percentile([], 50), null);
  assert.deepEqual(latencySummary([]), { count: 0, min: null, p50: null, p95: null, p99: null, max: null, mean: null });
  assert.deepEqual(latencySummary([30, 10, 20]), { count: 3, min: 10, p50: 20, p95: 30, p99: 30, max: 30, mean: 20 });
});

test('a request is ok, throttled, a server error, never completed, or something else', () => {
  assert.deepEqual([200, 429, 500, 502, 503, 0, 409, 401, 400].map(categoryOf), ['ok', 'throttled', 'serverError', 'serverError', 'serverError', 'network', 'other', 'other', 'other']);
});

test('only requests CloudFront did not answer from its cache, and that completed, count as reaching the API', () => {
  assert.equal(reachedOrigin(rec(0, 200, 1, 'hit')), false);
  assert.equal(reachedOrigin(rec(0, 200, 1, 'miss')), true);
  assert.equal(reachedOrigin(rec(0, 429, 1, 'miss')), true); // a refused request still reached the API
  assert.equal(reachedOrigin(rec(0, 200, 1, 'none')), true); // no CloudFront in front (local runs)
  assert.equal(reachedOrigin(rec(0, 0, 15000, 'none')), false); // it never completed
});

test('the timeline slices the test into 5 second buckets with request rates and users', () => {
  const records = [
    rec(100), rec(4_900), rec(4_999, 200, 100, 'hit'), // bucket 0: 3 requests, 2 reach the API
    rec(5_100, 429), rec(6_000, 200, 300), // bucket 1: 2 requests, one throttled
    rec(12_000, 500, 50), // bucket 2
  ];
  const userEvents = [{ t: 0, delta: 10 }, { t: 5_500, delta: 5 }, { t: 11_000, delta: -15 }];
  const slices = timeline(records, 15_000, userEvents);
  assert.equal(slices.length, 3);
  assert.deepEqual(slices.map((s) => s.requests), [3, 2, 1]);
  assert.deepEqual(slices.map((s) => [s.rps, s.originRps]), [[0.6, 0.4], [0.4, 0.4], [0.2, 0.2]]);
  assert.deepEqual(slices.map((s) => [s.ok, s.throttled, s.serverError]), [[3, 0, 0], [1, 1, 0], [0, 0, 1]]);
  assert.deepEqual(slices.map((s) => s.activeUsers), [10, 15, 0]);
  assert.equal(slices[1].p95, 300);
});

test('the first throttled, failed and slow moments are found with the rate reaching the API then', () => {
  const slices = [
    { t: 0, throttled: 0, serverError: 0, network: 0, p95: 200, originRps: 20, activeUsers: 50 },
    { t: 5000, throttled: 0, serverError: 0, network: 0, p95: 1500, originRps: 40, activeUsers: 90 },
    { t: 10000, throttled: 7, serverError: 0, network: 0, p95: 800, originRps: 55.04, activeUsers: 120 },
    { t: 15000, throttled: 9, serverError: 2, network: 0, p95: 900, originRps: 56, activeUsers: 120 },
  ];
  assert.deepEqual(firstEvents(slices), {
    throttled: { atSeconds: 10, originRps: 55, activeUsers: 120 },
    serverError: { atSeconds: 15, originRps: 56, activeUsers: 120 },
    slow: { atSeconds: 5, originRps: 40, activeUsers: 90 },
  });
  assert.deepEqual(firstEvents([{ t: 0, throttled: 0, serverError: 0, network: 0, p95: 10, originRps: 1, activeUsers: 1 }]), { throttled: null, serverError: null, slow: null });
});

test('aggregate: totals, per endpoint, cache hit rate, failures and peaks', () => {
  const records = [
    rec(0, 200, 100, 'miss', 'GET /api/me'), rec(100, 200, 200, 'miss', 'GET /api/me'), rec(200, 429, 50, 'miss', 'GET /api/me'),
    rec(300, 200, 10, 'hit', 'GET /api/scoreboard'), rec(400, 200, 12, 'hit', 'GET /api/scoreboard'), rec(500, 200, 90, 'miss', 'GET /api/scoreboard'),
    rec(600, 0, 15000, 'none', 'POST /api/join'),
  ];
  const a = aggregate(records, { durationMs: 5000 });
  assert.deepEqual([a.totals.requests, a.totals.ok, a.totals.throttled, a.totals.network, a.totals.failures], [7, 5, 1, 1, 2]);
  assert.equal(Math.round(a.totals.errorRate * 1000), 286);
  assert.equal(a.totals.originRequests, 4); // three misses on /api/me (one throttled) and one on the scoreboard; the join never completed
  assert.deepEqual(a.cache, { hit: 2, miss: 4, none: 1, hitRate: 2 / 6 });
  assert.deepEqual(a.endpoints.map((e) => [e.label, e.requests, e.ok, e.failures]), [['GET /api/me', 3, 2, 1], ['GET /api/scoreboard', 3, 3, 0], ['POST /api/join', 1, 0, 1]]);
  assert.deepEqual(a.endpoints[0].byStatus, { 200: 2, 429: 1 });
  assert.equal(a.totals.peakRps, 7 / 5);
  assert.equal(a.totals.latency.max, 15000);
});

// ---------------------------------------------------------------------------------------------- verdict

const params = { teams: 50, spectators: 100 };
const run = (records, extra = {}) => judge({ aggregate: aggregate(records, { durationMs: 20_000, userEvents: [{ t: 0, delta: 150 }] }), params, ...extra });
const healthy = Array.from({ length: 200 }, (_, i) => rec(i * 50, 200, 80 + (i % 5) * 10, i % 3 ? 'hit' : 'miss'));

test('a clean run is good and says how much of the limit was used', () => {
  const v = run(healthy, { server: { stage: { rateLimit: 50, burstLimit: 200 } } });
  assert.equal(v.level, 'good');
  assert.match(v.headline, /Handled 50 teams and 100 spectators with no errors/);
  assert.match(v.details.join(' '), /of the API's limit of 50 requests a second/);
});

test('throttling is the "limits" verdict, naming when it began, the rate then, and what was affected', () => {
  const records = [...healthy, ...Array.from({ length: 20 }, (_, i) => rec(10_000 + i * 10, 429, 40, 'miss', 'POST /api/answer'))];
  const v = run(records, { server: { stage: { rateLimit: 50, burstLimit: 200 } } });
  assert.equal(v.level, 'limits');
  assert.match(v.headline, /Reached the request limit/);
  const text = v.details.join(' ');
  assert.match(text, /20 requests .* refused with 429/);
  assert.match(text, /first was 10 seconds in/);
  assert.match(text, /POST \/api\/answer \(20\)/);
  assert.match(text, /configured limit is 50 requests a second \(burst 200\)/);
  assert.match(text, /worst-case cost/);
});

test('server errors and requests that never completed are a "problem", and are not blamed on the limit', () => {
  const v = run([...healthy, rec(8_000, 502, 30), rec(9_000, 503, 30), rec(9_500, 0, 15000, 'none')]);
  assert.equal(v.level, 'problem');
  assert.match(v.details.join(' '), /2 server errors \(5xx\) and 1 requests that never completed/);
  assert.match(v.details.join(' '), /not the request limit/);
});

test('an unexpected status is reported with its code', () => {
  const v = run([...healthy, rec(1_000, 409), rec(2_000, 409), rec(3_000, 401)]);
  assert.equal(v.level, 'problem');
  assert.match(v.details.join(' '), /409 x 2/);
  assert.match(v.details.join(' '), /401 x 1/);
});

test('slow but fine is a "limits" verdict too, and a run with no requests is a problem', () => {
  assert.equal(run(Array.from({ length: 50 }, (_, i) => rec(i * 100, 200, 2500))).level, 'limits');
  assert.equal(run([]).level, 'problem');
});

test('when the test machine itself was overloaded the verdict says nothing about the site', () => {
  const failing = [...healthy, rec(5_000, 502, 30)];
  assert.equal(run(failing, { generator: { maxLagP99Ms: 450, maxCpu: 0.5 } }).level, 'inconclusive');
  assert.equal(run(failing, { generator: { maxLagP99Ms: 20, maxCpu: 0.97 } }).level, 'inconclusive');
  assert.equal(run(failing, { generator: { maxLagP99Ms: 20, maxCpu: 0.5 } }).level, 'problem'); // a healthy generator: the errors are the site's
});

// ---------------------------------------------------------------------------------------------- cost

test('the cost estimate adds up from the request counts, and a bigger run costs more', () => {
  const small = estimateCost({ totalRequests: 100_000, originRequests: 20_000, writes: 2_000 });
  const big = estimateCost({ totalRequests: 400_000, originRequests: 80_000, writes: 8_000 });
  assert.equal(small.lines.length, 5);
  assert.ok(Math.abs(small.totalUsd - small.lines.reduce((s, l) => s + l.usd, 0)) < 1e-12);
  assert.ok(big.totalUsd > small.totalUsd * 3.9 && big.totalUsd < small.totalUsd * 4.1);
  assert.ok(small.totalUsd > 0.05 && small.totalUsd < 0.5, `unexpected estimate $${small.totalUsd}`); // cents, not dollars
  assert.equal(estimateCost({ totalRequests: 0, originRequests: 0, writes: 0 }).totalUsd, 0);
  assert.match(small.note, /estimate/i);
});
