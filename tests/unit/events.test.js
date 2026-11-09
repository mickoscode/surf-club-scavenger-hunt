// The rules for events (games kept in a private bucket): names, what counts as an image, sizes, what is complete, and what
// activating does. In-memory files; fixture games only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryBlobs } = require('../../api/store/blobs.js');
const { createEvents, isEventName, sniffImage, decodeBase64, LIMITS } = require('../../api/lib/events.js');

const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
const b64 = (buffer) => buffer.toString('base64');
const GAME = {
  'zone 1': { 'zone-name': 'One', 'zone-map': 'one.png', questions: [{ Q1: 'q?', type: 'string', answer: 'a', score: 5 }, { Q2: 'photo', type: 'photo', score: 10 }] },
  'zone 2': { 'zone-name': 'Two', 'zone-map': 'two.png', questions: [{ Q1: 'q?', type: 'whole-number', answer: '4', score: 5 }] },
};
const size = (game) => Buffer.byteLength(JSON.stringify(game));

function setup() {
  const [blobs, siteBlobs] = [createMemoryBlobs(), createMemoryBlobs()];
  let n = 0;
  return { blobs, siteBlobs, events: createEvents({ blobs, siteBlobs, newId: () => `id${++n}` }) };
}
async function complete(events, name = 'summer') {
  assert.equal((await events.putQuestions(name, GAME, size(GAME))).ok, true);
  for (const id of ['zone-1', 'zone-2']) assert.equal((await events.putMap(name, id, { thumb: b64(WEBP), full: b64(WEBP) })).ok, true);
}

test('event names are short lower case words: no path tricks, capitals or spaces', () => {
  for (const ok of ['summer', 'demo-1', 'a', '2026-real-game', 'x'.repeat(40)]) assert.equal(isEventName(ok), true, ok);
  for (const bad of ['', 'Summer', 'a b', '../x', 'a/b', '-lead', 'x'.repeat(41), '.hidden', 'a.b', 'ünï', null, 5, undefined]) assert.equal(isEventName(bad), false, String(bad));
});

test('an image is recognised by its content, not its name, and only webp, jpeg and png are images', () => {
  assert.deepEqual([sniffImage(WEBP).ext, sniffImage(JPEG).ext, sniffImage(PNG).ext], ['webp', 'jpg', 'png']);
  for (const bad of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), Buffer.from('GIF89a......'), Buffer.from('hello world, not an image'), Buffer.alloc(3), null]) assert.equal(sniffImage(bad), null);
});

test('base64 is decoded strictly', () => {
  assert.deepEqual(decodeBase64(b64(Buffer.from('hello world'))), Buffer.from('hello world'));
  for (const bad of ['', 'not base64!', 'abc', 123, null, 'aGVsbG8=\n', 'a'.repeat(4) + '=a']) assert.equal(decodeBase64(bad), null, String(bad));
});

test('questions are validated before anything is stored, and the stored file is what was uploaded', async () => {
  const { events, blobs } = setup();
  const bad = await events.putQuestions('summer', { 'zone 1': { 'zone-name': 'x' } }, 100);
  assert.deepEqual([bad.ok, bad.error], [false, 'invalid-game-data']);
  assert.ok(bad.problems.length > 0);
  assert.equal(await blobs.get('summer/game-questions.json'), null); // nothing was stored
  assert.equal((await events.putQuestions('summer', GAME, size(GAME))).ok, true);
  assert.deepEqual(JSON.parse((await blobs.get('summer/game-questions.json')).toString()), GAME);
});

test('limits: file size, number of zones and number of events', async () => {
  const { events } = setup();
  assert.equal((await events.putQuestions('big', GAME, LIMITS.questionsBytes + 1)).error, 'file-too-large');
  const many = Object.fromEntries(Array.from({ length: LIMITS.zones + 1 }, (_, i) => [`zone ${i + 1}`, { 'zone-name': `Z${i}`, 'zone-map': 'a.png', questions: [{ Q1: 'q', type: 'photo', score: 1 }] }]));
  assert.equal((await events.putQuestions('many', many, 100)).error, 'too-many-zones');
  for (let i = 0; i < LIMITS.events; i++) assert.equal((await events.putQuestions(`event-${i}`, GAME, 100)).ok, true);
  assert.equal((await events.putQuestions('one-too-many', GAME, 100)).error, 'too-many-events');
  assert.equal((await events.putQuestions('event-3', GAME, 100)).ok, true); // an existing event can still be updated
});

