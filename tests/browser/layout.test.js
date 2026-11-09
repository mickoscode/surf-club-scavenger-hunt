// Layout rules from the requirements ("UX Modifications", "Play page"): the status text and the countdown share a line, the
// play page shows team number and name on one line told apart by size and colour, and the view page does not repeat the
// team's name. Checked in a real browser on a phone-sized screen, by measuring where things are, never by their wording.
const assert = require('node:assert/strict');
const { browserSuite, signIn, START } = require('./helpers.js');

const { withPage } = browserSuite();
const phone = { page: { viewport: { width: 360, height: 640 } } };

const $ = (testId) => `[data-testid="${testId}"]`;
const box = async (page, testId) => page.locator($(testId)).boundingBox();
const sameLine = (a, b) => a.y < b.y + b.height && b.y < a.y + a.height; // their vertical ranges overlap
const style = (page, testId, property) => page.locator($(testId)).evaluate((e, p) => getComputedStyle(e)[p], property);

async function joined(site, context, name = 'Zebras') {
  await site.api.configure();
  const team = await site.api.join(name);
  await signIn(context, site.url, team);
  return team;
}

for (const path of ['view', 'play']) {
  for (const [label, now] of [['before the game', START - 5 * 60_000 - 10_000], ['during the game', START + 60_000]]) {
    withPage(`on ${path}, the status text and the countdown are on one line, ${label}`, { ...phone, site: { now } }, async ({ site, page, context }) => {
      await joined(site, context);
      await page.goto(`${site.url}/${path}/`);
      await page.waitForSelector(`${$('countdown')}:not([hidden])`);
      const [status, countdown] = [await box(page, 'status'), await box(page, 'countdown')];
      assert.ok(sameLine(status, countdown), `the countdown is on a different line (status at y=${status.y}, countdown at y=${countdown.y})`);
      assert.ok(countdown.x > status.x, 'the countdown comes after the status text');
    });
  }
}

withPage('the status text and the countdown keep their sizes when they share a line', phone, async ({ site, page, context }) => {
  await joined(site, context);
  await page.goto(`${site.url}/view/`);
  await page.waitForSelector(`${$('countdown')}:not([hidden])`);
  assert.equal(await style(page, 'status', 'fontSize'), '20px'); // "lead": 1.25rem
  assert.equal(await style(page, 'status', 'fontWeight'), '300');
  assert.equal(await style(page, 'countdown', 'fontWeight'), '700'); // "display-6 fw-bold"
  assert.ok(parseFloat(await style(page, 'countdown', 'fontSize')) > parseFloat(await style(page, 'status', 'fontSize')) * 1.2); // still the bigger of the two
});

withPage('on the play page the team number and name share a line and differ in size and colour', phone, async ({ site, page, context }) => {
  await joined(site, context, 'Sea Dogs');
  await page.goto(`${site.url}/play/`);
  await page.waitForSelector(`${$('team-number')}[data-team-number="1"]`);
  const [number, name] = [await box(page, 'team-number'), await box(page, 'team-name')];
  assert.ok(sameLine(number, name), 'the number and the name are on different lines');
  assert.ok(name.x > number.x, 'the name comes after the number');
  assert.ok(parseFloat(await style(page, 'team-number', 'fontSize')) > parseFloat(await style(page, 'team-name', 'fontSize')) * 1.5, 'the number is not clearly larger');
  assert.notEqual(await style(page, 'team-number', 'color'), await style(page, 'team-name', 'color'));
  assert.ok(Number(await style(page, 'team-number', 'fontWeight')) >= 700); // the number is bold
});

withPage('a long team name wraps below the number, and still fits the screen', phone, async ({ site, page, context }) => {
  await joined(site, context, 'W'.repeat(30));
  await page.goto(`${site.url}/play/`);
  await page.waitForSelector(`${$('team-number')}[data-team-number="1"]`);
  const [number, name] = [await box(page, 'team-number'), await box(page, 'team-name')];
  assert.ok(name.y >= number.y + number.height / 2, 'a name too long for the line should wrap below the number');
  assert.ok(name.x >= 0 && name.x + name.width <= 360, 'the name runs off the screen');
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
});

withPage('the view page shows the team name only in the scoreboard, not as a separate line', phone, async ({ site, page }) => {
  await site.api.configure();
  await page.goto(`${site.url}/view/?refresh=500`);
  await page.click($('join-button'));
  await page.fill($('team-name-input'), 'Zebras');
  await page.click($('join-submit'));
  await page.waitForSelector($('play-link'));
  await page.waitForSelector(`${$('scoreboard-row')}[data-mine="true"]`);
  assert.equal(await page.getByText('Zebras', { exact: true }).count(), 1); // the scoreboard cell, nowhere else
  assert.equal(await page.locator($('my-team')).count(), 0);
});

withPage('on a phone the scoreboard with its four columns fits the screen even with a 30 character team name', phone, async ({ site, page }) => {
  await site.api.configure();
  await site.api.join('W'.repeat(30));
  await page.goto(`${site.url}/view/?refresh=500`);
  await page.waitForSelector($('scoreboard-row'));
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, 'the scoreboard is wider than the screen');
});
