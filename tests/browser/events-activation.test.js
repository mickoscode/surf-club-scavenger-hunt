// Choosing an event for the live game on /game-config/, and what players then see from it: its maps and its instructions
// (shown as text by a small safe renderer). Fixture games and generated pictures only. Elements by data-testid; state from
// data-* attributes.
const assert = require('node:assert/strict');
const { browserSuite, signIn, until, png, START } = require('./helpers.js');

const { withPage } = browserSuite();

const $ = (testId) => `[data-testid="${testId}"]`;
const BEFORE = { site: { now: START - 3_600_000 } };
const PICTURE = png(40, 30, [20, 100, 180]).toString('base64');
const GAME = {
  'zone 1': { 'zone-name': 'Reef', 'zone-map': 'reef.png', questions: [{ Q1: 'first?', type: 'string', answer: 'a', score: 10 }, { Q2: 'a photo', type: 'photo', score: 30 }] },
  'zone 2': { 'zone-name': 'Dunes', 'zone-map': 'dunes.png', questions: [{ Q1: 'second?', type: 'whole-number', answer: '7', score: 5 }] },
};
const SETTINGS = { name: 'Reef day', timeZone: 'Australia/Perth', day: '2026-11-14', start: '10:00', end: '12:00' };

// An event prepared through the admin API, as the events page does it.
async function prepare(site, name, { instructions = '# Rules\n- be **kind**\n  - to everyone', game = GAME, config } = {}) {
  const put = async (path, body) => { const res = await site.api.admin('PUT', `/api/admin/events/${name}${path}`, body); assert.equal(res.status, 200, JSON.stringify(res.body)); };
  await put('/questions', game);
  if (instructions) await put('/instructions', { text: instructions });
  for (const zone of Object.keys(game)) await put(`/maps/${zone.replace(' ', '-')}`, { thumb: PICTURE, full: PICTURE });
  if (config) await put('/config', config);
}
const open = async (page, site) => {
  await page.goto(`${site.url}/game-config/?refresh=500`);
  await page.waitForSelector(`${$('game-status')}:not([data-status="loading"])`);
};
const choose = async (page, name) => {
  await page.waitForSelector(`${$('config-event')} option[value="${name}"]`, { state: 'attached' });
  await page.selectOption($('config-event'), name);
};
const save = async (page) => { await page.click($('config-save')); await page.waitForSelector(`${$('config-success')}:not([hidden]), ${$('config-error')}:not([hidden])`); };
const errorCode = (page) => page.locator($('config-error')).getAttribute('data-error');
const imagesLoaded = (page, selector) => page.waitForFunction((sel) => { const imgs = [...document.querySelectorAll(sel)]; return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0); }, selector, { timeout: 8000 });

withPage('an event is chosen on the config page, its settings fill the form, and saving makes it the live game', BEFORE, async ({ site, page }) => {
  await prepare(site, 'summer', { config: SETTINGS });
  await prepare(site, 'winter', { config: { ...SETTINGS, name: 'Winter hunt', joinCode: 'WINTER1' } });
  await open(page, site);
  assert.equal(await page.inputValue($('config-event')), ''); // nothing is live yet
  await choose(page, 'winter');
  assert.equal(await page.inputValue($('config-name')), 'Winter hunt'); // the event's settings
  assert.equal(await page.inputValue($('config-join-code')), 'WINTER1');
  await save(page);
  assert.equal(await page.locator($('config-success')).isVisible(), true);
  await until(async () => (await page.locator($('status-detail')).getAttribute('data-event')) === 'winter');
  assert.equal((await site.api.config()).event, 'winter');
  assert.equal(await page.inputValue($('config-event')), 'winter');
});

withPage('an event that is not complete cannot be chosen', BEFORE, async ({ site, page }) => {
  await site.api.admin('PUT', '/api/admin/events/half/questions', GAME); // no maps
  await open(page, site);
  await page.waitForSelector(`${$('config-event')} option[value="half"]`, { state: 'attached' });
  assert.equal(await page.locator(`${$('config-event')} option[value="half"]`).isDisabled(), true);
});

