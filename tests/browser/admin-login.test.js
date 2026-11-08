// The admin login in real Chromium. A site started with a passcode (TEST_PASSCODE, with a cheap hash). Elements by data-testid;
// results from data-* attributes (data-error) and the server's own answers, not wording.
const assert = require('node:assert/strict');
const { browserSuite, signIn, adminPage, until, TEST_PASSCODE } = require('./helpers.js');

const { withPage } = browserSuite();

const $ = (testId) => `[data-testid="${testId}"]`;
const PAGES = ['/game-config/', '/game-score/'];
const withPasscode = { site: { passcode: true } };
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const typeAndSubmit = async (page, passcode) => {
  await page.fill($('passcode-input'), passcode);
  await page.click($('login-button'));
};
const loginError = async (page) => {
  await page.waitForSelector(`${$('login-error')}:not([hidden])`);
  return page.locator($('login-error')).getAttribute('data-error');
};
const adminApiStatus = (page, path) => page.evaluate(async (p) => (await fetch(p)).status, path);

// ------------------------------------------------------------------------------------------------ before logging in

for (const path of PAGES) {
  withPage(`with a passcode set, ${path} shows only the login box and asks the admin API for nothing`, withPasscode, async ({ site, page }) => {
    await site.api.configure();
    await site.api.join('Zebras'); // something a visitor must not see
    const adminRequests = [];
    page.on('request', (r) => { if (r.url().includes('/api/admin/')) adminRequests.push(new URL(r.url()).pathname); });

    await page.goto(`${site.url}${path}?refresh=500`);
    await page.waitForSelector(`${$('login-panel')}:not([hidden])`);
    assert.equal(await page.locator($('admin-content')).isHidden(), true);
    await new Promise((resolve) => setTimeout(resolve, 1500)); // several refresh intervals
    assert.deepEqual([...new Set(adminRequests)], ['/api/admin/session']); // only the question "do I need to log in?"
    assert.ok(!(await page.locator('body').innerText()).includes('Zebras'));
    assert.equal(await page.locator($('logout-button')).isHidden(), true);
  });
}

withPage('the passcode box is a password field that password managers recognise', withPasscode, async ({ site, page }) => {
  await page.goto(`${site.url}/game-config/`);
  await page.waitForSelector(`${$('login-panel')}:not([hidden])`);
  const input = page.locator($('passcode-input'));
  assert.deepEqual(await input.evaluate((e) => [e.type, e.autocomplete]), ['password', 'current-password']);
});

// ------------------------------------------------------------------------------------------------ logging in

withPage('a wrong passcode is refused; the right one, typed differently, lets the admin in, and it is never left on the page', withPasscode, async ({ site, page }) => {
  await site.api.configure();
  await page.goto(`${site.url}/game-config/?refresh=500`);
  await page.waitForSelector(`${$('login-panel')}:not([hidden])`);

  await typeAndSubmit(page, 'not-the-passcode');
  assert.equal(await loginError(page), 'wrong-passcode');
  assert.equal(await page.locator($('admin-content')).isHidden(), true);
  assert.equal(await page.inputValue($('passcode-input')), ''); // cleared

  await typeAndSubmit(page, `  ${TEST_PASSCODE.toUpperCase().replaceAll('-', ' ')}  `); // capitals and spaces instead of dashes
  await page.waitForSelector($('admin-content') + ':not([hidden])');
  await page.waitForSelector(`${$('game-status')}:not([data-status="loading"])`); // the page itself has loaded
  assert.equal(await page.locator($('login-panel')).isHidden(), true);
  assert.equal(await page.locator($('logout-button')).isVisible(), true);
  assert.equal(await page.inputValue($('passcode-input')), '');
  assert.ok(!(await page.content()).includes(TEST_PASSCODE)); // the passcode is nowhere in the page
});

withPage('a logged-in admin stays logged in across a reload and on the other admin page', withPasscode, async ({ site, page }) => {
  await site.api.configure();
  await adminPage(page, site, '/game-config/?refresh=500');
  await page.reload();
  await page.waitForSelector($('admin-content') + ':not([hidden])'); // no login box this time
  assert.equal(await page.locator($('login-panel')).isHidden(), true);
  await page.goto(`${site.url}/game-score/?refresh=500`);
  await page.waitForSelector($('admin-content') + ':not([hidden])');
  await page.waitForSelector($('scoring-notice'), { state: 'attached' }); // that page loaded its data
});

