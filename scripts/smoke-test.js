#!/usr/bin/env node
// Checks a deployed site end to end: CloudFront routes /api/* to the right Lambda function, the functions start (their
// dependencies are found), they can read DynamoDB, personal and admin responses are not cached, and the public game
// response carries no answers. Read-only: it never changes any data. Run by deploy.yml after every deploy.
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
  {
    name: 'API: a personal response is never cached', path: '/api/me', headers: { cookie: NO_SESSION },
    check: (res, text) => {
      if (res.status !== 200 || isJson(text)?.team !== null) return `status ${res.status}: ${text.slice(0, 100)}`;
      return (res.headers.get('cache-control') ?? '').includes('no-store') ? null : 'missing Cache-Control: no-store';
    },
  },
  {
    name: 'API: the admin function works and its responses are never cached', path: '/api/admin/config',
    check: (res, text) => {
      if (res.status !== 200 || typeof isJson(text)?.status !== 'string') return `status ${res.status}: ${text.slice(0, 100)}`;
      return (res.headers.get('cache-control') ?? '').includes('no-store') ? null : 'missing Cache-Control: no-store';
    },
  },
];

async function runOnce(baseUrl) {
  const failures = [];
  for (const { name, path, headers, check } of CHECKS) {
    try {
      const res = await fetch(new URL(path, baseUrl), { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
      const problem = check(res, await res.text());
      if (problem) failures.push(`${name}: ${problem}`);
    } catch (e) {
      failures.push(`${name}: ${e.message}`);
    }
  }
  return failures;
}

async function runSmoke(baseUrl, { attempts = 12, delayMs = 5000 } = {}) {
  let failures = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    failures = await runOnce(baseUrl);
    if (failures.length === 0) return [];
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return failures;
}

module.exports = { runSmoke };

if (require.main === module) {
  const url = process.argv[2];
  if (!url) { console.error('usage: node scripts/smoke-test.js https://<site address>'); process.exit(2); }
  runSmoke(url, { attempts: Number(process.env.SMOKE_ATTEMPTS) || 12 }).then((failures) => {
    if (failures.length) {
      failures.forEach((f) => console.error(`::error::${f}`));
      process.exit(1);
    }
    console.log(`Smoke test passed: ${CHECKS.length} checks against ${url}`);
  });
}
