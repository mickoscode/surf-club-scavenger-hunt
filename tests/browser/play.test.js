// The /play/ page shell in a real browser: who you are, the countdown, the instructions, the game phase.
// (The zones and forms are tested with the next PR.) Elements by data-testid, state from data-* attributes.
const assert = require('node:assert/strict');
const { browserSuite, signIn, START, END } = require('./helpers.js');

const { withPage } = browserSuite();

const $ = (testId) => `[data-testid="${testId}"]`;
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// A team that has joined through the API, with this browser signed in as it.
async function joined(site, context, name = 'Sea Dogs') {
  const team = await site.api.join(name);
  await signIn(context, site.url, team);
  return team;
}

withPage('someone who has not joined is sent to the scoreboard page, where they can join', {}, async ({ site, page }) => {
  await site.api.configure();
  await page.goto(`${site.url}/play/`);
  await page.waitForURL('**/view/');
  await page.waitForSelector($('join-button'));
});

withPage('a team sees its number and name, a way back to the scoreboard, and the countdown', {}, async ({ site, page, context }) => {
  await site.api.configure();
  await site.api.join('Another'); // team 1, so ours is team 2
  const team = await joined(site, context);
  assert.equal(team.number, 2);

  await page.goto(`${site.url}/view/`);
  await page.click($('play-link')); // the link on the scoreboard page leads here
  await page.waitForURL('**/play/');
  await page.waitForSelector(`${$('team-number')}[data-team-number="2"]`);
  assert.equal(await page.locator($('team-name')).textContent(), 'Sea Dogs');

  await page.waitForSelector(`${$('status')}[data-phase="active"]`);
  const seconds = await page.locator($('countdown')).evaluate((e) => Number(e.dataset.seconds));
  assert.ok(Math.abs(seconds - (END - site.clock.now) / 1000) < 15);

  await page.click($('scoreboard-link'));
  await page.waitForURL('**/view/');
  await page.waitForSelector($('play-link')); // still joined: back to Play
});

withPage('the instructions are hidden until the heading is tapped, and tapping again hides them', {}, async ({ site, page, context }) => {
  await site.api.configure();
  await joined(site, context);
  await page.goto(`${site.url}/play/`);

  const heading = page.locator($('instructions-heading'));
  const details = page.locator($('instructions'));
  const content = page.locator(`${$('instructions')} .instructions`);
  assert.equal(await heading.textContent(), 'Instructions (tap to show/hide)'); // the heading is fixed by the requirements
  assert.equal(await heading.isVisible(), true);
  assert.equal(await details.evaluate((e) => e.open), false);
  assert.equal(await content.isVisible(), false);

  await heading.click();
  assert.equal(await details.evaluate((e) => e.open), true);
  assert.equal(await content.isVisible(), true);
  assert.ok((await content.locator('li').count()) > 0, 'the instructions have no content');

  await heading.click();
  assert.equal(await details.evaluate((e) => e.open), false);
  assert.equal(await content.isVisible(), false);
  assert.equal(await heading.isVisible(), true); // the heading stays visible
});

withPage('the page follows the game: waiting before the start, zones during, over afterwards', { site: { now: START - 60_000 } }, async ({ site, page, context }) => {
  await site.api.configure();
  await joined(site, context);
  await page.goto(`${site.url}/play/?refresh=500`);

  const message = (phase) => page.waitForSelector(`${$('play-message')}[data-phase="${phase}"]:not([hidden])`);
  await message('pre');
  assert.equal(await page.locator($('zones')).isHidden(), true);
  const toStart = await page.locator($('countdown')).evaluate((e) => Number(e.dataset.seconds));
  assert.ok(Math.abs(toStart - 60) < 15);

  site.clock.now = START + 1000; // the game starts while the page is open
  await page.waitForSelector(`${$('status')}[data-phase="active"]`);
  await page.waitForFunction(() => !document.querySelector('[data-testid="zones"]').hidden); // (an empty div counts as hidden to Playwright)
  assert.equal(await page.locator($('play-message')).isHidden(), true);

  site.clock.now = END + 1; // and ends
  await message('post');
  assert.equal(await page.locator($('zones')).isHidden(), true);
  assert.equal(await page.locator($('countdown')).isHidden(), true);
});

withPage('a team removed by the admin is sent back to the scoreboard page', {}, async ({ site, page, context }) => {
  await site.api.configure();
  const team = await joined(site, context);
  await page.goto(`${site.url}/play/?refresh=500`);
  await page.waitForSelector(`${$('team-number')}[data-team-number="${team.number}"]`);

  await site.api.removeTeam(team.number);
  await page.waitForURL('**/view/');
  await page.waitForSelector($('join-button'));
});

withPage('the play page loads without errors or policy violations, and shows the team name as text', {}, async ({ site, page, context, problems, cspViolations }) => {
  await site.api.configure();
  await joined(site, context, '<script>alert(1)</script>');
  await page.goto(`${site.url}/play/?refresh=500`);
  await page.waitForSelector(`${$('team-number')}[data-team-number="1"]`);
  await new Promise((resolve) => setTimeout(resolve, 1500)); // a few refreshes

  const name = await page.locator($('team-name')).evaluate((e) => ({ text: e.textContent, children: e.children.length }));
  assert.deepEqual(name, { text: '<script>alert(1)</script>', children: 0 });
  assert.deepEqual(problems, []);
  assert.deepEqual(await cspViolations(), []);
});

withPage('on a phone the play page fits, even with the longest team name and the instructions open', { page: { viewport: { width: 360, height: 640 } } }, async ({ site, page, context }) => {
  await site.api.configure();
  await joined(site, context, 'W'.repeat(30)); // 30 characters, no spaces: the longest name allowed
  await page.goto(`${site.url}/play/`);
  await page.waitForSelector(`${$('team-number')}[data-team-number="1"]`);
  await page.locator($('instructions-heading')).click();
  assert.ok((await overflow(page)) <= 0, 'the page is wider than the screen');
});
