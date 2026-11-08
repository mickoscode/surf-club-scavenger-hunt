// Helpers for the browser tests: the real site (built dist/) and the real API code on a local address with the in-memory
// store, a controllable server clock, and a real Chromium. Fixture game only (tests/api/helpers.js), never the real one.
const test = require('node:test');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const { createSiteServer } = require('../../scripts/dev-server.js');
const { createMemoryStore } = require('../../api/store/memory.js');
const { hashPasscode } = require('../../api/lib/passcode.js');
const { GAME, CONFIG, START, END } = require('../api/helpers.js');

const root = path.join(__dirname, '..', '..');
let built = false;
function ensureBuilt() {
  if (built) return;
  const r = spawnSync('bash', ['scripts/build.sh'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`build failed: ${r.stderr || r.stdout}`);
  built = true;
}

// Chromium may not be installed on a laptop: tests then skip. CI sets REQUIRE_BROWSER=1, so there a missing browser fails.
async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (e) {
    if (process.env.REQUIRE_BROWSER) throw e;
    return null;
  }
}

// What a "player" or the admin does to the API directly (to set the scene), with their own cookie.
function apiClient(url, passcode = null) {
  const call = async (method, p, body, cookie) => {
    const res = await fetch(url + p, {
      method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sets = res.headers.getSetCookie().map((c) => c.split(';')[0]);
    return { status: res.status, body: await res.json(), cookie: sets.find((c) => c.startsWith('hunt=')), adminCookie: sets.find((c) => c.startsWith('hunt_admin=')) };
  };

  // Admin calls: when the site has a passcode the client logs in first (once), as the admin would, and logs in again if its session ends.
  let adminCookie = null;
  const login = async () => {
    const res = await call('POST', '/api/admin/login', { passcode });
    if (res.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(res.body)}`);
    adminCookie = res.adminCookie;
  };
  const admin = async (method, p, body) => {
    if (passcode && !adminCookie) await login();
    let res = await call(method, p, body, adminCookie);
    if (passcode && res.status === 401) { await login(); res = await call(method, p, body, adminCookie); }
    return res;
  };

  return {
    configure: async (over = {}) => {
      const res = await admin('PUT', '/api/admin/config', { ...CONFIG, ...over });
      if (res.status !== 200) throw new Error(`configure failed: ${JSON.stringify(res.body)}`);
    },
    removeTeam: (number) => admin('DELETE', `/api/admin/teams/${number}`, undefined),
    scoreOf: async (number) => (await call('GET', '/api/scoreboard')).body.teams.find((t) => t.number === number)?.score,
    publish: async () => {
      const res = await admin('POST', '/api/admin/results/publish', { confirm: true });
      if (res.status !== 200) throw new Error(`publish failed: ${JSON.stringify(res.body)}`);
    },
    unpublish: () => admin('POST', '/api/admin/results/unpublish', {}),
    config: async () => (await admin('GET', '/api/admin/config')).body,
    apply: (teamNumber, zone, decision) => admin('POST', '/api/admin/photos/apply', { teamNumber, zone, decision }),
    photosToScore: async () => (await admin('GET', '/api/admin/photos')).body.photos,
    // Direct access for tests that look at the admin API's own answers (with the admin's session, if the site has a passcode).
    admin,
    // Joins as a new team and returns what that team can then do.
    join: async (name) => {
      const res = await call('POST', '/api/join', { name });
      if (res.status !== 200) throw new Error(`join failed: ${JSON.stringify(res.body)}`);
      const { cookie } = res;
      return {
        number: res.body.team.number,
        cookie,
        answer: (zone, question, answer) => call('POST', '/api/answer', { zone, question, answer }, cookie),
        photo: (zone) => call('POST', '/api/photo', { zone }, cookie),
      };
    },
  };
}

const TEST_PASSCODE = 'k7m2q-xd93p-wn4tr-h8jcf';

// passcode: true gives the site an admin passcode (TEST_PASSCODE, with a cheap hash so tests stay fast); the default is no passcode.
async function startSite({ now = START + 60_000, intercept, game = GAME, passcode = false } = {}) {
  ensureBuilt();
  const clock = { now };
  const adminPasscodeHash = passcode ? await hashPasscode(TEST_PASSCODE, { cost: { N: 1024, r: 8, p: 1 } }) : '';
  const server = createSiteServer({ store: createMemoryStore(), now: () => clock.now, loadGame: () => structuredClone(game), intercept, adminPasscodeHash });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, clock, passcode: passcode ? TEST_PASSCODE : null, api: apiClient(url, passcode ? TEST_PASSCODE : null), close: () => new Promise((resolve) => server.close(resolve)) };
}

// Makes this browser belong to a team that joined through the API, as if it had joined on the page.
async function signIn(context, siteUrl, team) {
  const [name, value] = team.cookie.split('=');
  await context.addCookies([{ name, value, url: siteUrl, httpOnly: true, sameSite: 'Strict' }]);
}

// One real Chromium per test file; withPage(name, options, body) runs a test with a fresh site and page, and cleans up.
function browserSuite() {
  let browser;
  test.before(async () => { browser = await launchBrowser(); });
  test.after(async () => { await browser?.close(); });

  const withPage = (name, options, body) => test(name, async (t) => {
    if (!browser) return t.skip('Chromium is not installed (CI installs it and requires it)');
    const site = await startSite(options.site);
    const view = await openPage(browser, options.page);
    try {
      await body({ site, browser, ...view });
    } finally {
      await view.context.close();
      await site.close();
    }
  });
  return { withPage };
}

// Opens an admin page the way the admin does: if the site has a passcode and this browser is not logged in, the login box is
// filled in and sent. Returns when the page's own content is showing.
async function adminPage(page, site, path) {
  await page.goto(`${site.url}${path}`);
  await page.waitForSelector('[data-testid="login-panel"]:not([hidden]), [data-testid="admin-content"]:not([hidden])');
  if (await page.locator('[data-testid="login-panel"]').isVisible()) {
    await page.fill('[data-testid="passcode-input"]', site.passcode);
    await page.click('[data-testid="login-button"]');
    await page.waitForSelector('[data-testid="admin-content"]:not([hidden])');
  }
}

// Polls until fn() is truthy (the page updates by itself, so tests wait for the result rather than for a fixed time).
async function until(fn, { timeoutMs = 10000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for the page');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// A page that records everything that goes wrong: console errors, uncaught errors, failed or error responses from the
// site itself, and Content-Security-Policy violations.
async function openPage(browser, { viewport } = {}) {
  const context = await browser.newContext({ viewport: viewport ?? { width: 390, height: 844 } });
  const page = await context.newPage();
  // The API says "cache for 3 seconds" (meant for CloudFront) and Chromium obeys that too. The tests change the
  // server's data and clock between page loads, so they need to see every change at once. Playwright turns the browser
  // cache off while a route is registered, so register a do-nothing one for the API.
  await context.route('**/api/**', (route) => route.continue());
  const problems = [];
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`page error: ${e}`));
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/nope')) problems.push(`${r.status()} ${r.url()}`); });
  const cspViolations = () => page.evaluate(() => window.__csp);
  return { context, page, problems, cspViolations };
}

module.exports = { launchBrowser, startSite, openPage, browserSuite, signIn, adminPage, until, TEST_PASSCODE, GAME, CONFIG, START, END };
