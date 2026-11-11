// The /game-teams/ admin page in real Chromium (the live scoreboard and a team's answers) and the menu at the top of every admin
// page. Fixture game (tests/api/helpers.js): zone 1 "Alpha" has Q1 text (secret one), Q2 number (42), Q3 decimal, photo Q4;
// zone 2 "Bravo" has Q1 text (secret two), photo Q2. Elements by data-testid; results from data-* attributes.
const assert = require('node:assert/strict');
const { browserSuite, until, adminPage } = require('./helpers.js');

const { withPage } = browserSuite();

const $ = (testId) => `[data-testid="${testId}"]`;
const rows = (page) => page.locator($('scoreboard-row')).evaluateAll((els) => els.map((e) => [e.dataset.teamNumber, e.dataset.rank, e.dataset.done, e.dataset.score]));
const open = (page, site) => adminPage(page, site, '/game-teams/?refresh=500');
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

withPage('the live scoreboard has the same rows as the public one, and refreshes by itself', {}, async ({ site, page }) => {
  await site.api.configure();
  const sea = await site.api.join('Sea Dogs');
  await site.api.join('Sharks');
  await sea.answer('zone 1', 'Q2', '42');
  await open(page, site);
  await until(async () => (await rows(page)).length === 2);
  assert.deepEqual(await rows(page), [['1', '1', '1', '20'], ['2', '2', '0', '0']]); // number, rank, done, score
  assert.equal(await page.locator('[data-testid="scoreboard"] th').count(), 4); // rank, name, done, score

  await site.api.join('Whales'); // joins while the page is open
  await until(async () => (await rows(page)).length === 3);
  const publicRows = await (async () => {
    const res = await (await fetch(`${site.url}/api/scoreboard`)).json();
    return res.teams.map((t) => [String(t.number), String(t.rank), String(t.done), String(t.score)]);
  })();
  assert.deepEqual(await rows(page), publicRows);
});

withPage("tapping a team shows what it submitted, as the team will see it, and it updates while the game is played", {}, async ({ site, page }) => {
  await site.api.configure();
  const sea = await site.api.join('Sea Dogs');
  await site.api.join('Sharks');
  await sea.answer('zone 1', 'Q1', 'secret one'); // right
  await sea.answer('zone 1', 'Q2', '41'); // wrong
  await sea.photo('zone 1');
  await open(page, site);
  await page.click(`${$('scoreboard-row')}[data-team-number="1"] ${$('team-link')}`);
  await page.waitForSelector(`${$('team-view')}:not([hidden])`);
  assert.equal(await page.locator($('teams-list-view')).isHidden(), true);
  assert.equal(new URL(page.url()).hash, '#team-1');

  const card = (zone, id) => `${$('result-zone')}[data-zone="${zone}"] ${$('result-question')}[data-question="${id}"]`;
  await page.waitForSelector(card('zone 1', 'Q1'));
  assert.equal(await page.locator(card('zone 1', 'Q1')).getAttribute('data-outcome'), 'correct');
  assert.equal(await page.locator(card('zone 1', 'Q2')).getAttribute('data-outcome'), 'wrong');
  assert.equal(await page.locator(card('zone 1', 'Q3')).getAttribute('data-outcome'), 'unanswered');
  assert.match(await page.locator(`${card('zone 1', 'Q1')} ${$('your-answer')}`).textContent(), /secret one/);
  assert.match(await page.locator(`${card('zone 1', 'Q2')} ${$('official-answer')}`).textContent(), /42/); // the official answer, for the admin
  assert.equal(await page.locator(`${$('result-photo')}`).first().getAttribute('data-state'), 'not-scored'); // sent, not scored yet
  assert.equal(await page.locator($('total')).getAttribute('data-total'), '10');

  await sea.answer('zone 1', 'Q3', '2.5'); // the team answers another question while the admin is watching
  await until(async () => (await page.locator(card('zone 1', 'Q3')).getAttribute('data-outcome')) === 'correct');
  assert.equal(await page.locator($('total')).getAttribute('data-total'), '15');
});

