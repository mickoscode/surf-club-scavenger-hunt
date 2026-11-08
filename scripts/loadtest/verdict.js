'use strict';
// A plain-language verdict on a load test run: what happened and what it means. Pure function.
// level: 'good' (handled it), 'limits' (a limit was reached: the answer the test is for), 'problem' (errors that are not a
// limit), 'inconclusive' (the machine making the load was the bottleneck, so the result says nothing about the site).

const SLOW_P95_MS = 2000;
const MAX_NETWORK_ERROR_RATE = 0.005;
const SATURATED_LAG_MS = 200; // the load generator's own event loop was this late (99th percentile)
const SATURATED_CPU = 0.9; // of one core

const pct = (x) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
const rps = (x) => `${Math.round(x)}`;

// aggregate: from stats.aggregate; params: what was asked for; generator: { maxLagP99Ms, maxCpu };
// server: { stage: { rateLimit, burstLimit } } when known.
function judge({ aggregate, params, generator = {}, server = null }) {
  const { totals, endpoints, firstEvents } = aggregate;
  const crowd = `${params.teams} teams and ${params.spectators} spectators`;
  const details = [];

  if ((generator.maxLagP99Ms ?? 0) > SATURATED_LAG_MS || (generator.maxCpu ?? 0) > SATURATED_CPU) {
    return {
      level: 'inconclusive',
      headline: 'The test machine was the bottleneck, so this run does not show the site\'s limits.',
      details: [
        `The machine generating the load was overloaded (its event loop ran up to ${Math.round(generator.maxLagP99Ms ?? 0)} ms late, CPU up to ${pct(generator.maxCpu ?? 0)} of a core). Slow or failed requests may be the test's fault.`,
        'Run again with fewer teams or spectators, or a longer ramp-up.',
      ],
    };
  }
  if (totals.requests === 0) return { level: 'problem', headline: 'No requests were made.', details: ['Check the site address and the inputs.'] };

  const share = (n) => pct(n / totals.requests);
  if (totals.throttled > 0) {
    const e = firstEvents.throttled;
    const limit = server?.stage?.rateLimit ? `the configured limit is ${server.stage.rateLimit} requests a second (burst ${server.stage.burstLimit})` : 'the limit is the API\'s request throttle';
    details.push(`${totals.throttled} requests (${share(totals.throttled)}) were refused with 429 Too Many Requests.`);
    if (e) details.push(`The first was ${e.atSeconds} seconds in, when about ${rps(e.originRps)} requests a second were reaching the API with ${e.activeUsers} users active. The busiest moment reached about ${rps(totals.peakOriginRps)} requests a second at the API; ${limit}.`);
    const hit = endpoints.filter((x) => x.throttled > 0).map((x) => `${x.label} (${x.throttled})`);
    if (hit.length) details.push(`Throttled: ${hit.join(', ')}.`);
    details.push('Players would see "Could not refresh" messages until the rate eased. Raising the limit (api_throttle_rate_limit) raises the worst-case cost: see the runbook before changing it.');
    return { level: 'limits', headline: `Reached the request limit with ${crowd}: ${share(totals.throttled)} of requests were throttled.`, details };
  }
  if (totals.serverError > 0 || totals.network / totals.requests > MAX_NETWORK_ERROR_RATE) {
    const e = firstEvents.serverError;
    details.push(`${totals.serverError} server errors (5xx) and ${totals.network} requests that never completed (${share(totals.serverError + totals.network)} of all).`);
    if (e) details.push(`The first was ${e.atSeconds} seconds in, at about ${rps(e.originRps)} requests a second at the API.`);
    const bad = endpoints.filter((x) => x.serverError + x.network > 0).map((x) => `${x.label} (${x.serverError + x.network})`);
    if (bad.length) details.push(`Affected: ${bad.join(', ')}.`);
    details.push('This is not the request limit: look at the Lambda and DynamoDB numbers below (throttles, errors, concurrency).');
    return { level: 'problem', headline: `Errors with ${crowd}: ${share(totals.serverError + totals.network)} of requests failed.`, details };
  }
  if (totals.other > 0) {
    const odd = Object.entries(totals.byStatus).filter(([status]) => ![200, 429].includes(Number(status)) && Number(status) < 500 && Number(status) > 0).map(([status, n]) => `${status} x ${n}`);
    return {
      level: 'problem', headline: `Unexpected answers with ${crowd}: ${totals.other} requests got an unexpected status.`,
      details: [`Statuses: ${odd.join(', ')}. The test expects 200 for everything it sends.`],
    };
  }
  if (totals.latency.p95 > SLOW_P95_MS) {
    const e = firstEvents.slow;
    details.push(`95% of requests took under ${totals.latency.p95} ms, but ${SLOW_P95_MS} ms is slow for a phone on mobile data.`);
    if (e) details.push(`It first slowed down ${e.atSeconds} seconds in, at about ${rps(e.originRps)} requests a second at the API.`);
    return { level: 'limits', headline: `Slow with ${crowd}, though nothing failed.`, details };
  }
  details.push(`${totals.requests} requests, none failed. Typical response ${totals.latency.p50} ms, 95% under ${totals.latency.p95} ms, slowest ${totals.latency.max} ms.`);
  details.push(`The busiest moment sent about ${rps(totals.peakRps)} requests a second, of which about ${rps(totals.peakOriginRps)} reached the API (the rest came from CloudFront's cache).`);
  if (server?.stage?.rateLimit) details.push(`That is ${pct(totals.peakOriginRps / server.stage.rateLimit)} of the API's limit of ${server.stage.rateLimit} requests a second. Try more teams or spectators to find where the limit bites.`);
  return { level: 'good', headline: `Handled ${crowd} with no errors.`, details };
}

module.exports = { judge, SLOW_P95_MS, SATURATED_LAG_MS, SATURATED_CPU, MAX_NETWORK_ERROR_RATE };
