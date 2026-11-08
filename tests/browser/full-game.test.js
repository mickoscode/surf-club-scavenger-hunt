// A whole game, through the real pages in real Chromium, with an admin, two teams and a spectator, each in their own
// browser (own cookies). Everything is done by clicking and typing; the only thing moved from outside is the server's
// clock. It is the automated version of the dress rehearsal in docs/runbook.md, and it ties the pieces together:
// set up the game, teams join, play, send photos, the game ends, the admin scores, publishes the final results, the teams see
// how they finished, clean up.
//
// Fixture game (tests/api/helpers.js): zone 1 "Alpha": Q1 text 10 pts ("alt one" is accepted), Q2 number 20 (42),
// Q3 decimal 5 (2.5), photo 30; zone 2 "Bravo": Q1 text 10 (secret two), photo 25.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { browserSuite, openPage, until, START, END } = require('./helpers.js');

const { withPage } = browserSuite();

const $ = (testId) => `[data-testid="${testId}"]`;
const question = (zone, id) => `${$('zone-panel')}[data-zone="${zone}"] ${$('question')}[data-question="${id}"]`;
const photo = (zone) => `${$('zone-panel')}[data-zone="${zone}"] ${$('photo')}`;

async function joinTeam(browser, site, name) {
  const team = await openPage(browser);
  await team.page.goto(`${site.url}/view/?refresh=500`);
  await team.page.click($('join-button'));
  await team.page.fill($('team-name-input'), name);
  await team.page.click($('join-submit'));
  await team.page.waitForSelector($('play-link'));
  return team;
}

async function answer(page, zone, id, text) {
  await page.fill(`${question(zone, id)} ${$('answer-input')}`, text);
  await page.click(`${question(zone, id)} ${$('answer-submit')}`);
  await page.waitForSelector(`${question(zone, id)}[data-state="done"]`);
}

async function sendPhoto(page, zone) {
  await page.click(`${photo(zone)} ${$('photo-submit')}`);
  await page.waitForSelector(`${photo(zone)}[data-state="done"]`);
}

const openZone = async (page, zone) => {
  await page.click(`${$('zone-tile')}[data-zone="${zone}"]`);
  await page.waitForSelector(`${$('zone-panel')}[data-zone="${zone}"]:not([hidden])`);
};