withPage('a team opens from its address, Back returns to the list, and a removed team sends the admin back to the list', {}, async ({ site, page }) => {
  await site.api.configure();
  await site.api.join('Sea Dogs');
  await site.api.join('Sharks');
  await adminPage(page, site, '/game-teams/?refresh=500#team-2');
  await page.waitForSelector(`${$('team-view')}:not([hidden])`);
  assert.equal(await page.locator($('place-heading')).getAttribute('data-team-count'), '2');
  await page.click($('back-to-teams'));
  await page.waitForSelector(`${$('teams-list-view')}:not([hidden])`);
  await page.goBack(); // the browser's Back button returns to the team
  await page.waitForSelector(`${$('team-view')}:not([hidden])`);

  await site.api.removeTeam(2);
  await page.waitForSelector(`${$('teams-list-view')}:not([hidden])`); // it was removed: back to the list
  await until(async () => (await rows(page)).length === 1);
});

withPage('team names are shown as text, never markup', {}, async ({ site, page }) => {
  await site.api.configure();
  await site.api.join('<b>x</b>');
  await open(page, site);
  await page.waitForSelector($('team-link'));
  assert.equal(await page.locator(`${$('scoreboard-body')} b`).count(), 0);
  assert.equal(await page.locator($('team-link')).textContent(), '<b>x</b>');
  await page.click($('team-link'));
  await page.waitForSelector(`${$('team-view')}:not([hidden])`);
  assert.equal(await page.locator(`${$('team-view')} b`).count(), 0);
});

withPage('every admin page has the same menu, marking the page you are on, and it moves between the pages', {}, async ({ site, page }) => {
  await site.api.configure();
  const pages = [['/game-teams/', 'nav-teams'], ['/game-score/', 'nav-score'], ['/game-config/', 'nav-config'], ['/game-events/', 'nav-events']];
  for (const [path, current] of pages) {
    await adminPage(page, site, `${path}?refresh=500`);
    assert.equal(await page.locator(`${$('admin-nav')} a`).count(), 4, path);
    assert.deepEqual(await page.locator(`${$('admin-nav')} a[aria-current="page"]`).evaluateAll((els) => els.map((e) => e.dataset.testid)), [current], path);
  }
  for (const [path, , ] of pages) { // from any page to any other, through the menu
    await adminPage(page, site, '/game-events/?refresh=500');
    const target = pages.find(([p]) => p === path)[1];
    await page.click(`${$('admin-nav')} ${$(target)}`);
    await page.waitForURL(`**${path}**`);
  }
});

withPage('with a passcode set the page shows only the login box until it is entered', { site: { passcode: true } }, async ({ site, page }) => {
  await site.api.configure();
  await site.api.join('Sea Dogs');
  await page.goto(`${site.url}/game-teams/`);
  await page.waitForSelector(`${$('login-panel')}:not([hidden])`);
  assert.equal(await page.locator($('admin-content')).isHidden(), true);
  assert.ok(!(await page.content()).includes('Sea Dogs'));
  const res = await page.evaluate(async () => (await fetch('/api/admin/teams/1/results')).status);
  assert.equal(res, 401);
});

withPage('on a phone the teams page and the menu fit the screen', { page: { viewport: { width: 360, height: 640 } } }, async ({ site, page }) => {
  await site.api.configure();
  await site.api.join('W'.repeat(30));
  await open(page, site);
  await page.waitForSelector($('team-link'));
  assert.ok((await overflow(page)) <= 0, 'the teams list is wider than the screen');
  await page.click($('team-link'));
  await page.waitForSelector(`${$('team-view')}:not([hidden])`);
  assert.ok((await overflow(page)) <= 0, "a team's answers are wider than the screen");
});
