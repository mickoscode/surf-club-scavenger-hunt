// The zones on /play/ in real Chromium: tiles with maps, a panel per zone, the question and photo forms (one submission
// each), and the full-size map. Fixture game (tests/api/helpers.js): zone 1 "Alpha" has a text, a whole-number and a
// decimal question plus a photo; zone 2 "Bravo" has one text question plus a photo. Elements by data-testid; state from
// data-* attributes. Nothing here asserts on page wording except text the test itself supplied.
const assert = require('node:assert/strict');
const { browserSuite, signIn, until } = require('./helpers.js');

const { withPage } = browserSuite();

const $ = (testId) => `[data-testid="${testId}"]`;
const tile = (zone) => `${$('zone-tile')}[data-zone="${zone}"]`;
const panel = (zone) => `${$('zone-panel')}[data-zone="${zone}"]`;
const question = (zone, id) => `${panel(zone)} ${$('question')}[data-question="${id}"]`;
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
// Images are loaded lazily and a slow machine (CI) can take a moment, so wait for them; an image that never loads still fails.
const allImagesLoaded = async (page, selector) => {
  try {
    await page.waitForFunction((sel) => {
      const imgs = [...document.querySelectorAll(sel)];
      return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
    }, selector, { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
};

// A team that has joined through the API, this browser signed in as it, and the play page open.
async function play({ site, page, context }, { refresh = 500 } = {}) {
  await site.api.configure();
  const team = await site.api.join('Sea Dogs');
  await signIn(context, site.url, team);
  await page.goto(`${site.url}/play/?refresh=${refresh}`);
  await page.waitForSelector($('zone-tile'));
  return team;
}
const open = async (page, zone) => { await page.click(tile(zone)); await page.waitForSelector(`${panel(zone)}:not([hidden])`); };
const answerWith = async (page, zone, id, text) => {
  await page.fill(`${question(zone, id)} ${$('answer-input')}`, text);
  await page.click(`${question(zone, id)} ${$('answer-submit')}`);
};
const stateOf = (page, zone, id) => page.locator(question(zone, id)).getAttribute('data-state');

withPage('the zone tiles show each zone with its map and progress', {}, async (ctx) => {
  await play(ctx);
  const { page } = ctx;
  assert.equal(await page.locator($('zone-tile')).count(), 2);
  assert.equal(await page.locator(`${tile('zone 1')} ${$('zone-name')}`).textContent(), 'Alpha');
  assert.deepEqual(await page.locator(tile('zone 1')).evaluate((e) => [e.dataset.done, e.dataset.total]), ['0', '4']); // 3 questions + the photo
  assert.deepEqual(await page.locator(tile('zone 2')).evaluate((e) => [e.dataset.done, e.dataset.total]), ['0', '2']);
  assert.equal(await allImagesLoaded(page, `${$('zone-tile')} img`), true, 'a map thumbnail did not load');
});

withPage('a tile opens its zone, All zones and the browser Back button return, and a reload stays on the zone', {}, async (ctx) => {
  await play(ctx);
  const { page } = ctx;
  await open(page, 'zone 1');
  assert.equal(await page.locator($('zone-tiles')).isHidden(), true);
  assert.equal(await page.locator(`${panel('zone 1')} ${$('question')}`).count(), 3);
  assert.equal(await page.locator(`${panel('zone 1')} ${$('photo-challenge')}`).textContent(), 'photo one');
  assert.equal(await page.locator(panel('zone 2')).isHidden(), true);

  await page.click(`${panel('zone 1')} ${$('zone-back')}`);
  await page.waitForSelector(`${$('zone-tiles')}:not([hidden])`);
  assert.equal(await page.locator(panel('zone 1')).isHidden(), true);

  await open(page, 'zone 2');
  await page.goBack();
  await page.waitForSelector(`${$('zone-tiles')}:not([hidden])`); // Back goes to the zones, not out of the game

  await open(page, 'zone 2');
  await page.reload();
  await page.waitForSelector(`${panel('zone 2')}:not([hidden])`); // still on the zone
});

withPage('the map opens full size and closing it returns to the zone questions', {}, async (ctx) => {
  await play(ctx);
  const { page } = ctx;
  await open(page, 'zone 1');
  assert.equal(await allImagesLoaded(page, `${panel('zone 1')} ${$('map-open')} img`), true);

  await page.click(`${panel('zone 1')} ${$('map-open')}`);
  await page.waitForSelector(`${$('map-overlay')}:not([hidden])`);
  await page.waitForFunction(() => { const i = document.querySelector('[data-testid="map-full"]'); return i.complete && i.naturalWidth > 400; }); // the full-size image
  await page.click($('map-close'));
  assert.equal(await page.locator($('map-overlay')).isHidden(), true);
  assert.equal(await page.locator(panel('zone 1')).isVisible(), true);
  assert.equal(await page.locator(`${question('zone 1', 'Q1')}`).isVisible(), true);

  await page.click(`${panel('zone 1')} ${$('map-open')}`); // and Escape closes it too
  await page.keyboard.press('Escape');
  assert.equal(await page.locator($('map-overlay')).isHidden(), true);
});

withPage('an answer can be given once; the form then shows Done, keeps nothing and the score updates', {}, async (ctx) => {
  const team = await play(ctx);
  const { page, site } = ctx;
  await open(page, 'zone 1');

  await answerWith(page, 'zone 1', 'Q1', 'secret one');
  await page.waitForSelector(`${question('zone 1', 'Q1')}[data-state="done"]`);
  const form = page.locator(question('zone 1', 'Q1'));
  assert.equal(await form.locator($('answer-input')).isDisabled(), true);
  assert.equal(await form.locator($('answer-input')).inputValue(), ''); // what was typed is not kept
  assert.equal(await form.locator($('answer-submit')).isDisabled(), true);
  assert.equal(await form.locator($('done-badge')).isVisible(), true);
  assert.ok(!(await page.locator(panel('zone 1')).innerText()).includes('secret one'), 'the submitted answer is shown on the page');
  assert.equal(await site.api.scoreOf(team.number), 10);

  // A wrong answer looks exactly the same, scores nothing, and still uses up the question.
  await answerWith(page, 'zone 1', 'Q2', '7');
  await page.waitForSelector(`${question('zone 1', 'Q2')}[data-state="done"]`);
  assert.equal(await site.api.scoreOf(team.number), 10);
  assert.equal(await page.locator(`${question('zone 1', 'Q2')} ${$('answer-input')}`).isDisabled(), true);

  await page.click(`${panel('zone 1')} ${$('zone-back')}`);
  assert.deepEqual(await page.locator(tile('zone 1')).evaluate((e) => [e.dataset.done, e.dataset.total]), ['2', '4']); // progress follows
});

withPage('what is done stays done after a reload', {}, async (ctx) => {
  await play(ctx);
  const { page } = ctx;
  await open(page, 'zone 1');
  await answerWith(page, 'zone 1', 'Q1', 'whatever');
  await page.click(`${panel('zone 1')} ${$('photo-submit')}`);
  await page.waitForSelector(`${panel('zone 1')} ${$('photo')}[data-state="done"]`);

  await page.reload();
  await page.waitForSelector(`${panel('zone 1')}:not([hidden])`);
  await page.waitForSelector(`${question('zone 1', 'Q1')}[data-state="done"]`);
  assert.equal(await stateOf(page, 'zone 1', 'Q2'), 'open');
  assert.equal(await page.locator(`${panel('zone 1')} ${$('photo')}`).getAttribute('data-state'), 'done');
  assert.equal(await page.locator(`${panel('zone 1')} ${$('photo-submit')}`).isDisabled(), true);
});

withPage('number questions only accept digits (and one point for decimals)', {}, async (ctx) => {
  await play(ctx);
  const { page } = ctx;
  await open(page, 'zone 1');
  const whole = page.locator(`${question('zone 1', 'Q2')} ${$('answer-input')}`);
  const decimal = page.locator(`${question('zone 1', 'Q3')} ${$('answer-input')}`);
  assert.equal(await whole.getAttribute('inputmode'), 'numeric'); // the number keypad on phones
  assert.equal(await decimal.getAttribute('inputmode'), 'decimal');

  await whole.pressSequentially('4a-2.x');
  assert.equal(await whole.inputValue(), '42');
  await decimal.pressSequentially('2.5.1x');
  assert.equal(await decimal.inputValue(), '2.51');
});

withPage('an empty answer is refused with a code and the question stays open', {}, async (ctx) => {
  const team = await play(ctx);
  const { page, site } = ctx;
  await open(page, 'zone 1');
  await page.click(`${question('zone 1', 'Q1')} ${$('answer-submit')}`);
  await page.waitForSelector(`${question('zone 1', 'Q1')} ${$('form-error')}:not([hidden])`);
  assert.equal(await page.locator(`${question('zone 1', 'Q1')} ${$('form-error')}`).getAttribute('data-error'), 'invalid-answer');
  assert.equal(await stateOf(page, 'zone 1', 'Q1'), 'open');

  await answerWith(page, 'zone 1', 'Q1', 'secret one'); // the question was not used up
  await page.waitForSelector(`${question('zone 1', 'Q1')}[data-state="done"]`);
  assert.equal(await site.api.scoreOf(team.number), 10);
});

withPage('the photo challenge is sent once and appears for the admin to score', {}, async (ctx) => {
  const team = await play(ctx);
  const { page, site } = ctx;
  await open(page, 'zone 2');
  await page.click(`${panel('zone 2')} ${$('photo-submit')}`);
  await page.waitForSelector(`${panel('zone 2')} ${$('photo')}[data-state="done"]`);
  assert.equal(await page.locator(`${panel('zone 2')} ${$('photo-submit')}`).isDisabled(), true);
  assert.deepEqual((await site.api.photosToScore()).map((p) => [p.teamNumber, p.zone, p.decision]), [[team.number, 'zone 2', null]]);
  assert.equal(await site.api.scoreOf(team.number), 0); // nothing scores until the admin decides
});

withPage('submitting something already submitted elsewhere ends up Done, not as an error', {}, async (ctx) => {
  const team = await play(ctx, { refresh: 60000 }); // a page that has not heard about the other submission yet
  const { page } = ctx;
  await open(page, 'zone 1');
  await page.fill(`${question('zone 1', 'Q2')} ${$('answer-input')}`, '42');
  await team.answer('zone 1', 'Q2', '42'); // the same team, from another phone or tab, a moment earlier
  await page.click(`${question('zone 1', 'Q2')} ${$('answer-submit')}`);
  await page.waitForSelector(`${question('zone 1', 'Q2')}[data-state="done"]`);
  assert.equal(await page.locator(`${question('zone 1', 'Q2')} ${$('form-error')}`).isHidden(), true);
});

withPage('a network failure leaves the answer open to try again, and the retry counts once', {}, async (ctx) => {
  const team = await play(ctx);
  const { page, site } = ctx;
  await open(page, 'zone 1');
  let failing = true;
  await page.route('**/api/answer', (route) => (failing ? route.abort() : route.continue()));

  await answerWith(page, 'zone 1', 'Q2', '42');
  await page.waitForSelector(`${question('zone 1', 'Q2')} ${$('form-error')}:not([hidden])`);
  assert.equal(await page.locator(`${question('zone 1', 'Q2')} ${$('form-error')}`).getAttribute('data-error'), 'network');
  assert.equal(await stateOf(page, 'zone 1', 'Q2'), 'open');
  assert.equal(await page.inputValue(`${question('zone 1', 'Q2')} ${$('answer-input')}`), '42'); // still typed in

  failing = false;
  await page.click(`${question('zone 1', 'Q2')} ${$('answer-submit')}`);
  await page.waitForSelector(`${question('zone 1', 'Q2')}[data-state="done"]`);
  assert.equal(await site.api.scoreOf(team.number), 20);
});

withPage('a half-typed answer survives the page refreshing', {}, async (ctx) => {
  await play(ctx);
  const { page } = ctx;
  await open(page, 'zone 1');
  await page.fill(`${question('zone 1', 'Q1')} ${$('answer-input')}`, 'half typ');
  await new Promise((resolve) => setTimeout(resolve, 2000)); // several refreshes at 500 ms
  assert.equal(await page.inputValue(`${question('zone 1', 'Q1')} ${$('answer-input')}`), 'half typ');
  assert.equal(await page.locator(panel('zone 1')).isVisible(), true);
});

withPage('using the zones causes no console errors, failed requests or policy violations', {}, async (ctx) => {
  await play(ctx);
  const { page, problems, cspViolations } = ctx;
  await open(page, 'zone 1');
  await page.click(`${panel('zone 1')} ${$('map-open')}`);
  await page.waitForFunction(() => document.querySelector('[data-testid="map-full"]').complete);
  await page.click($('map-close'));
  await answerWith(page, 'zone 1', 'Q1', 'secret one');
  await page.waitForSelector(`${question('zone 1', 'Q1')}[data-state="done"]`);
  await page.click(`${panel('zone 1')} ${$('zone-back')}`);
  await until(async () => (await page.locator($('zone-tile')).count()) === 2);
  assert.deepEqual(problems, []);
  assert.deepEqual(await cspViolations(), []);
});

withPage('on a phone the tiles, a zone and the full-size map all fit the screen', { page: { viewport: { width: 360, height: 640 } } }, async (ctx) => {
  await play(ctx);
  const { page } = ctx;
  assert.ok((await overflow(page)) <= 0, 'the tiles are wider than the screen');
  await open(page, 'zone 1');
  assert.ok((await overflow(page)) <= 0, 'the zone is wider than the screen');
  await page.click(`${panel('zone 1')} ${$('map-open')}`);
  await page.waitForFunction(() => { const i = document.querySelector('[data-testid="map-full"]'); return i.complete && i.naturalWidth > 0; });
  assert.ok((await overflow(page)) <= 0, 'the full-size map is wider than the screen');
});
