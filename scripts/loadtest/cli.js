'use strict';
// The load test, start to finish: check the request, make sure it is safe to run against this site, generate the load, clean up
// the teams it made, ask CloudWatch what the servers saw, and write the report. It never changes the game configuration, and it only
// ever removes teams whose names start with "loadtest-".
//
// Exit codes: 0 finished (whatever the verdict; the report says how it went), 1 refused or aborted before any load, 3 finished but
// some test teams could not be removed (the report says which).
const fs = require('node:fs');
const path = require('node:path');
const { runLoad, TEAM_PREFIX } = require('./generator.js');
const { aggregate } = require('./stats.js');
const { judge, SATURATED_LAG_MS, SATURATED_CPU } = require('./verdict.js');
const { estimateCost } = require('./cost.js');
const { fetchServerMetrics } = require('./cloudwatch.js');
const { renderHtml, renderMarkdown } = require('./report.js');

const LIMITS = { teams: 300, spectators: 1500, durationSeconds: 900, answersPerMinute: 12 };
const DEFAULTS = { mode: 'full', teams: 50, spectators: 100, durationSeconds: 300, rampSeconds: 60, answersPerMinute: 2 };

class Abort extends Error {}

// ------------------------------------------------------------------------------------------------ the request

function validateParams(input) {
  const params = { ...DEFAULTS, ...input };
  const problems = [];
  const whole = (name, min, max) => {
    const v = params[name];
    if (!Number.isInteger(v) || v < min || v > max) problems.push(`${name} must be a whole number from ${min} to ${max} (got ${v})`);
  };
  if (!['full', 'spectators-only'].includes(params.mode)) problems.push(`mode must be "full" or "spectators-only" (got ${params.mode})`);
  whole('teams', 0, LIMITS.teams);
  whole('spectators', 0, LIMITS.spectators);
  whole('durationSeconds', 10, LIMITS.durationSeconds);
  whole('rampSeconds', 0, LIMITS.durationSeconds);
  whole('answersPerMinute', 0, LIMITS.answersPerMinute);
  if (params.rampSeconds > params.durationSeconds) problems.push('rampSeconds cannot be longer than durationSeconds');
  if (params.mode === 'full' && params.teams + params.spectators === 0) problems.push('there is nobody to simulate');
  if (params.mode === 'spectators-only' && params.spectators === 0) problems.push('spectators-only needs spectators');
  if (problems.length) throw new Abort(`Cannot run: ${problems.join('; ')}.`);
  return params;
}

function parseArgs(argv, env = process.env) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Abort(`Unexpected argument ${arg}`);
    const [key, inline] = arg.slice(2).split('=');
    flags[key] = inline ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
  }
  const int = (name) => (flags[name] === undefined ? undefined : /^\d+$/.test(flags[name]) ? Number(flags[name]) : NaN);
  const input = {};
  for (const [flag, name] of [['teams', 'teams'], ['spectators', 'spectators'], ['duration', 'durationSeconds'], ['ramp', 'rampSeconds'], ['answers-per-minute', 'answersPerMinute']]) {
    const v = int(flag);
    if (v !== undefined) input[name] = v;
  }
  if (flags.mode) input.mode = flags.mode;
  const site = flags.site ?? env.SITE_URL;
  if (!site) throw new Abort('No site to test: pass --site https://... or set SITE_URL.');
  return {
    site: site.replace(/\/+$/, '') + '/',
    params: validateParams(input),
    out: flags.out ?? 'load-test-report',
    cloudwatch: flags.cloudwatch === 'true',
    metricsDelaySeconds: flags['metrics-delay'] === undefined ? 120 : Number(flags['metrics-delay']),
    passcode: env.ADMIN_PASSCODE || '',
    env,
  };
}

// ------------------------------------------------------------------------------------------------ talking to the site

