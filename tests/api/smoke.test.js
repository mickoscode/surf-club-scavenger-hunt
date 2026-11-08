// The post-deploy smoke test runs against the live site after every deploy, so it must pass a healthy backend and
// fail for each way a deploy can be broken. Here it runs against the real API code over real HTTP (in-memory store).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApiHandler } = require('../../scripts/dev-server.js');
const { runSmoke } = require('../../scripts/smoke-test.js');

const respond = (status, body, headers = {}) => ({ status, headers: { 'content-type': 'application/json', ...headers }, cookies: [], body });

// A stand-in for the live site: "/" is a page, /api/* is the real API, and `intercept` can break one response.
async function withSite(intercept, fn) {
  const api = createApiHandler({ intercept });
  const server = http.createServer((req, res) => (req.url.startsWith('/api/') ? api(req, res) : res.writeHead(200).end('<html></html>')));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}
const smoke = (url) => runSmoke(url, { attempts: 1 });

test('a healthy deploy passes every check', async () => {
  await withSite(undefined, async (url) => assert.deepEqual(await smoke(url), []));
});

test('a public game response that carries an answer fails', async () => {
  const intercept = (req) => (req.path === '/api/game' ? respond(200, { game: {}, zones: [{ questions: [{ answer: 'x' }] }] }) : undefined);
  await withSite(intercept, async (url) => {
    const failures = await smoke(url);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /no answers/);
  });
});

test('results sent to a visitor with no team, or cacheable, fail', async () => {
  const leak = (req) => (req.path === '/api/results' ? respond(200, { published: true, team: null, results: { zones: [{ questions: [{ officialAnswers: ['x'] }] }] } }, { 'cache-control': 'no-store' }) : undefined);
  await withSite(leak, async (url) => assert.equal((await smoke(url)).length, 1));
  const cacheable = (req) => (req.path === '/api/results' ? respond(200, { published: false, team: null }, { 'cache-control': 'public, max-age=3' }) : undefined);
  await withSite(cacheable, async (url) => {
    const failures = await smoke(url);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /Cache-Control/);
  });
});

test('a missing results page fails', async () => {
  const server = http.createServer((req, res) => (req.url.startsWith('/api/') ? createApiHandler()(req, res) : res.writeHead(req.url === '/results/' ? 404 : 200).end('x')));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const failures = await smoke(`http://127.0.0.1:${server.address().port}`);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /results page/);
  } finally {
    server.close();
  }
});

test('a personal or admin response that could be cached fails', async () => {
  for (const path of ['/api/me', '/api/admin/config']) {
    const intercept = (req) => (req.path === path ? respond(200, path === '/api/me' ? { team: null } : { status: 'pre' }, { 'cache-control': 'public, max-age=3' }) : undefined);
    await withSite(intercept, async (url) => {
      const failures = await smoke(url);
      assert.equal(failures.length, 1, path);
      assert.match(failures[0], /Cache-Control/);
    });
  }
});

test('a function that fails to start (a 5xx from CloudFront or the function) fails', async () => {
  for (const path of ['/api/health', '/api/scoreboard', '/api/admin/config']) {
    const intercept = (req) => (req.path === path ? respond(502, { message: 'Bad gateway' }) : undefined);
    await withSite(intercept, async (url) => assert.equal((await smoke(url)).length, 1, path));
  }
});

test('a placeholder that was never replaced (503 not-deployed) fails', async () => {
  const intercept = (req) => (req.path.startsWith('/api/') ? respond(503, { error: 'not-deployed' }) : undefined);
  await withSite(intercept, async (url) => assert.ok((await smoke(url)).length >= 5));
});

test('an unreachable site fails every check instead of throwing', async () => {
  const closed = await withSite(undefined, async (url) => url);
  const failures = await smoke(closed);
  assert.ok(failures.length >= 6);
});

test('failures are retried and a later success passes (a deploy takes a moment to reach every edge)', async () => {
  let calls = 0;
  const intercept = (req) => (req.path === '/api/health' && ++calls < 3 ? respond(503, { error: 'not-deployed' }) : undefined);
  await withSite(intercept, async (url) => assert.deepEqual(await runSmoke(url, { attempts: 4, delayMs: 1 }), []));
});
