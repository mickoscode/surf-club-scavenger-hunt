// The /game-score/ admin page in real Chromium: photos teams say they sent, scored full, half or zero, with corrections.
// Fixture game (tests/api/helpers.js): zone 1 "Alpha" photo is worth 30, zone 2 "Bravo" 25. Elements by data-testid;
// state from data-* attributes and the server's scores, not wording.
const assert = require('node:assert/strict');
const { browserSuite, until, START, END } = require('./helpers.js');

const { withPage } = browserSuite();

const $ = (testId) => `[data-testid="${testId}"]`;
const row = (team, zone) => `${$('photo-row')}[data-team-number="${team}"][data-zone="${zone}"]`;
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const order = (page) => page.locator($('photo-row')).evaluateAll((els) => els.map((e) => `${e.dataset.teamNumber}:${e.dataset.zone}:${e.dataset.state}`));
const open = (page, site) => page.goto(`${site.url}/game-score/?refresh=500`);
const choose = (page, team, zone, decision) => page.click(`${row(team, zone)} ${$(`decision-${decision}`)} + label`); // the radio is styled as a button
const apply = (page, team, zone) => page.click(`${row(team, zone)} ${$('apply')}`);

// Two teams that have sent photos while the game is on: team 1 for zone 1, then team 2 for zone 2.
async function twoPhotos(site) {
  await site.api.configure();
  const a = await site.api.join('Alpha');
  const b = await site.api.join('Bravo');
  site.clock.now += 1000; await a.photo('zone 1');
  site.clock.now += 1000; await b.photo('zone 2');
  return { a, b };
}

withPage('photos are listed in the order sent, and a score is applied, replaced and never counted twice', {}, async ({ site, page }) => {
  const { a } = await twoPhotos(site);
  await open(page, site);
  await until(async () => (await page.locator($('photo-row')).count()) === 2);
  assert.deepEqual(await order(page), ['1:zone 1:pending', '2:zone 2:pending']);
  // The team is identified by hidden fields, not by anything typed.
  assert.equal(await page.locator(`${row(1, 'zone 1')} input[type="hidden"][name="teamNumber"]`).getAttribute('value'), '1');
  assert.equal(await page.locator(`${row(1, 'zone 1')} input[type="hidden"][name="zone"]`).getAttribute('value'), 'zone 1');
  assert.equal(await page.locator(`${row(1, 'zone 1')} ${$('apply')}`).isDisabled(), true); // nothing chosen yet

  await choose(page, 1, 'zone 1', 'full');
  assert.equal(await page.locator(`${row(1, 'zone 1')} ${$('apply')}`).isDisabled(), false);
  await apply(page, 1, 'zone 1');
  await page.waitForSelector(`${row(1, 'zone 1')}[data-state="applied"]`);
  assert.deepEqual(await order(page), ['2:zone 2:pending', '1:zone 1:applied']); // the scored line moves to the bottom
  assert.equal(await site.api.scoreOf(a.number), 30);

  const scoreAfter = async (decision) => {
    await choose(page, 1, 'zone 1', decision);
    await apply(page, 1, 'zone 1');
    await page.waitForSelector(`${row(1, 'zone 1')}[data-decision="${decision}"]`);
    return site.api.scoreOf(a.number);
  };
  assert.equal(await scoreAfter('half'), 15); // a correction replaces the earlier decision
  assert.equal(await scoreAfter('zero'), 0);
  assert.equal(await scoreAfter('full'), 30);
  assert.equal(await page.locator(`${row(1, 'zone 1')} ${$('apply')}`).isDisabled(), true); // already applied: nothing to apply
  assert.equal(await site.api.scoreOf(a.number), 30);
});