test('a map is checked: a real image, small enough, for a zone of the event; the file type is kept and nothing stale is left', async () => {
  const { events, blobs } = setup();
  await events.putQuestions('summer', GAME, 100);
  const ok = { thumb: b64(WEBP), full: b64(WEBP) };
  assert.equal((await events.putMap('summer', 'zone-9', ok)).error, 'unknown-zone');
  assert.deepEqual(await events.putMap('summer', 'zone-1', { thumb: b64(Buffer.from('not an image at all')), full: b64(WEBP) }), { ok: false, error: 'invalid-image', part: 'thumb' });
  assert.deepEqual(await events.putMap('summer', 'zone-1', { thumb: b64(WEBP), full: 'not base64!' }), { ok: false, error: 'invalid-image', part: 'full' });
  assert.deepEqual(await events.putMap('summer', 'zone-1', { thumb: b64(WEBP), full: b64(Buffer.concat([WEBP, Buffer.alloc(LIMITS.imageBytes)])) }), { ok: false, error: 'file-too-large', part: 'full' });
  assert.equal((await blobs.list('summer/game-zones/')).keys.length, 0);

  assert.equal((await events.putMap('summer', 'zone-1', ok)).ok, true);
  assert.deepEqual((await blobs.list('summer/game-zones/')).keys, ['summer/game-zones/zone-1-thumb.webp', 'summer/game-zones/zone-1.webp']);
  assert.equal((await events.putMap('summer', 'zone-1', { thumb: b64(JPEG), full: b64(PNG) })).ok, true); // replaced, with other types
  assert.deepEqual((await blobs.list('summer/game-zones/')).keys, ['summer/game-zones/zone-1-thumb.jpg', 'summer/game-zones/zone-1.png']);
});

test('uploading new questions removes the maps of zones that are gone', async () => {
  const { events, blobs } = setup();
  await complete(events);
  const one = { 'zone 1': GAME['zone 1'] };
  assert.equal((await events.putQuestions('summer', one, size(one))).ok, true);
  assert.deepEqual((await blobs.list('summer/game-zones/')).keys.sort(), ['summer/game-zones/zone-1-thumb.webp', 'summer/game-zones/zone-1.webp']);
});

test('an event is complete when its questions are valid and every zone has both map files', async () => {
  const { events } = setup();
  await events.putQuestions('summer', GAME, size(GAME));
  let summary = await events.summary('summer');
  assert.deepEqual([summary.complete, summary.zoneCount, summary.questionCount, summary.missingMaps], [false, 2, 3, ['zone-1', 'zone-2']]);
  await events.putMap('summer', 'zone-1', { thumb: b64(WEBP), full: b64(WEBP) });
  await events.putMap('summer', 'zone-2', { thumb: b64(WEBP), full: b64(WEBP) });
  summary = await events.summary('summer');
  assert.deepEqual([summary.complete, summary.missingMaps, summary.hasInstructions], [true, [], false]);
  await events.putInstructions('summer', '# Rules\n- be kind');
  assert.equal((await events.summary('summer')).hasInstructions, true);
  await events.putInstructions('summer', '   '); // empty removes them
  assert.equal((await events.summary('summer')).hasInstructions, false);
  assert.equal((await events.putInstructions('summer', 'x'.repeat(LIMITS.instructionsBytes + 1))).error, 'file-too-large');
});

test('activating copies the maps into a new folder on the site, caches them for good, and removes the previous activation', async () => {
  const { events, siteBlobs } = setup();
  await complete(events);
  await events.putInstructions('summer', 'Be kind');
  const first = await events.activate('summer');
  assert.equal(first.ok, true);
  assert.equal(first.instructions, 'Be kind');
  assert.deepEqual(first.maps['zone 1'], { thumb: '/event-maps/id1/zone-1-thumb.webp', full: '/event-maps/id1/zone-1.webp' });
  assert.match(siteBlobs.meta('event-maps/id1/zone-1.webp').cacheControl, /immutable/);
  assert.equal(siteBlobs.meta('event-maps/id1/zone-1.webp').contentType, 'image/webp');

  const second = await events.activate('summer');
  assert.equal(second.maps['zone 1'].full, '/event-maps/id2/zone-1.webp');
  assert.deepEqual((await siteBlobs.list('event-maps/')).keys.every((k) => k.startsWith('event-maps/id2/')), true); // the old folder is gone
  assert.equal((await siteBlobs.list('event-maps/')).keys.length, 4);
});

test('an incomplete or invalid event cannot be activated', async () => {
  const { events, siteBlobs } = setup();
  assert.equal((await events.activate('nothing')).error, 'invalid-game-data');
  await events.putQuestions('half', GAME, size(GAME));
  const half = await events.activate('half');
  assert.deepEqual([half.error, half.missing], ['maps-missing', ['zone-1', 'zone-2']]);
  assert.equal((await siteBlobs.list('')).keys.length, 0); // nothing was copied
});

test('removing an event removes every file of it and nothing else', async () => {
  const { events, blobs } = setup();
  await complete(events, 'one');
  await complete(events, 'two');
  await events.remove('one');
  assert.deepEqual(await events.names(), ['two']);
  assert.equal((await blobs.list('one/')).keys.length, 0);
  assert.equal((await events.summary('two')).complete, true);
});

test('download gives the config, the questions and the instructions', async () => {
  const { events } = setup();
  await complete(events);
  await events.putConfig('summer', { name: 'Summer' });
  await events.putInstructions('summer', 'Hi');
  assert.deepEqual(await events.download('summer'), { name: 'summer', config: { name: 'Summer' }, questions: GAME, instructions: 'Hi' });
});
