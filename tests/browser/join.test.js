// Joining on /view/ in a real browser. Elements are found by data-testid; results are read from data-* attributes and
// error codes (data-error), never from wording.
const assert = require('node:assert/strict');
const { browserSuite, until, START, END } = require('./helpers.js');

const { withPage } = browserSuite();

const $ = (testId) => `[data-testid="${testId}"]`;
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function joinOnPage(page, name) {
  await page.click($('join-button'));
  await page.fill($('team-name-input'), name);
  await page.click($('join-submit'));
}
// The team's own row in the scoreboard: the only place its name appears on the view page.
const mine = (page) => page.locator(`${$('scoreboard-row')}[data-mine="true"] .team-name`);
const joinError = async (page) => {
  await page.waitForSelector(`${$('join-error')}:not([hidden])`);
  return page.locator($('join-error')).getAttribute('data-error');
};

withPage('a visitor can join, then sees Play and their team name instead of Join, and stays joined', { page: { viewport: { width: 360, height: 640 } } }, async ({ site, page, context }) => {
  await site.api.configure();
  await page.goto(`${site.url}/view/?refresh=500`);
  await page.waitForSelector($('join-button'));
  assert.equal(await page.locator($('play-link')).count(), 0);

  await page.click($('join-button'));
  assert.equal(await page.locator($('join-button')).isHidden(), true);
  assert.ok((await overflow(page)) <= 0, 'the join form widens the page');

  await page.fill($('team-name-input'), 'Sea Dogs');
  await page.click($('join-submit'));
  await page.waitForSelector($('play-link'));
  assert.equal(await page.locator($('join-button')).count(), 0);
  assert.equal(await page.locator($('my-team')).count(), 0); // the name is not repeated outside the scoreboard
  const row = page.locator(`${$('scoreboard-row')}[data-mine="true"]`);
  await until(async () => (await row.count()) === 1);
  assert.equal(await row.getAttribute('data-team-number'), '1');
  assert.equal(await mine(page).textContent(), 'Sea Dogs');
  assert.ok((await overflow(page)) <= 0);

  // Closing the browser tab and coming back later: the session is kept.
  const later = await context.newPage();
  await later.goto(`${site.url}/view/`);
  await later.waitForSelector($('play-link'));
  await later.waitForSelector(`${$('scoreboard-row')}[data-mine="true"]`);
  assert.equal(await mine(later).textContent(), 'Sea Dogs');
  assert.equal(await later.locator($('join-button')).count(), 0);
});

withPage('a refused team name says why, and the form can be used again', {}, async ({ site, page }) => {
  await site.api.configure();
  await site.api.join('Sea Dogs');
  await page.goto(`${site.url}/view/`);
  await page.waitForSelector($('join-button'));
  await page.click($('join-button'));

  await page.click($('join-submit')); // nothing typed
  assert.equal(await joinError(page), 'empty');
  await page.fill($('team-name-input'), '  SEA dogs ');
  await page.click($('join-submit'));
  assert.equal(await joinError(page), 'name-taken');
  await page.fill($('team-name-input'), 'sh1t');
  await page.click($('join-submit'));
  assert.equal(await joinError(page), 'not-allowed');

  await page.fill($('team-name-input'), 'Sharks'); // after three refusals, a good name still works
  await page.click($('join-submit'));
  await page.waitForSelector($('play-link'));
  await page.waitForSelector(`${$('scoreboard-row')}[data-mine="true"]`);
  assert.equal(await mine(page).textContent(), 'Sharks');
});

withPage('the team name field stops at 30 characters', {}, async ({ site, page }) => {
  await site.api.configure();
  await page.goto(`${site.url}/view/`);
  await page.click($('join-button'));
  await page.fill($('team-name-input'), 'x'.repeat(40));
  assert.equal((await page.inputValue($('team-name-input'))).length, 30);
});

withPage('half-typed team names survive the scoreboard refreshing', {}, async ({ site, page }) => {
  await site.api.configure();
  await page.goto(`${site.url}/view/?refresh=500`);
  await page.click($('join-button'));
  await page.fill($('team-name-input'), 'Half typ');
  await site.api.join('Another team'); // changes the scoreboard, so the page refreshes
  await until(async () => (await page.locator($('scoreboard-row')).count()) === 1);
  await new Promise((resolve) => setTimeout(resolve, 1500)); // a few more refreshes
  assert.equal(await page.inputValue($('team-name-input')), 'Half typ');
});

withPage('joining is offered before and during the game, and not after it, or before a game is set up', {}, async ({ site, page }) => {
  const joinOffered = async () => {
    await page.reload();
    await page.waitForSelector($('status') + ':not([data-phase="loading"])');
    await new Promise((resolve) => setTimeout(resolve, 150));
    return (await page.locator($('join-button')).count()) === 1;
  };
  await page.goto(`${site.url}/view/`);
  assert.equal(await joinOffered(), false); // no game yet

  site.clock.now = START - 60_000;
  await site.api.configure();
  assert.equal(await joinOffered(), true); // before the start
  site.clock.now = START + 1000;
  assert.equal(await joinOffered(), true); // during
  site.clock.now = END + 1;
  assert.equal(await joinOffered(), false); // after
});

withPage('a team the admin removes goes back to being able to join', {}, async ({ site, page }) => {
  await site.api.configure();
  await page.goto(`${site.url}/view/?refresh=500`);
  await joinOnPage(page, 'Sea Dogs');
  await page.waitForSelector($('play-link'));

  await site.api.removeTeam(1);
  await page.waitForSelector($('join-button')); // the page notices on its next refresh
  assert.equal(await page.locator($('play-link')).count(), 0);
  await joinOnPage(page, 'Sea Dogs'); // the name is free again
  await page.waitForSelector($('play-link'));
});