function createClient(baseUrl, fetchImpl = fetch) {
  let adminCookie = null;
  const call = async (method, p, body) => {
    const res = await fetchImpl(new URL(p, baseUrl), {
      method, redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: { ...(adminCookie ? { cookie: adminCookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* not JSON */ }
    const set = res.headers.getSetCookie?.().map((c) => c.split(';')[0]).find((c) => c.startsWith('hunt_admin='));
    return { status: res.status, json, cookie: set ?? null };
  };
  return {
    call,
    async login(passcode) {
      const res = await call('POST', '/api/admin/login', { passcode });
      if (res.status !== 200 || !res.cookie) return false;
      adminCookie = res.cookie;
      return true;
    },
  };
}

// Admin access (needed to remove the test teams). Returns true when the admin API can be used.
async function adminAccess(client, passcode, log) {
  const session = await client.call('GET', '/api/admin/session');
  if (session.status !== 200) throw new Abort(`The admin API did not answer as expected (status ${session.status}); is this the right site?`);
  if (!session.json.required) { log('The site has no admin passcode set, so no login is needed.'); return true; }
  if (!passcode) throw new Abort('The site needs the admin passcode to clean up afterwards, but none was given (secret ADMIN_PASSCODE). Nothing was run.');
  if (!(await client.login(passcode))) throw new Abort('The admin passcode was not accepted (wrong, or too many recent attempts). Nothing was run.');
  log('Logged in as admin (to remove the test teams afterwards).');
  return true;
}

const teamsOnSite = async (client) => {
  const res = await client.call('GET', '/api/admin/teams');
  if (res.status !== 200) throw new Abort(`Could not list the teams (status ${res.status}). Nothing was run.`);
  return res.json.teams;
};

// Removes only loadtest- teams, ten at a time, then checks. -> { removed, failed, remaining }
async function removeTestTeams(client) {
  const before = (await teamsOnSite(client)).filter((t) => t.name.startsWith(TEAM_PREFIX));
  let removed = 0;
  let failed = 0;
  const queue = [...before];
  await Promise.all(Array.from({ length: 10 }, async () => {
    for (let team = queue.shift(); team; team = queue.shift()) {
      const res = await client.call('DELETE', `/api/admin/teams/${team.number}`);
      if (res.status === 200) removed += 1; else failed += 1;
    }
  }));
  const remaining = (await teamsOnSite(client)).filter((t) => t.name.startsWith(TEAM_PREFIX)).length;
  return { removed, failed, remaining };
}

// Everything that must be true before any load is sent. Returns the game as the site describes it.
async function preflight({ client, params, passcode, log }) {
  const board = await client.call('GET', '/api/scoreboard');
  if (board.status !== 200 || !board.json?.game) throw new Abort(`The site's API did not answer properly (status ${board.status}). Nothing was run.`);
  await adminAccess(client, passcode, log);

  const teams = await teamsOnSite(client);
  const real = teams.filter((t) => !t.name.startsWith(TEAM_PREFIX));
  if (real.length) throw new Abort(`Refusing to run: ${real.length} real team(s) are on the site (for example "${real[0].name}"). The load test only runs on a site with no real teams. Nothing was changed.`);
  const leftovers = teams.length;
  if (leftovers) {
    log(`Removing ${leftovers} leftover test team(s) from an earlier run first.`);
    const result = await removeTestTeams(client);
    if (result.remaining) throw new Abort(`Could not remove the leftover test teams (${result.remaining} remain). Nothing was run.`);
  }

  // The load test recognises its own teams by their names (loadtest-001...), so full mode cannot run when teams have no names.
  if (params.mode === 'full' && board.json.game.teamNames === false) throw new Abort('Full mode needs team names to be on (the test tells its own teams apart by name). Turn them on in the game configuration, or use spectators-only mode. Nothing was run.');
  const status = board.json.game.status;
  if (params.mode === 'full' && status !== 'active') throw new Abort(`Full mode needs the game to be in progress (it is "${status}"). Set up a demo game that has started, or use spectators-only mode. Nothing was run.`);
  // The join code, if one is set: read through the admin session so the test can join its teams. It is passed on to the load
  // generator only (never into the report).
  const config = await client.call('GET', '/api/admin/config');
  return { status, joinCode: config.status === 200 ? config.json?.config?.joinCode ?? '' : '' };
}

// ------------------------------------------------------------------------------------------------ the whole run

async function main({ argv = process.argv.slice(2), env = process.env, fetchImpl = fetch, runAws, log = (m) => console.log(m), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), generate = runLoad } = {}) {
  let options;
  try { options = parseArgs(argv, env); } catch (e) { if (e instanceof Abort) { log(e.message); return 1; } throw e; }
  const { site, params, out, passcode } = options;
  const client = createClient(site, fetchImpl);
  const startedAt = new Date();
  log(`Load test of ${site}: ${params.mode}, ${params.teams} teams, ${params.spectators} spectators, ${params.durationSeconds} s (ramp ${params.rampSeconds} s).`);

  let joinCode = '';
  try { ({ joinCode } = await preflight({ client, params, passcode, log })); } catch (e) {
    if (e instanceof Abort) { log(e.message); return 1; }
    throw e;
  }

  let load;
  let cleanup;
  try {
    log('Sending load...');
    load = await generate({ baseUrl: site, params, joinCode, fetchImpl });
  } finally {
    // Whatever happened, take the test teams away.
    try { cleanup = await removeTestTeams(client); } catch (e) { cleanup = { removed: 0, failed: 0, remaining: -1, error: e.message }; }
  }
  const finishedAt = new Date();
  log(`Load finished. ${cleanup.removed} test team(s) removed${cleanup.remaining ? `; ${cleanup.remaining} still on the site` : ''}.`);

  let server = null;
  if (options.cloudwatch) {
    log(`Waiting ${options.metricsDelaySeconds} s for CloudWatch to catch up...`);
    await sleep(options.metricsDelaySeconds * 1000);
    server = await fetchServerMetrics({ runAws, startMs: load.startWallMs, endMs: load.endWallMs });
  }

  const agg = aggregate(load.records, { durationMs: load.durationMs, userEvents: load.userEvents });
  const generatorHealth = { ...load.generator, saturated: load.generator.maxLagP99Ms > SATURATED_LAG_MS || load.generator.maxCpu > SATURATED_CPU };
  const verdict = judge({ aggregate: agg, params, generator: load.generator, server });
  const writes = load.records.filter((r) => r.label.startsWith('POST ') && r.status === 200).length;
  const cost = estimateCost({ totalRequests: agg.totals.requests, originRequests: agg.totals.originRequests, writes });
  const { env: e } = options;

  const report = {
    meta: {
      site: site.replace(/\/$/, ''), params, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(),
      runUrl: e.GITHUB_SERVER_URL && e.GITHUB_RUN_ID ? `${e.GITHUB_SERVER_URL}/${e.GITHUB_REPOSITORY}/actions/runs/${e.GITHUB_RUN_ID}` : null,
      commit: e.GITHUB_SHA ?? null,
    },
    verdict, totals: agg.totals, endpoints: agg.endpoints, timeline: agg.timeline, cache: agg.cache, firstEvents: agg.firstEvents,
    generator: generatorHealth, server, cost, cleanup,
  };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ ...report, records: load.records.length }, null, 2));
  fs.writeFileSync(path.join(out, 'records.json'), JSON.stringify(load.records));
  fs.writeFileSync(path.join(out, 'report.html'), renderHtml(report));
  const summary = renderMarkdown(report);
  fs.writeFileSync(path.join(out, 'summary.md'), summary);
  log(summary);
  log(`Report written to ${out}/ (report.html, summary.md, report.json, records.json).`);

  if (cleanup.remaining !== 0) { log('WARNING: some test teams are still on the site. Remove teams named loadtest-... in the admin page, or run the test again (it removes leftovers first).'); return 3; }
  return 0;
}

module.exports = { main, parseArgs, validateParams, preflight, removeTestTeams, createClient, LIMITS, DEFAULTS, Abort };
