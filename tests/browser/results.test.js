// Publishing the final results and the results page, in real Chromium. Fixture game (tests/api/helpers.js): zone 1 "Alpha"
// Q1 text 10 (secret one / alt one), Q2 number 20 (42), Q3 decimal 5 (2.5), photo 30; zone 2 "Bravo" Q1 text 10, photo 25.
// Elements by data-testid; state from data-* attributes. Words on the page are only asserted where the requirements fix them
// (the scoreboard heading, "You finished 3rd of 12", "bike or bicycle").
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { browserSuite, signIn, until, END } = require('./helpers.js');

const { withPage } = browserSuite();

const $ = (testId) => `[data-testid="${testId}"]`;
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// Four teams and a finished game. Final scores: Alpha 60 (1st), Bravo 30 (2nd; also a zone 2 photo that is never scored),
// Charlie 20 (3rd; one wrong answer), Delta 0 (4th, answered nothing). Returns the teams, ready to sign in.
async function finishedGame(site, { publish = true } = {}) {
  await site.api.configure();
  const [alpha, bravo, charlie, delta] = [await site.api.join('Alpha'), await site.api.join('Bravo'), await site.api.join('Charlie'), await site.api.join('Delta')];
  await alpha.answer('zone 1', 'Q1', 'alt one'); await alpha.answer('zone 1', 'Q2', '42'); await alpha.photo('zone 1');
  await bravo.answer('zone 1', 'Q1', 'secret one'); await bravo.answer('zone 1', 'Q2', '42'); await bravo.photo('zone 2');
  await charlie.answer('zone 1', 'Q1', 'purple'); await charlie.answer('zone 1', 'Q2', '42');
  site.clock.now = END + 1;
  await site.api.apply(1, 'zone 1', 'full');
  if (publish) await site.api.publish();
  return { alpha, bravo, charlie, delta };
}
const openResults = async (page, site, team, context) => {
  if (team) await signIn(context, site.url, team);
  await page.goto(`${site.url}/results/?refresh=500`);
};
const question = (zone, id) => `${$('result-zone')}[data-zone="${zone}"] ${$('result-question')}[data-question="${id}"]`;
const photo = (zone) => `${$('result-zone')}[data-zone="${zone}"] ${$('result-photo')}`;

// ------------------------------------------------------------------------------------------ who sees what

withPage('a visitor with no team sees only the link back to the scoreboard, published or not', {}, async ({ site, page }) => {
  await finishedGame(site, { publish: false });
  for (const published of [false, true]) {
    if (published) await site.api.publish();
    await page.goto(`${site.url}/results/`);
    await page.waitForSelector($('scoreboard-link'));
    await new Promise((resolve) => setTimeout(resolve, 600)); // let the page ask the server
    const linkText = await page.locator($('scoreboard-link')).textContent();
    assert.equal((await page.locator('body').innerText()).trim(), linkText, `published=${published}`); // nothing else is visible
    assert.equal(await page.locator($('results-body')).isHidden(), true);
    assert.equal(await page.locator($('results-not-ready')).isHidden(), true);
  }
});

withPage('a team before the results are published is told they are not ready; publishing and un-publishing update the page', {}, async ({ site, page, context }) => {
  const { alpha } = await finishedGame(site, { publish: false });
  await openResults(page, site, alpha, context);
  await page.waitForSelector(`${$('results-not-ready')}:not([hidden])`);
  assert.equal(await page.locator($('results-body')).isHidden(), true);
  assert.equal(await page.locator($('scoreboard-link')).isVisible(), true);

  await site.api.publish();
  await page.waitForSelector(`${$('results-body')}:not([hidden])`);
  assert.equal(await page.locator($('results-not-ready')).isHidden(), true);

  await site.api.unpublish();
  await page.waitForSelector(`${$('results-not-ready')}:not([hidden])`);
  assert.equal(await page.locator($('results-body')).isHidden(), true);
});

// ------------------------------------------------------------------------------------------ the page