withPage('a whole game: set up, join, play, photos, scoring, publishing, results, then clean up', { site: { now: START - 3_600_000 } }, async ({ site, browser, page: admin, problems }) => {
  // ---- The admin sets up the game on the config page, an hour before the start.
  await admin.goto(`${site.url}/game-config/?refresh=500`);
  await admin.fill($('config-name'), 'Rehearsal game');
  await admin.fill($('config-day'), '2026-11-14');
  await admin.fill($('config-start'), '10:00');
  await admin.fill($('config-end'), '12:00');
  await admin.click($('config-save'));
  await admin.waitForSelector(`${$('game-status')}[data-status="pre"]`);

  // ---- A spectator opens the scoreboard; two teams join before the game starts.
  const spectator = await openPage(browser);
  await spectator.page.goto(`${site.url}/view/?refresh=500`);
  await spectator.page.waitForSelector(`${$('status')}[data-phase="pre"]`);
  const dogs = await joinTeam(browser, site, 'Sea Dogs');
  const sharks = await joinTeam(browser, site, 'Sharks');
  await until(async () => (await spectator.page.locator($('scoreboard-row')).count()) === 2);

  // ---- The game starts: a team that opens the play page now sees the zones.
  site.clock.now = START + 60_000;
  for (const team of [dogs, sharks]) {
    await team.page.click($('play-link'));
    await team.page.waitForSelector(`${$('zones')}:not([hidden])`);
    await team.page.waitForSelector($('zone-tile'));
  }

  // ---- Sea Dogs: three answers in zone 1 (the decimal one wrong), and a photo.
  await openZone(dogs.page, 'zone 1');
  await answer(dogs.page, 'zone 1', 'Q1', 'ALT one'); // an accepted alternative, in capitals
  await answer(dogs.page, 'zone 1', 'Q2', '42');
  await answer(dogs.page, 'zone 1', 'Q3', '7'); // wrong: scores nothing, and looks the same
  site.clock.now += 1000;
  await sendPhoto(dogs.page, 'zone 1');

  // ---- Sharks: zone 2's question, then photos for both zones.
  await openZone(sharks.page, 'zone 2');
  await answer(sharks.page, 'zone 2', 'Q1', 'secrt two'); // one typo is accepted
  site.clock.now += 1000;
  await sendPhoto(sharks.page, 'zone 2');
  await sharks.page.click(`${$('zone-panel')}[data-zone="zone 2"] ${$('zone-back')}`);
  await openZone(sharks.page, 'zone 1');
  site.clock.now += 1000;
  await sendPhoto(sharks.page, 'zone 1');

  // ---- The scoreboard moves while the game is on (photos are not scored yet): Sea Dogs 30, Sharks 10.
  const scores = () => spectator.page.locator($('scoreboard-row')).evaluateAll((rows) => rows.map((r) => [r.dataset.teamNumber, r.dataset.score]));
  await until(async () => JSON.stringify(await scores()) === JSON.stringify([['1', '30'], ['2', '10']]));
  assert.equal(await spectator.page.locator(`${$('scoreboard-row')}[data-mine="true"]`).count(), 0); // a spectator has no team

  // ---- The game ends: the teams' play pages say so and close the zones.
  site.clock.now = END + 1;
  for (const team of [dogs, sharks]) {
    await team.page.waitForSelector(`${$('play-message')}[data-phase="post"]:not([hidden])`);
    assert.equal(await team.page.locator($('zones')).isHidden(), true);
  }
  await spectator.page.waitForSelector(`${$('status')}[data-phase="post"]`);

  // ---- The admin scores the three photos: Sea Dogs full (30), Sharks half for zone 2 (12.5) and nothing for zone 1.
  await admin.goto(`${site.url}/game-score/?refresh=500`);
  await until(async () => (await admin.locator($('photo-row')).count()) === 3);
  const scoreRow = async (team, zone, decision) => {
    const row = `${$('photo-row')}[data-team-number="${team}"][data-zone="${zone}"]`;
    await admin.click(`${row} ${$(`decision-${decision}`)} + label`);
    await admin.click(`${row} ${$('apply')}`);
    await admin.waitForSelector(`${row}[data-decision="${decision}"]`);
  };
  await scoreRow(1, 'zone 1', 'full');
  await scoreRow(2, 'zone 2', 'half');
  await scoreRow(2, 'zone 1', 'full');
  await scoreRow(2, 'zone 1', 'zero'); // a correction: replaces "full", never adds to it

  // ---- Final scoreboard: Sea Dogs 20 + 10 + 0 + 30 = 60; Sharks 10 + 12.5 + 0 = 22.5 (shown with one decimal).
  await until(async () => JSON.stringify(await scores()) === JSON.stringify([['1', '60'], ['2', '22.5']]));
  const shown = await spectator.page.locator(`${$('scoreboard-row')} td:last-child`).allTextContents();
  assert.deepEqual(shown, ['60', '22.5']);

  // ---- Until the admin publishes, the scoreboard is provisional and players only have a Play button.
  assert.equal(await spectator.page.locator($('scoreboard-heading')).textContent(), 'provisional results:');
  await dogs.page.goto(`${site.url}/view/?refresh=500`);
  await dogs.page.waitForSelector($('play-link'));

  // ---- The admin confirms every score has been applied and publishes the final results.
  await admin.goto(`${site.url}/game-config/?refresh=500`);
  await admin.waitForSelector(`${$('game-status')}[data-status="post"]`);
  assert.equal(await admin.locator($('unscored-note')).isHidden(), true); // every photo has been scored
  await admin.check($('publish-confirm'));
  await admin.click($('publish-button'));
  await admin.waitForSelector(`${$('results-state')}[data-published="true"]`);

  // ---- The scoreboard turns final; each team's Play button becomes Results and shows how it finished.
  await spectator.page.waitForFunction(() => document.querySelector('[data-testid="scoreboard-heading"]').textContent === 'final results:');
  const results = async (team, place, medal, total, photoStates) => {
    await team.page.goto(`${site.url}/view/?refresh=500`);
    await team.page.waitForSelector($('results-link'));
    assert.equal(await team.page.locator($('play-link')).count(), 0);
    await team.page.click($('results-link'));
    await team.page.waitForSelector(`${$('place-heading')}[data-place="${place}"]`);
    assert.match(await team.page.locator($('place-heading')).innerText(), new RegExp(`You finished ${place === 1 ? '1st' : '2nd'} of 2`));
    assert.equal(await team.page.locator($('medal')).getAttribute('data-medal'), medal);
    assert.equal(await team.page.locator($('total')).getAttribute('data-total'), total);
    for (const [zone, state, percent] of photoStates) {
      assert.deepEqual(await team.page.locator(`${$('result-zone')}[data-zone="${zone}"] ${$('result-photo')}`).evaluate((e) => [e.dataset.state, e.dataset.percent]), [state, percent]);
    }
  };
  await results(dogs, 1, 'Gold medal', '60', [['zone 1', 'scored', '100'], ['zone 2', 'not-submitted', '']]);
  await results(sharks, 2, 'Silver medal', '22.5', [['zone 1', 'scored', '0'], ['zone 2', 'scored', '50']]);
  await dogs.page.goto(`${site.url}/results/`); // Sea Dogs' wrong decimal answer is marked wrong, with the official answer shown
  await dogs.page.waitForSelector(`${$('result-question')}[data-question="Q3"]`);
  assert.equal(await dogs.page.locator(`${$('result-zone')}[data-zone="zone 1"] ${$('result-question')}[data-question="Q3"]`).getAttribute('data-outcome'), 'wrong');

  // ---- Clean up: download the data, delete it, and the next game starts empty (and provisional again).
  await admin.goto(`${site.url}/game-config/?refresh=500`);
  await admin.waitForSelector(`${$('game-status')}[data-status="post"]`);
  const [download] = await Promise.all([admin.waitForEvent('download'), admin.click($('export-link'))]);
  const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.deepEqual(exported.teams.map((t) => [t.name, t.score]).sort(), [['Sea Dogs', 60], ['Sharks', 22.5]]);
  await admin.fill($('delete-confirm'), 'delete');
  await admin.click($('delete-button'));
  await admin.waitForSelector(`${$('delete-result')}:not([hidden])`);
  await until(async () => (await spectator.page.locator($('scoreboard-row')).count()) === 0);
  await spectator.page.waitForSelector(`${$('no-teams')}:not([hidden])`);
  await admin.waitForSelector(`${$('results-state')}[data-published="false"]`); // deleting the data returned the results to provisional

  assert.deepEqual(problems, []); // the admin's pages had no errors along the way
  for (const other of [spectator, dogs, sharks]) {
    assert.deepEqual(other.problems, []);
    assert.deepEqual(await other.cspViolations(), []);
    await other.context.close();
  }
});
