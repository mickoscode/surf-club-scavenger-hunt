#!/usr/bin/env node
// Checks a deployed site end to end: CloudFront routes /api/* to the right Lambda function, the functions start (their
// dependencies are found), they can read DynamoDB, personal and admin responses are not cached, and the public game
// and results responses carry no answers. Read-only: it never changes any data. Run by deploy.yml after every deploy.
//
//   node scripts/smoke-test.js https://<site address>
//
// runSmoke() returns a list of failures (empty = all good). A deploy takes a moment to reach every CloudFront edge,
// so the whole set is retried a few times before it counts as failed.

const NO_SESSION = `hunt=${'0'.repeat(32)}`; // a well-formed id that belongs to no team
const isJson = (text) => { try { return JSON.parse(text); } catch { return null; } };

const CHECKS = [
  { name: 'the site answers', path: '/', check: (res) => (res.status === 200 ? null : `status ${res.status}`) },
  {
    name: 'API: health', path: '/api/health',
    check: (res, text) => (res.status === 200 && isJson(text)?.ok === true ? null : `status ${res.status}: ${text.slice(0, 100)}`),
  },
  {
    name: 'API: the scoreboard can be read from the database', path: '/api/scoreboard',
    check: (res, text) => {
      const body = isJson(text);
      return res.status === 200 && Array.isArray(body?.teams) && typeof body?.game?.status === 'string' ? null : `status ${res.status}: ${text.slice(0, 100)}`;
    },
  },
  {
    name: 'API: the public game response contains no answers', path: '/api/game',
    check: (res, text) => (res.status !== 200 ? `status ${res.status}` : text.includes('"answer"') ? 'the response contains an "answer" field' : null),
  },
  { name: 'the results page exists', path: '/results/', check: (res) => (res.status === 200 ? null : `status ${res.status}`) },
  {
    name: 'API: results are never sent without a team, and are never cached', path: '/api/results',
    check: (res, text) => {
      const body = isJson(text);
      if (res.status !== 200 || typeof body?.published !== 'boolean' || body?.team !== null) return `status ${res.status}: ${text.slice(0, 100)}`;
      if (/yourAnswer|officialAnswers/.test(text)) return 'the response contains answers for a visitor with no team';
      return (res.headers.get('cache-control') ?? '').includes('no-store') ? null : 'missing Cache-Control: no-store';
    },
  },
  {
    name: 'API: a personal response is never cached', path: '/api/me', headers: { cookie: NO_SESSION },
    check: (res, text) => {
      if (res.status !== 200 || isJson(text)?.team !== null) return `status ${res.status}: ${text.slice(0, 100)}`;
      return (res.headers.get('cache-control') ?? '').includes('no-store') ? null : 'missing Cache-Control: no-store';
    },
  },
  {
    // The admin function runs, and the passcode does what it should. With a passcode set, the admin API must refuse a visitor
    // with no session; with none set (the rollout stage) the admin is open, and this says so as a warning.
    name: 'API: the admin function works and the passcode protects it',
    custom: async (baseUrl, warn) => {
      const get = async (path) => {
        const res = await fetch(new URL(path, baseUrl), { redirect: 'manual', signal: AbortSignal.timeout(15000) });
        const text = await res.text();
        return { res, text, body: isJson(text) };
      };
      const session = await get('/api/admin/session');
      if (session.res.status !== 200 || typeof session.body?.required !== 'boolean') return `session check: status ${session.res.status}: ${session.text.slice(0, 100)}`;
      const config = await get('/api/admin/config');
      if (!(config.res.headers.get('cache-control') ?? '').includes('no-store')) return 'the admin config response is missing Cache-Control: no-store';
      if (session.body.required) {
        return config.res.status === 401 && config.body?.error === 'not-authenticated' ? null : `a passcode is set but the admin API answered a visitor with no session: status ${config.res.status}`;
      }
      warn('The admin passcode is NOT set: the admin pages and API are open to anyone who knows their addresses (set the admin_passcode_hash variable).');
      return config.res.status === 200 && typeof config.body?.status === 'string' ? null : `status ${config.res.status}: ${config.text.slice(0, 100)}`;
    },
  },
];

async function runOnce(baseUrl) {
  const failures = [];
  const warnings = new Set();
  for (const { name, path, headers, check, custom } of CHECKS) {
    try {
      let problem;
      if (custom) {
        problem = await custom(baseUrl, (message) => warnings.add(message));
      } else {
        const res = await fetch(new URL(path, baseUrl), { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
        problem = check(res, await res.text());
      }
      if (problem) failures.push(`${name}: ${problem}`);
    } catch (e) {
      failures.push(`${name}: ${e.message}`);
    }
  }
  return { failures, warnings: [...warnings] };
}

// -> { failures, warnings }. Warnings (like "the admin passcode is not set") do not fail the run.
async function runSmokeDetailed(baseUrl, { attempts = 12, delayMs = 5000 } = {}) {
  let result = { failures: [], warnings: [] };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    result = await runOnce(baseUrl);
    if (result.failures.length === 0) return result;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return result;
}

async function runSmoke(baseUrl, options) {
  return (await runSmokeDetailed(baseUrl, options)).failures;
}

module.exports = { runSmoke, runSmokeDetailed };

if (require.main === module) {
  const url = process.argv[2];
  if (!url) { console.error('usage: node scripts/smoke-test.js https://<site address>'); process.exit(2); }
  runSmokeDetailed(url, { attempts: Number(process.env.SMOKE_ATTEMPTS) || 12 }).then(({ failures, warnings }) => {
    warnings.forEach((w) => console.log(`::warning::${w}`));
    if (failures.length) {
      failures.forEach((f) => console.error(`::error::${f}`));
      process.exit(1);
    }
    console.log(`Smoke test passed: ${CHECKS.length} checks against ${url}`);
  });
}
