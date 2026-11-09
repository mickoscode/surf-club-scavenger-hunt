// The /game-config/ admin page in real Chromium: saving the game, removing teams, and downloading then deleting the
// player data. Fixture game (tests/api/helpers.js). Elements by data-testid; results from data-* attributes and the
// server's state, not wording.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { browserSuite, until, START, END } = require('./helpers.js');

const { withPage } = browserSuite();

const $ = (testId) => `[data-testid="${testId}"]`;
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const open = async (page, site) => {
  await page.goto(`${site.url}/game-config/?refresh=500`);
  await page.waitForSelector(`${$('game-status')}:not([data-status="loading"])`);
};
const status = (page) => page.locator($('game-status')).getAttribute('data-status');
const fill = async (page, { day = '2026-11-14', start = '10:00', end = '12:00' } = {}) => {
  await page.fill($('config-day'), day);
  await page.fill($('config-start'), start);
  await page.fill($('config-end'), end);
};

withPage('a new game is set up from the page: defaults, then saved with its zones loaded', { site: { now: START - 3_600_000 } }, async ({ site, page }) => {
  await open(page, site);
  assert.equal(await status(page), 'unconfigured');
  assert.equal(await page.inputValue($('config-name')), 'Sorrento Youth Scavenger Hunt'); // the default name
  assert.equal(await page.inputValue($('config-timezone')), 'Australia/Perth'); // AWST by default
  assert.ok((await page.locator(`${$('config-timezone')} option`).count()) >= 7);

  await fill(page);
  await page.fill($('config-name'), 'Autumn hunt');
  await page.click($('config-save'));
  await page.waitForSelector(`${$('config-success')}:not([hidden])`);
  await page.waitForSelector(`${$('game-status')}[data-status="pre"]`);
  const saved = await site.api.config();
  assert.deepEqual(saved.config, { name: 'Autumn hunt', timeZone: 'Australia/Perth', day: '2026-11-14', start: '10:00', end: '12:00', teamNames: true });
  assert.equal(saved.zoneCount, 2); // the zones were loaded from the game file

  await page.reload();
  await page.waitForSelector(`${$('game-status')}[data-status="pre"]`);
  assert.equal(await page.inputValue($('config-name')), 'Autumn hunt');
  assert.equal(await page.inputValue($('config-day')), '2026-11-14');
  assert.equal(await page.inputValue($('config-end')), '12:00');
});

withPage('a configuration the server refuses is explained and nothing is saved', { site: { now: START - 3_600_000 } }, async ({ site, page }) => {
  await open(page, site);
  await fill(page, { start: '10:00', end: '09:00' });
  await page.click($('config-save'));
  await page.waitForSelector(`${$('config-error')}:not([hidden])`);
  const error = page.locator($('config-error'));
  assert.equal(await error.getAttribute('data-error'), 'invalid-config');
  assert.ok((await error.getAttribute('data-fields')).includes('end-before-start'));
  assert.equal((await site.api.config()).config, null);

  await page.fill($('config-day'), ''); // and a missing day
  await page.click($('config-save'));
  await until(async () => (await error.getAttribute('data-fields')).includes('day'));
});

withPage('a problem in the game file is shown to the admin and nothing is saved', { site: { now: START - 3_600_000, game: { 'zone 1': { 'zone-name': 'Broken' } } } }, async ({ site, page }) => {
  await open(page, site);
  await fill(page);
  await page.click($('config-save'));
  await page.waitForSelector(`${$('config-problems')}:not([hidden])`);
  assert.equal(await page.locator($('config-error')).getAttribute('data-error'), 'invalid-game-data');
  assert.ok((await page.locator(`${$('config-problems')} li`).count()) > 0);
  assert.equal((await site.api.config()).config, null);
});

withPage('while the game is in progress the configuration and the data cannot be changed', {}, async ({ site, page }) => {
  site.clock.now = START - 1000;
  await site.api.configure();
  site.clock.now = START + 1000;
  await open(page, site);
  assert.equal(await status(page), 'active');
  assert.equal(await page.locator($('active-notice')).isVisible(), true);
  for (const field of ['config-name', 'config-timezone', 'config-day', 'config-start', 'config-end', 'config-save', 'delete-confirm', 'delete-button']) {
    assert.equal(await page.locator($(field)).isDisabled(), true, field);
  }
});

