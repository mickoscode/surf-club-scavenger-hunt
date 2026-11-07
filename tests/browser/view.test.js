// The /view/ page in a real browser (Chromium), served with the real Content-Security-Policy. Elements are found by
// data-testid and state is read from data-* attributes (phase, seconds, team number, score), never from wording.
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, startSite, openPage, until, START, END } = require('./helpers.js');

let browser;
test.before(async () => { browser = await launchBrowser(); });
test.after(async () => { await browser?.close(); });

// Runs a test body with a fresh site and page, and cleans both up.
const withPage = (name, options, body) => test(name, async (t) => {
  if (!browser) return t.skip('Chromium is not installed (CI installs it and requires it)');
  const site = await startSite(options.site);
  const view = await openPage(browser, options.page);
  try {
    await body({ site, ...view });
  } finally {
    await view.context.close();
    await site.close();
  }
});

const rowsOf = (page) => page.locator('[data-testid="scoreboard-row"]');
const numbers = (page) => rowsOf(page).evaluateAll((els) => els.map((e) => e.dataset.teamNumber));
const status = (page, phase) => page.waitForSelector(`[data-testid="status"][data-phase="${phase}"]`);
const secondsLeft = (page) => page.locator('[data-testid="countdown"]').evaluate((e) => Number(e.dataset.seconds));

withPage('the scoreboard shows the teams in score order and refreshes by itself', {}, async ({ site, page }) => {
  await site.api.configure();
  await site.api.join('bravo');
  await site.api.join('Alpha');
  const yankee = await site.api.join('Yankee');
  await yankee.answer('zone 1', 'Q2', '42'); // 20 points

  await page.goto(`${site.url}/view/?refresh=500`);
  await until(async () => (await rowsOf(page).count()) === 3);
  assert.deepEqual(await numbers(page), ['3', '2', '1']); // Yankee (20), then Alpha, bravo (0 each, A to Z)
  assert.deepEqual(await rowsOf(page).evaluateAll((els) => els.map((e) => e.dataset.score)), ['20', '0', '0']);

  await site.api.join('Aardvark'); // joins while the page is open
  await until(async () => (await rowsOf(page).count()) === 4);
  assert.deepEqual(await numbers(page), ['3', '4', '2', '1']);
});

withPage('before a game is configured the page says so and shows no countdown', {}, async ({ site, page }) => {
  await page.goto(`${site.url}/view/`);
  await status(page, 'unconfigured');
  assert.equal(await page.locator('[data-testid="countdown"]').isHidden(), true);
  assert.equal(await page.locator('[data-testid="no-teams"]').isVisible(), true);
});

withPage('before the game the countdown runs to the start', { site: { now: START - 30 * 60_000 } }, async ({ site, page }) => {
  await site.api.configure();
  await page.goto(`${site.url}/view/`);
  await status(page, 'pre');
  assert.ok(Math.abs((await secondsLeft(page)) - 1800) < 15);
});

withPage('during the game the countdown runs to the end, and ticks', {}, async ({ site, page }) => {
  await site.api.configure();
  await page.goto(`${site.url}/view/`);
  await status(page, 'active');
  const first = await secondsLeft(page);
  assert.ok(Math.abs(first - (END - site.clock.now) / 1000) < 15);
  await new Promise((resolve) => setTimeout(resolve, 2300));
  assert.ok((await secondsLeft(page)) < first, 'the countdown did not move');
});

withPage('after the game the page says it is over and the final scoreboard stays', { site: { now: END + 1 } }, async ({ site, page }) => {
  site.clock.now = START + 60_000;
  await site.api.configure();
  await site.api.join('Sea Dogs');
  site.clock.now = END + 1;
  await page.goto(`${site.url}/view/`);
  await status(page, 'post');
  assert.equal(await page.locator('[data-testid="countdown"]').isHidden(), true);
  assert.equal(await rowsOf(page).count(), 1);
});

withPage('the pages load without console errors, failed requests or Content-Security-Policy violations', {}, async ({ site, page, problems, cspViolations }) => {
  await site.api.configure();
  await site.api.join('Sea Dogs');

  await page.goto(`${site.url}/`); // the home page sends people to the scoreboard
  await page.waitForURL('**/view/');
  await page.goto(`${site.url}/view/?refresh=500`);
  await until(async () => (await rowsOf(page).count()) === 1);
  await new Promise((resolve) => setTimeout(resolve, 2000)); // several refreshes

  assert.deepEqual(problems, []);
  assert.deepEqual(await cspViolations(), []);

  // The 404 page itself must also load cleanly (the browser logs the 404 status, which is expected).
  const missing = await page.goto(`${site.url}/nope.html`);
  assert.equal(missing.status(), 404);
  assert.deepEqual(await cspViolations(), []);
});

withPage('team names are shown as text, never as markup', {}, async ({ site, page, cspViolations }) => {
  await site.api.configure();
  await site.api.join('<script>alert(1)</script>');
  await site.api.join('<b>x</b><img src=x onerror=1>');
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); return d.dismiss(); });

  await page.goto(`${site.url}/view/`);
  await until(async () => (await rowsOf(page).count()) === 2);
  const names = await page.locator('.team-name').evaluateAll((els) => els.map((e) => ({ text: e.textContent, children: e.children.length })));
  assert.deepEqual(names, [
    { text: '<b>x</b><img src=x onerror=1>', children: 0 },
    { text: '<script>alert(1)</script>', children: 0 },
  ]);
  assert.deepEqual(dialogs, []);
  assert.deepEqual(await cspViolations(), []);
});

withPage('a failed refresh shows a warning, keeps the scoreboard, and recovers', {}, async ({ site, page }) => {
  // (the site is started without a failing API; the failure is simulated by blocking the request in the browser)
  await site.api.configure();
  await site.api.join('Sea Dogs');
  let failing = false;
  await page.route('**/api/scoreboard', (route) => (failing ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"server-error"}' }) : route.continue()));

  await page.goto(`${site.url}/view/?refresh=500`);
  await until(async () => (await rowsOf(page).count()) === 1);
  const warning = page.locator('[data-testid="load-error"]');
  assert.equal(await warning.isHidden(), true);

  failing = true;
  await until(() => warning.isVisible());
  assert.equal(await rowsOf(page).count(), 1); // still showing what it had

  failing = false;
  await until(() => warning.isHidden());
});

withPage('on a phone a very long team name wraps instead of widening the page', { page: { viewport: { width: 360, height: 640 } } }, async ({ site, page }) => {
  await site.api.configure();
  await site.api.join('W'.repeat(30)); // 30 characters, no spaces: the longest name allowed
  await site.api.join('Another quite long team name'); // 28 characters, with spaces
  await page.goto(`${site.url}/view/`);
  await until(async () => (await rowsOf(page).count()) === 2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `the page is ${overflow}px wider than the screen`);
});