withPage('joining works without console errors or Content-Security-Policy violations', {}, async ({ site, page, problems, cspViolations }) => {
  await site.api.configure();
  await page.goto(`${site.url}/view/`);
  await joinOnPage(page, '<script>alert(1)</script>');
  await page.waitForSelector($('play-link'));
  await page.waitForSelector(`${$('scoreboard-row')}[data-mine="true"]`);
  const name = await mine(page).evaluate((e) => ({ text: e.textContent, children: e.children.length }));
  assert.deepEqual(name, { text: '<script>alert(1)</script>', children: 0 }); // shown as text
  assert.deepEqual(problems, []);
  assert.deepEqual(await cspViolations(), []);
});

withPage('the session cookie cannot be read by page scripts', {}, async ({ site, page, context }) => {
  await site.api.configure();
  await page.goto(`${site.url}/view/`);
  await joinOnPage(page, 'Sea Dogs');
  await page.waitForSelector($('play-link'));
  assert.equal(await page.evaluate(() => document.cookie), ''); // HttpOnly
  const cookie = (await context.cookies()).find((c) => c.name === 'hunt');
  assert.ok(cookie, 'no session cookie was set');
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, 'Strict');
});


// ------------------------------------------------------------------------------------------------ team names switched off

withPage('with team names off the Join button joins at once, with no name to type, and the team is Team <number>', {}, async ({ site, page }) => {
  await site.api.configure({ teamNames: false });
  await page.goto(`${site.url}/view/?refresh=500`);
  await page.waitForSelector($('join-button'));
  await page.click($('join-button'));
  await page.waitForSelector($('play-link'));
  assert.equal(await page.locator($('team-name-input')).count(), 0); // no name was ever asked for
  await page.waitForSelector(`${$('scoreboard-row')}[data-mine="true"]`);
  assert.equal(await page.locator($('scoreboard-row')).first().locator('td').nth(1).textContent(), 'Team 1');
  await page.click($('play-link'));
  await page.waitForSelector(`${$('team-number')}[data-team-number="1"]`);
  assert.equal(await page.locator($('team-name')).isHidden(), true); // only "Team 1" is shown, not a second name
});

// ------------------------------------------------------------------------------------------------ a code to join

withPage('with no code set the join form has no code field', {}, async ({ site, page }) => {
  await site.api.configure();
  await page.goto(`${site.url}/view/?refresh=500`);
  await page.click($('join-button'));
  assert.equal(await page.locator($('join-code-input')).count(), 0);
});

withPage('with a code set the form asks for it too, a wrong code is refused and keeps what was typed, and the right one (any capitals) joins', {}, async ({ site, page }) => {
  await site.api.configure({ joinCode: 'SURF24' });
  await page.goto(`${site.url}/view/?refresh=500`);
  await page.click($('join-button'));
  await page.fill($('team-name-input'), 'Sea Dogs');
  await page.fill($('join-code-input'), 'wrong1');
  await page.click($('join-submit'));
  await page.waitForSelector(`${$('join-error')}:not([hidden])`);
  assert.equal(await page.locator($('join-error')).getAttribute('data-error'), 'wrong-code');
  assert.equal(await page.inputValue($('team-name-input')), 'Sea Dogs'); // not wiped
  assert.equal(await page.locator($('scoreboard-row')).count(), 0); // nothing was created

  await page.fill($('join-code-input'), 'surf 24');
  await page.click($('join-submit'));
  await page.waitForSelector($('play-link'));
  await page.waitForSelector(`${$('scoreboard-row')}[data-mine="true"]`);
  assert.ok(!(await page.content()).toUpperCase().includes('SURF24')); // the code is never on the page
});

withPage('the code is asked for even when team names are off, and then it is the only field', {}, async ({ site, page }) => {
  await site.api.configure({ joinCode: 'SURF24', teamNames: false });
  await page.goto(`${site.url}/view/?refresh=500`);
  await page.click($('join-button'));
  assert.equal(await page.locator($('team-name-input')).count(), 0);
  await page.fill($('join-code-input'), 'nope!');
  await page.click($('join-submit'));
  await page.waitForSelector(`${$('join-error')}:not([hidden])`);
  assert.equal(await page.locator($('join-error')).getAttribute('data-error'), 'wrong-code');
  await page.fill($('join-code-input'), 'SURF24');
  await page.click($('join-submit'));
  await page.waitForSelector($('play-link'));
});

withPage('the join form with a code fits a phone', { page: { viewport: { width: 360, height: 640 } } }, async ({ site, page }) => {
  await site.api.configure({ joinCode: 'SURF24' });
  await page.goto(`${site.url}/view/`);
  await page.click($('join-button'));
  assert.ok((await overflow(page)) <= 0);
});

withPage('the join code field comes before the team name field', {}, async ({ site, page }) => {
  await site.api.configure({ joinCode: 'SURF24' });
  await page.goto(`${site.url}/view/?refresh=500`);
  await page.click($('join-button'));
  const codeFirst = await page.locator($('join-code-input')).evaluate((code) => !!(code.compareDocumentPosition(document.querySelector('[data-testid="team-name-input"]')) & Node.DOCUMENT_POSITION_FOLLOWING));
  assert.equal(codeFirst, true);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'join-code-input'); // and the cursor starts there
});
