// The /game-events/ admin page in real Chromium: uploading an event (the maps are shrunk by the browser), the list, download
// and delete. Fixture games and generated pictures only. Elements by data-testid; results from data-* attributes and the
// server's state, not wording.
const assert = require('node:assert/strict');
const { browserSuite, until, adminPage, png, START } = require('./helpers.js');

const { withPage } = browserSuite();

const $ = (testId) => `[data-testid="${testId}"]`;
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const GAME = {
  'zone 1': { 'zone-name': 'Reef', 'zone-map': 'docs/maps/reef.png', questions: [{ Q1: 'first?', type: 'string', answer: 'a', score: 10 }, { Q2: 'a photo', type: 'photo', score: 30 }] },
  'zone 2': { 'zone-name': 'Dunes', 'zone-map': 'dunes.png', questions: [{ Q1: 'second?', type: 'whole-number', answer: '7', score: 5 }] },
};
const file = (name, content, mimeType = 'application/octet-stream') => ({ name, mimeType, buffer: Buffer.isBuffer(content) ? content : Buffer.from(content) });
const folder = (over = {}) => [
  file('game-questions.json', JSON.stringify(over.game ?? GAME), 'application/json'),
  file('player-instructions.md', '# Rules\n- be kind', 'text/markdown'),
  file('reef.png', png(2000, 1000, [10, 120, 200]), 'image/png'),
  file('dunes.png', png(400, 300, [200, 180, 80]), 'image/png'),
  ...(over.extra ?? []),
];
const open = async (page, site) => { await adminPage(page, site, '/game-events/?refresh=500'); await page.waitForSelector($('events-list'), { state: 'attached' }); };
const upload = async (page, name, files) => {
  if (name !== null) await page.fill($('event-name'), name);
  await page.setInputFiles($('event-files'), files);
  await page.click($('upload-button'));
  await page.waitForSelector(`${$('upload-result')}:not([hidden])`);
};
const result = (page) => page.locator($('upload-result')).evaluate((e) => [e.dataset.state, e.dataset.error]);

withPage('an event folder is uploaded: checked, maps shrunk in the browser, and the event is listed as ready', {}, async ({ site, page }) => {
  await open(page, site);
  await upload(page, 'summer', folder());
  assert.deepEqual(await result(page), ['ok', '']);
  const summary = await site.events.summary('summer');
  assert.deepEqual([summary.complete, summary.zoneCount, summary.questionCount, summary.hasInstructions], [true, 2, 3, true]);
  await page.waitForSelector(`${$('event')}[data-event="summer"][data-state="complete"]`);

  // The stored maps are small WebP files made by the browser from the big pictures, with the thumbnail smaller than the full size.
  const keys = (await site.blobs.list('summer/game-zones/')).keys;
  assert.deepEqual(keys.sort(), ['summer/game-zones/zone-1-thumb.webp', 'summer/game-zones/zone-1.webp', 'summer/game-zones/zone-2-thumb.webp', 'summer/game-zones/zone-2.webp']);
  const [thumb, full] = [await site.blobs.get('summer/game-zones/zone-1-thumb.webp'), await site.blobs.get('summer/game-zones/zone-1.webp')];
  assert.ok(thumb.length < full.length + 1000 && full.length < 450 * 1024);
  assert.equal(full.toString('ascii', 8, 12), 'WEBP');
  const sizes = await page.evaluate(async ([a, b]) => { const dims = async (buf) => { const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(buf), (c) => c.charCodeAt(0))])); return [bmp.width, bmp.height]; }; return [await dims(a), await dims(b)]; }, [thumb.toString('base64'), full.toString('base64')]);
  assert.deepEqual(sizes, [[320, 160], [1400, 700]]); // never wider than 320 and 1400, in proportion
});

withPage('an event with a missing map image is refused before anything is uploaded, naming the missing file', {}, async ({ site, page }) => {
  await open(page, site);
  await upload(page, 'summer', folder().filter((f) => f.name !== 'dunes.png'));
  assert.deepEqual(await result(page), ['error', 'maps-missing']);
  assert.match(await page.locator($('upload-problems')).textContent(), /dunes\.png/);
  assert.deepEqual(await site.events.names(), []); // nothing stored
});

withPage('questions with problems are refused by the server, shown to the admin, and nothing else is uploaded', {}, async ({ site, page }) => {
  await open(page, site);
  const bad = { 'zone 1': { 'zone-name': 'x', 'zone-map': 'reef.png', questions: [{ Q1: 'q', type: 'string', answer: 'UPPER', score: 1 }] } };
  await upload(page, 'summer', folder({ game: bad }));
  assert.deepEqual(await result(page), ['error', 'invalid-game-data']);
  assert.ok((await page.locator(`${$('upload-problems')} li`).count()) > 0);
  assert.deepEqual(await site.events.names(), []);
});