withPage('logging out brings the login box back, and the admin API refuses the browser from then on', withPasscode, async ({ site, page }) => {
  await site.api.configure();
  await adminPage(page, site, '/game-config/?refresh=500');
  assert.equal(await adminApiStatus(page, '/api/admin/config'), 200);

  await page.click($('logout-button'));
  await page.waitForSelector(`${$('login-panel')}:not([hidden])`);
  assert.equal(await page.locator($('admin-content')).isHidden(), true);
  assert.equal(await adminApiStatus(page, '/api/admin/config'), 401);
  await page.reload();
  await page.waitForSelector(`${$('login-panel')}:not([hidden])`); // and a reload still asks
});

// ------------------------------------------------------------------------------------------------ the session ends

withPage('when the session ends while a page is open, the login box comes back, and logging in again carries on', withPasscode, async ({ site, page }) => {
  await site.api.configure();
  await adminPage(page, site, '/game-config/?refresh=500');
  await page.waitForSelector(`${$('game-status')}:not([data-status="loading"])`);

  site.clock.now += 12 * 60 * 60 * 1000 + 1000; // twelve hours later
  await page.waitForSelector(`${$('login-panel')}:not([hidden])`); // the page's next refresh was refused
  assert.equal(await page.locator($('login-error')).getAttribute('data-error'), 'session-ended');
  assert.equal(await page.locator($('admin-content')).isHidden(), true);

  await typeAndSubmit(page, TEST_PASSCODE);
  await page.waitForSelector($('admin-content') + ':not([hidden])');
  assert.equal(await page.locator($('login-panel')).isHidden(), true);
  await until(async () => (await page.locator($('game-status')).getAttribute('data-status')) !== 'loading');
});

// ------------------------------------------------------------------------------------------------ guessing

withPage('too many wrong tries are explained in the login box, and the right passcode is then refused until the window passes', withPasscode, async ({ site, page }) => {
  for (let i = 0; i < 10; i++) { // ten wrong guesses from anywhere
    await fetch(`${site.url}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode: `guess-${i}` }) });
  }
  await page.goto(`${site.url}/game-config/`);
  await page.waitForSelector(`${$('login-panel')}:not([hidden])`);
  await typeAndSubmit(page, TEST_PASSCODE); // the right one, but too late
  assert.equal(await loginError(page), 'too-many-attempts');
  assert.match(await page.locator($('login-error')).textContent(), /\d+ minute/);
  assert.equal(await page.locator($('admin-content')).isHidden(), true);

  site.clock.now += 5 * 60 * 1000; // the next window
  await typeAndSubmit(page, TEST_PASSCODE);
  await page.waitForSelector($('admin-content') + ':not([hidden])');
});

// ------------------------------------------------------------------------------------------------ everyone else

withPage('players and spectators never see a login: they never need the passcode', withPasscode, async ({ site, page, context }) => {
  await site.api.configure();
  const team = await site.api.join('Sea Dogs');
  await signIn(context, site.url, team);
  await page.goto(`${site.url}/view/?refresh=500`);
  await page.waitForSelector($('play-link'));
  assert.equal(await page.locator($('login-panel')).count(), 0);
  await page.goto(`${site.url}/play/?refresh=500`);
  await page.waitForSelector($('zone-tile'));
});

withPage('with no passcode set the admin pages open straight away, with no login box and no log out button', {}, async ({ site, page }) => {
  await site.api.configure();
  for (const path of PAGES) {
    await page.goto(`${site.url}${path}?refresh=500`);
    await page.waitForSelector($('admin-content') + ':not([hidden])');
    assert.equal(await page.locator($('login-panel')).isHidden(), true, path);
    assert.equal(await page.locator($('logout-button')).isHidden(), true, path);
  }
});

// ------------------------------------------------------------------------------------------------ quality

withPage('a clean login causes no console errors or policy violations on either admin page', withPasscode, async ({ site, page, problems, cspViolations }) => {
  await site.api.configure();
  for (const path of PAGES) await adminPage(page, site, `${path}?refresh=500`);
  await new Promise((resolve) => setTimeout(resolve, 1500)); // a few refreshes
  assert.deepEqual(problems, []);
  assert.deepEqual(await cspViolations(), []);
});

withPage('on a phone the login box fits the screen', { ...withPasscode, page: { viewport: { width: 360, height: 640 } } }, async ({ site, page }) => {
  await page.goto(`${site.url}/game-config/`);
  await page.waitForSelector(`${$('login-panel')}:not([hidden])`);
  await typeAndSubmit(page, 'wrong');
  await loginError(page);
  assert.ok((await overflow(page)) <= 0, 'the login box is wider than the screen');
});