withPage('another event cannot replace a game that has teams, and works once the player data is deleted; the same event can be saved again', BEFORE, async ({ site, page }) => {
  await prepare(site, 'summer', { config: SETTINGS });
  await prepare(site, 'winter', { config: SETTINGS });
  await open(page, site);
  await choose(page, 'summer');
  await save(page);
  await site.api.join('Sea Dogs');
  await choose(page, 'winter');
  await save(page);
  assert.equal(await errorCode(page), 'players-exist');
  assert.equal((await site.api.config()).event, 'summer');
  await choose(page, 'summer');
  await save(page);
  assert.equal(await page.locator($('config-success')).isVisible(), true); // the same event again keeps the team
  assert.equal((await site.api.admin('GET', '/api/admin/teams')).body.teams.length, 1);
  await site.api.admin('POST', '/api/admin/delete-all', { confirm: 'delete' });
  await choose(page, 'winter');
  await save(page);
  assert.equal(await page.locator($('config-success')).isVisible(), true);
});

withPage('the event chooser is locked while the game is in progress', BEFORE, async ({ site, page }) => {
  await prepare(site, 'summer', { config: SETTINGS });
  await open(page, site);
  await choose(page, 'summer');
  await save(page);
  site.clock.now = START + 60_000;
  await until(async () => (await page.locator($('game-status')).getAttribute('data-status')) === 'active');
  assert.equal(await page.locator($('config-event')).isDisabled(), true);
});

withPage("players see the event's maps and instructions, rendered as text with bold and nested lists", BEFORE, async ({ site, page, context }) => {
  await prepare(site, 'summer', { config: SETTINGS, instructions: '# Rules\n- be **kind**\n  - to everyone\n\n<script>window.pwned = 1</script> and <b>not bold</b>' });
  await site.api.configure({ event: 'summer' });
  const team = await site.api.join('Sea Dogs');
  site.clock.now = START + 60_000;
  await signIn(context, site.url, team);
  await page.goto(`${site.url}/play/?refresh=500`);
  await page.waitForSelector($('zone-tile'));

  const body = page.locator('[data-testid="instructions"] .instructions');
  assert.equal(await body.locator('h2').count(), 1);
  assert.equal(await body.locator('li strong').textContent(), 'kind');
  assert.equal(await body.locator('li li').count(), 1); // the nested list
  assert.match(await body.textContent(), /<script>window\.pwned = 1<\/script> and <b>not bold<\/b>/); // shown as written
  assert.equal(await body.locator('script, b').count(), 0);
  assert.equal(await page.evaluate(() => window.pwned), undefined);

  await imagesLoaded(page, `${$('zone-tile')} img`); // the maps come from the event (/event-maps/...)
  assert.match(await page.locator(`${$('zone-tile')} img`).first().getAttribute('src'), /^\/event-maps\/act\d+\/zone-1-thumb\./);
  await page.click(`${$('zone-tile')}[data-zone="zone 1"]`);
  await page.click($('map-open'));
  await imagesLoaded(page, $('map-full'));
  assert.match(await page.locator($('map-full')).getAttribute('src'), /^\/event-maps\/act\d+\/zone-1\./);
});

withPage('an event without instructions has no Instructions panel, and the WhatsApp links work in an event\'s instructions', BEFORE, async ({ site, page, context }) => {
  await prepare(site, 'plain', { config: SETTINGS, instructions: null });
  await prepare(site, 'chatty', { config: SETTINGS, instructions: 'Send photos to WhatsApp please' });
  await site.api.configure({ event: 'plain', whatsappUrl: 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv' });
  const team = await site.api.join('Sea Dogs');
  await signIn(context, site.url, team);
  await page.goto(`${site.url}/play/?refresh=500`);
  await page.waitForSelector(`${$('team-number')}[data-team-number="1"]`);
  await until(async () => (await page.locator($('instructions')).isHidden()));
  await site.api.admin('POST', '/api/admin/delete-all', { confirm: 'delete' });
  await site.api.configure({ event: 'chatty', whatsappUrl: 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv' });
  const again = await site.api.join('Sea Dogs');
  await signIn(context, site.url, again);
  await page.reload();
  await page.waitForSelector(`${$('instructions')}:not([hidden])`);
  await page.waitForSelector('[data-testid="instructions"] a[data-whatsapp-link]', { state: 'attached' }); // the word became a link after the text was rebuilt
});