withPage('the name and the folder are required, and a game file that is not JSON is reported', {}, async ({ site, page }) => {
  await open(page, site);
  await upload(page, 'Bad Name', folder());
  assert.deepEqual(await result(page), ['error', 'invalid-event-name']);
  await upload(page, 'summer', []);
  assert.deepEqual(await result(page), ['error', 'nothing-chosen']);
  await upload(page, 'summer', [file('game-questions.json', '{ not json')]);
  assert.deepEqual(await result(page), ['error', 'bad-json']);
  await upload(page, 'summer', [file('notes.txt', 'x')]);
  assert.deepEqual(await result(page), ['error', 'no-questions']);
  assert.deepEqual(await site.events.names(), []);
});

withPage('a picture the browser cannot read leaves the event incomplete and says so', {}, async ({ site, page }) => {
  await open(page, site);
  await upload(page, 'summer', folder().map((f) => (f.name === 'dunes.png' ? file('dunes.png', 'this is not a picture') : f)));
  assert.deepEqual(await result(page), ['error', 'unreadable-image']);
  await page.waitForSelector(`${$('event')}[data-event="summer"][data-state="incomplete"]`);
  assert.deepEqual((await site.events.summary('summer')).missingMaps, ['zone-2']);
});

withPage('a settings file is stored with the event, and a bad one only warns', {}, async ({ site, page }) => {
  await open(page, site);
  const config = { name: 'Reef day', timeZone: 'Australia/Perth', day: '2026-11-14', start: '10:00', end: '12:00' };
  await upload(page, 'summer', folder({ extra: [file('game-config.json', JSON.stringify(config))] }));
  assert.deepEqual(await result(page), ['ok', '']);
  assert.equal((await site.events.summary('summer')).gameName, 'Reef day');
  await upload(page, 'winter', folder({ extra: [file('game-config.json', JSON.stringify({ name: 'x', day: 'not a day' }))] }));
  assert.deepEqual(await result(page), ['ok', '']); // the event itself was uploaded
  assert.equal(await page.locator(`${$('upload-step')}[data-state="failed"]`).count(), 1);
  assert.equal((await site.events.summary('winter')).config, null);
});

withPage('an event can be replaced, downloaded and deleted (after a confirmation), but not while it is the live game', { site: { now: START - 3_600_000 } }, async ({ site, page }) => {
  await open(page, site);
  await upload(page, 'summer', folder());
  await upload(page, 'winter', folder());
  await page.waitForSelector(`${$('event')}[data-event="winter"]`);
  await page.click(`${$('event')}[data-event="summer"] ${$('event-replace')}`);
  assert.equal(await page.inputValue($('event-name')), 'summer');
  assert.match(await page.locator(`${$('event')}[data-event="winter"] ${$('event-download')}`).getAttribute('href'), /\/api\/admin\/events\/winter\/download$/);

  const config = { name: 'x', timeZone: 'Australia/Perth', day: '2026-11-14', start: '10:00', end: '12:00' };
  assert.equal((await site.api.admin('PUT', '/api/admin/config', { ...config, event: 'summer' })).status, 200);
  await page.waitForSelector(`${$('event')}[data-event="summer"][data-active="true"]`);
  assert.equal(await page.locator(`${$('event')}[data-event="summer"] ${$('event-delete')}`).count(), 0); // the live game's event has no delete

  await page.click(`${$('event')}[data-event="winter"] ${$('event-delete')}`);
  await page.click($('event-delete-no'));
  assert.deepEqual(await site.events.names(), ['summer', 'winter']); // "No" changes nothing
  await page.click(`${$('event')}[data-event="winter"] ${$('event-delete')}`);
  await page.click($('event-delete-yes'));
  await until(async () => (await site.events.names()).length === 1);
  await until(async () => (await page.locator($('event')).count()) === 1); // the list catches up
  await page.waitForSelector($('event') + '[data-event="summer"]');
});

withPage('with a passcode set the page shows only the login box until it is entered', { site: { passcode: true } }, async ({ site, page }) => {
  await page.goto(`${site.url}/game-events/`);
  await page.waitForSelector(`${$('login-panel')}:not([hidden])`);
  assert.equal(await page.locator($('admin-content')).isHidden(), true);
  await adminPage(page, site, '/game-events/');
  await page.waitForSelector($('events-list'), { state: 'attached' });
});

withPage('on a phone the events page fits the screen', { page: { viewport: { width: 360, height: 640 } } }, async ({ site, page }) => {
  await open(page, site);
  await upload(page, 'a-rather-long-event-name-for-a-phone', folder());
  await page.waitForSelector($('event'));
  assert.ok((await overflow(page)) <= 0, 'the events page is wider than the screen');
});