withPage('the results page: the link back at the top, then the place, total, and every question and photo', {}, async ({ site, page, context }) => {
  const { alpha } = await finishedGame(site);
  await openResults(page, site, alpha, context);
  await page.waitForSelector(`${$('results-body')}:not([hidden])`);

  const linkFirst = await page.evaluate(() => {
    const link = document.querySelector('[data-testid="scoreboard-link"]');
    const heading = document.querySelector('[data-testid="place-heading"]');
    return Boolean(link.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert.equal(linkFirst, true, 'the link back is not above the heading');

  const heading = page.locator($('place-heading'));
  assert.deepEqual(await heading.evaluate((e) => [e.dataset.place, e.dataset.teamCount]), ['1', '4']);
  assert.match(await heading.innerText(), /You finished 1st of 4/);
  assert.equal(await page.locator($('total')).getAttribute('data-total'), '60');
  assert.equal(await page.locator($('result-zone')).count(), 2);

  const q1 = page.locator(question('zone 1', 'Q1'));
  assert.deepEqual(await q1.evaluate((e) => [e.dataset.outcome, e.dataset.earned, e.dataset.points]), ['correct', '10', '10']);
  assert.equal(await q1.locator($('your-answer')).textContent(), 'Your answer: alt one');
  assert.equal(await q1.locator($('official-answer')).textContent(), 'Official answer: secret one or alt one'); // every accepted answer
  assert.match(await q1.locator($('outcome')).innerText(), /✓.*Correct/s); // an icon and text, not colour alone
  const q3 = page.locator(question('zone 1', 'Q3')); // never answered
  assert.equal(await q3.getAttribute('data-outcome'), 'unanswered');
  assert.equal(await q3.locator($('your-answer')).count(), 0);
  assert.equal(await q3.locator($('official-answer')).textContent(), 'Official answer: 2.5'); // shown even so
  assert.deepEqual(await page.locator(photo('zone 1')).evaluate((e) => [e.dataset.state, e.dataset.percent]), ['scored', '100']);
  assert.equal(await page.locator(`${photo('zone 1')} ${$('photo-result')}`).textContent(), 'Full: 100% - 30 of 30 points');
  assert.deepEqual(await page.locator(photo('zone 2')).evaluate((e) => [e.dataset.state, e.dataset.percent]), ['not-submitted', '']);
  assert.equal(await page.locator(`${photo('zone 2')} ${$('photo-result')}`).textContent(), 'No photo submitted');
});

withPage('wrong answers and photos that were sent but never scored are marked clearly', {}, async ({ site, browser, page, context }) => {
  const { bravo, charlie } = await finishedGame(site);
  await openResults(page, site, charlie, context);
  await page.waitForSelector(`${$('results-body')}:not([hidden])`);
  const wrong = page.locator(question('zone 1', 'Q1'));
  assert.deepEqual(await wrong.evaluate((e) => [e.dataset.outcome, e.dataset.earned]), ['wrong', '0']);
  assert.match(await wrong.locator($('outcome')).innerText(), /✗.*Wrong/s);
  assert.equal(await wrong.locator($('your-answer')).textContent(), 'Your answer: purple');

  const other = await browser.newContext({ viewport: { width: 390, height: 844 } }); // Bravo sent a zone 2 photo that was never scored
  await signIn(other, site.url, bravo);
  const page2 = await other.newPage();
  await page2.goto(`${site.url}/results/?refresh=500`);
  await page2.waitForSelector(`${$('results-body')}:not([hidden])`);
  assert.deepEqual(await page2.locator(photo('zone 2')).evaluate((e) => [e.dataset.state, e.dataset.percent]), ['not-scored', '0']);
  await other.close();
});

withPage('1st, 2nd and 3rd get a gold, silver or bronze medal and fourth place gets none', {}, async ({ site, browser }) => {
  const teams = await finishedGame(site);
  const expected = [[teams.alpha, '1', 'Gold medal'], [teams.bravo, '2', 'Silver medal'], [teams.charlie, '3', 'Bronze medal'], [teams.delta, '4', null]];
  for (const [team, place, medal] of expected) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await signIn(context, site.url, team);
    const p = await context.newPage();
    await p.goto(`${site.url}/results/`);
    await p.waitForSelector(`${$('place-heading')}[data-place="${place}"]`);
    assert.equal(await p.locator($('medal')).count(), medal ? 1 : 0, `place ${place}`);
    if (medal) assert.equal(await p.locator($('medal')).getAttribute('data-medal'), medal);
    assert.match(await p.locator($('place-heading')).innerText(), new RegExp(`You finished ${place}(st|nd|rd|th) of 4`));
    await context.close();
  }
});

withPage('what teams typed is shown as text, a very long answer fits a phone, and nothing errors', { page: { viewport: { width: 360, height: 640 } } }, async ({ site, page, context, problems, cspViolations }) => {
  await site.api.configure();
  const team = await site.api.join('W'.repeat(30));
  await team.answer('zone 1', 'Q1', '<b>x</b>');
  await team.answer('zone 2', 'Q1', 'W'.repeat(60)); // no spaces
  site.clock.now = END + 1;
  await site.api.publish();
  await openResults(page, site, team, context);
  await page.waitForSelector(`${$('results-body')}:not([hidden])`);
  await new Promise((resolve) => setTimeout(resolve, 1500)); // a few refreshes

  const typed = await page.locator(`${question('zone 1', 'Q1')} ${$('your-answer')}`).evaluate((e) => ({ text: e.textContent, children: e.children.length }));
  assert.deepEqual(typed, { text: 'Your answer: <b>x</b>', children: 0 });
  assert.ok((await overflow(page)) <= 0, 'the page is wider than the screen');
  assert.deepEqual(problems, []);
  assert.deepEqual(await cspViolations(), []);
});

// ------------------------------------------------------------------------------------------ the scoreboard and buttons

withPage('the scoreboard says "provisional results:" above the table, then "final results:" once published', {}, async ({ site, page }) => {
  await site.api.configure();
  await page.goto(`${site.url}/view/?refresh=500`);
  await page.waitForSelector(`${$('status')}:not([data-phase="loading"])`);
  assert.equal(await page.locator($('scoreboard-heading')).isHidden(), true); // no teams yet: no heading

  await site.api.join('Alpha');
  await page.waitForSelector(`${$('scoreboard-heading')}:not([hidden])`);
  assert.equal(await page.locator($('scoreboard-heading')).textContent(), 'provisional results:');
  const directlyAbove = await page.evaluate(() => document.querySelector('[data-testid="scoreboard-heading"]').nextElementSibling === document.querySelector('[data-testid="scoreboard"]'));
  assert.equal(directlyAbove, true);

  site.clock.now = END + 1;
  await site.api.publish();
  await page.waitForFunction(() => document.querySelector('[data-testid="scoreboard-heading"]').textContent === 'final results:');
  await site.api.unpublish();
  await page.waitForFunction(() => document.querySelector('[data-testid="scoreboard-heading"]').textContent === 'provisional results:');
});

withPage('once published the Play button becomes a Results button, and the play page links to the results too', {}, async ({ site, page, context }) => {
  const { alpha } = await finishedGame(site, { publish: false });
  await signIn(context, site.url, alpha);
  await page.goto(`${site.url}/view/?refresh=500`);
  await page.waitForSelector($('play-link'));
  assert.equal(await page.locator($('results-link')).count(), 0);

  const play = await context.newPage();
  await play.goto(`${site.url}/play/?refresh=500`);
  await play.waitForSelector(`${$('team-number')}[data-team-number="1"]`);
  assert.equal(await play.locator($('results-link')).isHidden(), true); // not published: no link

  await site.api.publish();
  await page.waitForSelector($('results-link'));
  assert.equal(await page.locator($('play-link')).count(), 0);
  await play.waitForSelector(`${$('results-link')}:not([hidden])`);

  await page.click($('results-link'));
  await page.waitForURL('**/results/');
  await page.waitForSelector(`${$('place-heading')}[data-place="1"]`);
  await page.click($('scoreboard-link'));
  await page.waitForURL('**/view/');
  await page.waitForSelector($('results-link')); // and back on the scoreboard, still a Results button
});

// ------------------------------------------------------------------------------------------ the admin form

withPage('the admin publishes the final results: only after the game, with the confirmation, and scoring locks until the admin returns to provisional', {}, async ({ site, page }) => {
  await finishedGame(site, { publish: false }); // ends at END + 1; Bravo's zone 2 photo is not scored
  site.clock.now = END - 1000; // look at the form while the game is still on
  await page.goto(`${site.url}/game-config/?refresh=500`);
  await page.waitForSelector(`${$('game-status')}[data-status="active"]`);
  assert.equal(await page.locator($('publish-button')).isDisabled(), true);
  assert.equal(await page.locator($('publish-confirm')).isDisabled(), true);

  site.clock.now = END + 1; // the game ends
  await page.waitForSelector(`${$('game-status')}[data-status="post"]`);
  assert.equal(await page.locator($('unscored-note')).isVisible(), true); // 1 photo not scored yet
  assert.match(await page.locator($('unscored-note')).textContent(), /^1 photo has not been scored/);
  assert.equal(await page.locator($('publish-button')).isDisabled(), true); // not until the box is ticked
  await page.check($('publish-confirm'));
  assert.equal(await page.locator($('publish-button')).isDisabled(), false);
  await page.click($('publish-button'));
  await page.waitForSelector(`${$('results-state')}[data-published="true"]`);
  assert.equal(await page.locator($('unpublish-button')).isVisible(), true);
  assert.equal(await page.locator($('publish-button')).isHidden(), true);

  const score = await page.context().newPage();
  await score.goto(`${site.url}/game-score/?refresh=500`);
  await score.waitForSelector(`${$('published-notice')}:not([hidden])`);
  await score.click(`${$('photo-row')}[data-team-number="2"] ${$('decision-half')} + label`);
  assert.equal(await score.locator(`${$('photo-row')}[data-team-number="2"] ${$('apply')}`).isDisabled(), true); // locked

  await page.click($('unpublish-button'));
  await page.waitForSelector(`${$('results-state')}[data-published="false"]`);
  await score.waitForSelector(`${$('published-notice')}[hidden]`, { state: 'attached' });
  await until(async () => !(await score.locator(`${$('photo-row')}[data-team-number="2"] ${$('apply')}`).isDisabled()));
});

withPage('deleting the player data returns the results to provisional', {}, async ({ site, page }) => {
  await finishedGame(site);
  await page.goto(`${site.url}/game-config/?refresh=500`);
  await page.waitForSelector(`${$('results-state')}[data-published="true"]`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click($('export-link'))]);
  assert.ok(JSON.parse(fs.readFileSync(await download.path(), 'utf8')).teams.length === 4);
  await page.fill($('delete-confirm'), 'delete');
  await page.click($('delete-button'));
  await page.waitForSelector(`${$('results-state')}[data-published="false"]`);
});
