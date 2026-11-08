'use strict';
// Turns the raw record of every request the load test made into the numbers of the report. Pure functions.
// A record is { t, label, status, ms, cache }: t = milliseconds since the test started, label = which kind of request,
// status = the HTTP status (0 = the request never completed: a timeout or a network error), ms = how long it took, and
// cache = 'hit' when CloudFront answered from its cache, 'miss' when it asked the API, 'none' when there was no CloudFront header.

const BUCKET_MS = 5000;

// Nearest-rank percentile of an ascending list.
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

function latencySummary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return { count: 0, min: null, p50: null, p95: null, p99: null, max: null, mean: null };
  const round = (n) => Math.round(n);
  return {
    count: sorted.length,
    min: round(sorted[0]),
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[sorted.length - 1]),
    mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
  };
}

// What happened to a request: 'ok' (200), 'throttled' (429), 'serverError' (5xx), 'network' (it never completed), or 'other' (any other status).
function categoryOf(status) {
  if (status === 200) return 'ok';
  if (status === 429) return 'throttled';
  if (status >= 500) return 'serverError';
  if (status === 0) return 'network';
  return 'other';
}

// Requests that reached the API (or at least left CloudFront for it): not answered from CloudFront's cache, and completed.
// This is the rate the API's own limit applies to.
const reachedOrigin = (record) => record.cache !== 'hit' && record.status !== 0;

function emptyCounts() {
  return { requests: 0, ok: 0, throttled: 0, serverError: 0, network: 0, other: 0, byStatus: {} };
}

function count(into, record) {
  into.requests += 1;
  into[categoryOf(record.status)] += 1;
  into.byStatus[record.status] = (into.byStatus[record.status] ?? 0) + 1;
}

// bucketMs-long slices of the test: what was sent, what came back, how long it took, how many users were active.
function timeline(records, durationMs, userEvents = [], bucketMs = BUCKET_MS) {
  const buckets = Math.max(1, Math.ceil(durationMs / bucketMs));
  const slices = Array.from({ length: buckets }, (_, i) => ({ t: i * bucketMs, latencies: [], origin: 0, ...emptyCounts() }));
  for (const record of records) {
    const slice = slices[Math.min(buckets - 1, Math.max(0, Math.floor(record.t / bucketMs)))];
    count(slice, record);
    slice.latencies.push(record.ms);
    if (reachedOrigin(record)) slice.origin += 1;
  }
  return slices.map((slice) => {
    const sorted = slice.latencies.sort((a, b) => a - b);
    const active = userEvents.reduce((n, e) => (e.t < slice.t + bucketMs ? n + e.delta : n), 0);
    return {
      t: slice.t, requests: slice.requests, ok: slice.ok, throttled: slice.throttled, serverError: slice.serverError, network: slice.network, other: slice.other,
      rps: slice.requests / (bucketMs / 1000), originRps: slice.origin / (bucketMs / 1000),
      p50: sorted.length ? Math.round(percentile(sorted, 50)) : null, p95: sorted.length ? Math.round(percentile(sorted, 95)) : null,
      activeUsers: Math.max(0, active),
    };
  });
}

// The moments that matter: when the first request was throttled, the first server error, the first slow stretch, and the request
// rates reaching the API at those moments.
function firstEvents(slices, slowMs = 1000) {
  const find = (predicate) => slices.find(predicate);
  const describe = (slice) => (slice ? { atSeconds: Math.round(slice.t / 1000), originRps: Math.round(slice.originRps * 10) / 10, activeUsers: slice.activeUsers } : null);
  return {
    throttled: describe(find((s) => s.throttled > 0)),
    serverError: describe(find((s) => s.serverError > 0 || s.network > 0)),
    slow: describe(find((s) => s.p95 !== null && s.p95 > slowMs)),
  };
}

// Everything the report needs from the raw records.
function aggregate(records, { durationMs, userEvents = [] }) {
  const totals = emptyCounts();
  const endpoints = new Map();
  const cache = { hit: 0, miss: 0, none: 0 };
  let origin = 0;
  for (const record of records) {
    count(totals, record);
    if (!endpoints.has(record.label)) endpoints.set(record.label, { label: record.label, latencies: [], ...emptyCounts() });
    const endpoint = endpoints.get(record.label);
    count(endpoint, record);
    endpoint.latencies.push(record.ms);
    cache[record.cache === 'hit' ? 'hit' : record.cache === 'miss' ? 'miss' : 'none'] += 1;
    if (reachedOrigin(record)) origin += 1;
  }
  const slices = timeline(records, durationMs, userEvents);
  const failures = totals.throttled + totals.serverError + totals.network + totals.other;
  return {
    totals: {
      ...totals,
      failures,
      errorRate: totals.requests ? failures / totals.requests : 0,
      originRequests: origin,
      peakRps: Math.max(0, ...slices.map((s) => s.rps)),
      peakOriginRps: Math.max(0, ...slices.map((s) => s.originRps)),
      latency: latencySummary(records.map((r) => r.ms)),
    },
    endpoints: [...endpoints.values()]
      .map(({ latencies, ...rest }) => ({ ...rest, failures: rest.requests - rest.ok, latency: latencySummary(latencies) }))
      .sort((a, b) => b.requests - a.requests),
    timeline: slices,
    cache: { ...cache, hitRate: cache.hit + cache.miss > 0 ? cache.hit / (cache.hit + cache.miss) : null },
    firstEvents: firstEvents(slices),
  };
}

module.exports = { BUCKET_MS, percentile, latencySummary, categoryOf, reachedOrigin, timeline, firstEvents, aggregate };