withPage('teams are listed as text and can be removed, after confirming, even during the game', {}, async ({ site, page }) => {
  await site.api.configure();
  await site.api.join('Sea Dogs');
  await site.api.join('Sharks');
  await site.api.join('<b>x</b>');
  await open(page, site);
  await until(async () => (await page.locator($('team-item')).count()) === 3);
  const name = await page.locator(`${$('team-item')}[data-team-number="3"] .team-name`).evaluate((e) => ({ text: e.textContent, children: e.children.length }));
  assert.deepEqual(name, { text: '3. <b>x</b> (0)', children: 0 }); // a name is text, never markup

  const item = (n) => `${$('team-item')}[data-team-number="${n}"]`;
  await page.click(`${item(2)} ${$('team-remove')}`);
  await page.click(`${item(2)} ${$('team-remove-cancel')}`); // changed my mind
  assert.equal(await page.locator($('team-item')).count(), 3);

  await page.click(`${item(2)} ${$('team-remove')}`);
  await page.click(`${item(2)} ${$('team-remove-confirm')}`);
  await until(async () => (await page.locator($('team-item')).count()) === 2);
  assert.equal(await site.api.scoreOf(2), undefined); // gone from the scoreboard too
  assert.equal(await page.locator(item(1)).count(), 1);
});

withPage('player data must be downloaded and the word typed before it can be deleted, then the next game starts clean', {}, async ({ site, page }) => {
  site.clock.now = START - 1000;
  await site.api.configure();
  const team = await site.api.join('Sea Dogs');
  await site.api.join('Sharks');
  site.clock.now = END + 1;
  await open(page, site);

  const del = page.locator($('delete-button'));
  assert.equal(await del.isDisabled(), true);
  await page.fill($('delete-confirm'), 'delete');
  assert.equal(await del.isDisabled(), true); // typed, but the data was not downloaded yet

  const [download] = await Promise.all([page.waitForEvent('download'), page.click($('export-link'))]);
  const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.equal(exported.teams.length, 2);
  assert.equal(exported.game.config.name, 'Test game');

  await page.fill($('delete-confirm'), 'dele');
  assert.equal(await del.isDisabled(), true); // wrong word
  await page.fill($('delete-confirm'), ' Delete ');
  await until(async () => !(await del.isDisabled()));
  await del.click();
  await page.waitForSelector(`${$('delete-result')}:not([hidden])`);
  assert.equal(await page.locator($('delete-result')).getAttribute('data-error'), '');
  await until(async () => (await page.locator($('team-item')).count()) === 0);
  assert.notEqual((await site.api.config()).config, null); // the game itself stays
  assert.equal(await del.isDisabled(), true); // and it needs a new download before the next delete

  site.clock.now = START - 1000; // a new game: team numbers start again at 1
  assert.equal((await site.api.join('Fresh')).number, 1);
});

withPage('the config page loads without errors or policy violations and is marked noindex', {}, async ({ site, page, problems, cspViolations }) => {
  await site.api.configure();
  await site.api.join('Sea Dogs');
  await open(page, site);
  await until(async () => (await page.locator($('team-item')).count()) === 1);
  await new Promise((resolve) => setTimeout(resolve, 1500)); // a few refreshes
  assert.deepEqual(problems, []);
  assert.deepEqual(await cspViolations(), []);
  assert.match(await page.locator('meta[name="robots"]').getAttribute('content'), /noindex/);
});

withPage('on a phone the config page fits, even with long team names', { page: { viewport: { width: 360, height: 640 } } }, async ({ site, page }) => {
  await site.api.configure();
  await site.api.join('W'.repeat(30));
  await site.api.join('Another quite long team name');
  await open(page, site);
  await until(async () => (await page.locator($('team-item')).count()) === 2);
  assert.ok((await overflow(page)) <= 0, 'the page is wider than the screen');
});

withPage('the "teams have names" setting is on by default, can be turned off and saved, and is locked while the game is in progress', { site: { now: START - 3_600_000 } }, async ({ site, page }) => {
  await open(page, site);
  assert.equal(await page.locator($('config-team-names')).isChecked(), true);
  await fill(page);
  await page.uncheck($('config-team-names'));
  await page.click($('config-save'));
  await page.waitForSelector($('config-success'));
  assert.equal((await site.api.config()).config.teamNames, false);
  await page.reload();
  await page.waitForSelector(`${$('game-status')}:not([data-status="loading"])`);
  assert.equal(await page.locator($('config-team-names')).isChecked(), false); // remembered

  site.clock.now = START + 60_000; // the game is now in progress
  await until(async () => (await status(page)) === 'active');
  assert.equal(await page.locator($('config-team-names')).isDisabled(), true);
});