withPage('scoring is closed before the game starts, and opens when it does', {}, async ({ site, page }) => {
  await twoPhotos(site);
  site.clock.now = START - 1000; // (photos can only be sent during the game; this just looks at the page earlier)
  await open(page, site);
  await page.waitForSelector(`${$('scoring-notice')}:not([hidden])`);
  assert.equal(await page.locator($('scoring-notice')).getAttribute('data-status'), 'pre');
  await choose(page, 1, 'zone 1', 'full');
  assert.equal(await page.locator(`${row(1, 'zone 1')} ${$('apply')}`).isDisabled(), true);

  site.clock.now = START + 5000; // the game starts while the page is open
  await page.waitForSelector(`${$('scoring-notice')}[hidden]`, { state: 'attached' });
  await until(async () => !(await page.locator(`${row(1, 'zone 1')} ${$('apply')}`).isDisabled()));
  assert.equal(await page.locator(`${row(1, 'zone 1')} input[value="full"]`).isChecked(), true); // the choice was kept
});

withPage('scoring still works after the game has ended', {}, async ({ site, page }) => {
  const { b } = await twoPhotos(site);
  site.clock.now = END + 1;
  await open(page, site);
  await until(async () => (await page.locator($('photo-row')).count()) === 2);
  assert.equal(await page.locator($('scoring-notice')).isHidden(), true);
  await choose(page, 2, 'zone 2', 'half');
  await apply(page, 2, 'zone 2');
  await page.waitForSelector(`${row(2, 'zone 2')}[data-state="applied"]`);
  assert.equal(await site.api.scoreOf(b.number), 12.5); // half of 25, not rounded
});

withPage('a choice not yet applied survives refreshes, and new photos appear by themselves', {}, async ({ site, page }) => {
  await twoPhotos(site);
  const c = await site.api.join('Charlie');
  await open(page, site);
  await until(async () => (await page.locator($('photo-row')).count()) === 2);
  await choose(page, 1, 'zone 1', 'half'); // chosen, but not applied

  await c.photo('zone 1'); // another team sends a photo while the page is open
  await until(async () => (await page.locator($('photo-row')).count()) === 3);
  await new Promise((resolve) => setTimeout(resolve, 1500)); // a few more refreshes
  assert.equal(await page.locator(`${row(1, 'zone 1')} input[value="half"]`).isChecked(), true);
  assert.deepEqual(await order(page), ['1:zone 1:pending', '2:zone 2:pending', '3:zone 1:pending']);
});

withPage('a score applied somewhere else shows up here, and a removed team\'s photos disappear', {}, async ({ site, page }) => {
  await twoPhotos(site);
  await open(page, site);
  await until(async () => (await page.locator($('photo-row')).count()) === 2);

  await site.api.apply(1, 'zone 1', 'half'); // e.g. from the admin's other device
  await page.waitForSelector(`${row(1, 'zone 1')}[data-state="applied"]`);
  assert.equal(await page.locator(`${row(1, 'zone 1')} input[value="half"]`).isChecked(), true);

  await site.api.removeTeam(2);
  await until(async () => (await page.locator($('photo-row')).count()) === 1);
});

withPage('the score page loads without errors or policy violations and is marked noindex', {}, async ({ site, page, problems, cspViolations }) => {
  await twoPhotos(site);
  await open(page, site);
  await until(async () => (await page.locator($('photo-row')).count()) === 2);
  await choose(page, 1, 'zone 1', 'full');
  await apply(page, 1, 'zone 1');
  await page.waitForSelector(`${row(1, 'zone 1')}[data-state="applied"]`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.deepEqual(problems, []);
  assert.deepEqual(await cspViolations(), []);
  assert.match(await page.locator('meta[name="robots"]').getAttribute('content'), /noindex/);
});

withPage('on a phone the score page fits with several photos waiting', { page: { viewport: { width: 360, height: 640 } } }, async ({ site, page }) => {
  await twoPhotos(site);
  const c = await site.api.join('Charlie');
  const d = await site.api.join('Delta');
  await c.photo('zone 1'); await d.photo('zone 2');
  await open(page, site);
  await until(async () => (await page.locator($('photo-row')).count()) === 4);
  assert.ok((await overflow(page)) <= 0, 'the page is wider than the screen');
});
