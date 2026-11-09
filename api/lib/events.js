'use strict';
// Events: complete games stored in a private bucket, one folder per event (docs/requirements.md, "Events"):
//   <event>/game-config.json        the game's configuration values (optional until first saved)
//   <event>/game-questions.json     the zones and questions (the format is in docs/requirements.md)
//   <event>/player-instructions.md  the instructions shown on the play page (optional)
//   <event>/game-zones/<map id>.<ext> and <map id>-thumb.<ext>   each zone's map, shrunk by the admin's browser
// This module holds the rules (names, sizes, what counts as an image, what is a complete event) over a `blobs` store
// (api/store/blobs.js). Nothing here is public: only the admin function uses it. The live game never reads events:
// activating one copies it into the game (and its maps into the site's event-maps/ folder).
const { validateGameData, mapId } = require('./gamedata');

const EVENT_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const LIMITS = { events: 100, zones: 20, questionsBytes: 256 * 1024, instructionsBytes: 20 * 1024, imageBytes: 500 * 1024 };
const CONFIG = 'game-config.json';
const QUESTIONS = 'game-questions.json';
const INSTRUCTIONS = 'player-instructions.md';
const MAP_FOLDER = 'game-zones/';
const MAP_PREFIX = 'event-maps/'; // on the site, where an activation's maps are copied

const isEventName = (name) => typeof name === 'string' && EVENT_NAME.test(name);

// What kind of image these bytes are (by content, never by name): webp, jpeg or png.
function sniffImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', contentType: 'image/webp' };
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: 'jpg', contentType: 'image/jpeg' };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', contentType: 'image/png' };
  return null;
}

// Base64 text -> bytes, strictly: anything that is not base64 is refused.
function decodeBase64(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  return Buffer.from(text, 'base64');
}

const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function createEvents({ blobs, siteBlobs, newId }) {
  const read = async (name, file) => blobs.get(`${name}/${file}`);
  const readJson = async (name, file) => {
    const buffer = await read(name, file);
    if (!buffer) return null;
    try { return JSON.parse(buffer.toString('utf8')); } catch { return null; }
  };
  // The maps stored for an event: { "zone-1": { thumb: key, full: key } } (the key says the file type).
  async function storedMaps(name) {
    const { keys } = await blobs.list(`${name}/${MAP_FOLDER}`);
    const maps = {};
    for (const key of keys) {
      const match = /^(.+?)(-thumb)?\.(webp|jpg|png)$/.exec(key.slice(`${name}/${MAP_FOLDER}`.length));
      if (match) (maps[match[1]] ??= {})[match[2] ? 'thumb' : 'full'] = key;
    }
    return maps;
  }

  const events = {
    async names() {
      const { prefixes } = await blobs.list('', { delimiter: '/' });
      return prefixes.map((p) => p.slice(0, -1)).filter(isEventName).sort();
    },

    // What the admin sees of an event, and whether it is complete enough to activate.
    async summary(name) {
      const questions = await readJson(name, QUESTIONS);
      const config = await readJson(name, CONFIG);
      const maps = await storedMaps(name);
      const problems = questions ? validateGameData(questions, { checkMaps: false }) : ['no questions have been uploaded'];
      const zones = questions && problems.length === 0 ? Object.keys(questions) : [];
      const missingMaps = zones.filter((z) => !(maps[mapId(z)]?.thumb && maps[mapId(z)]?.full)).map(mapId);
      return {
        name, config,
        gameName: config?.name ?? null, day: config?.day ?? null,
        zoneCount: zones.length,
        questionCount: zones.reduce((n, z) => n + questions[z].questions.length, 0),
        hasInstructions: Boolean(await read(name, INSTRUCTIONS)),
        problems, missingMaps,
        complete: problems.length === 0 && missingMaps.length === 0,
      };
    },

    async exists(name) { return (await events.names()).includes(name); },

    // The game file as text (a copy of what was uploaded), for the admin to download or edit.
    async download(name) {
      const [config, questions, instructions] = [await readJson(name, CONFIG), await readJson(name, QUESTIONS), await read(name, INSTRUCTIONS)];
      return { name, config, questions, instructions: instructions ? instructions.toString('utf8') : null };
    },

    // ---- writing. Each returns { ok: true } or { ok: false, error, problems? }.
    async putQuestions(name, data, rawBytes) {
      if (rawBytes > LIMITS.questionsBytes) return { ok: false, error: 'file-too-large' };
      const problems = validateGameData(data, { checkMaps: false });
      if (problems.length) return { ok: false, error: 'invalid-game-data', problems };
      if (Object.keys(data).length > LIMITS.zones) return { ok: false, error: 'too-many-zones' };
      if (!(await events.exists(name)) && (await events.names()).length >= LIMITS.events) return { ok: false, error: 'too-many-events' };
      await blobs.put(`${name}/${QUESTIONS}`, json(data), { contentType: 'application/json' });
      // Maps of zones that are no longer in the game are of no use.
      const keep = new Set(Object.keys(data).map(mapId));
      const maps = await storedMaps(name);
      for (const [id, files] of Object.entries(maps)) {
        if (!keep.has(id)) for (const key of Object.values(files)) await blobs.delete(key);
      }
      return { ok: true };
    },

    async putInstructions(name, text) {
      if (typeof text !== 'string') return { ok: false, error: 'invalid-instructions' };
      if (Buffer.byteLength(text) > LIMITS.instructionsBytes) return { ok: false, error: 'file-too-large' };
      if (text.trim() === '') await blobs.delete(`${name}/${INSTRUCTIONS}`); // empty = no instructions
      else await blobs.put(`${name}/${INSTRUCTIONS}`, Buffer.from(text), { contentType: 'text/markdown; charset=utf-8' });
      return { ok: true };
    },

    // One zone's map, as the admin's browser shrank it: { thumb, full } as base64 text.
    async putMap(name, id, { thumb, full }) {
      const questions = await readJson(name, QUESTIONS);
      if (!questions || !Object.keys(questions).some((z) => mapId(z) === id)) return { ok: false, error: 'unknown-zone' };
      const pair = {};
      for (const [part, text] of [['thumb', thumb], ['full', full]]) {
        const bytes = decodeBase64(text);
        const kind = bytes && sniffImage(bytes);
        if (!kind) return { ok: false, error: 'invalid-image', part };
        if (bytes.length > LIMITS.imageBytes) return { ok: false, error: 'file-too-large', part };
        pair[part] = { bytes, kind };
      }
      const old = (await storedMaps(name))[id];
      for (const key of Object.values(old ?? {})) await blobs.delete(key); // a different file type must not leave the old one behind
      for (const [part, { bytes, kind }] of Object.entries(pair)) {
        await blobs.put(`${name}/${MAP_FOLDER}${id}${part === 'thumb' ? '-thumb' : ''}.${kind.ext}`, bytes, { contentType: kind.contentType });
      }
      return { ok: true };
    },

    async putConfig(name, config) {
      await blobs.put(`${name}/${CONFIG}`, json(config), { contentType: 'application/json' });
      return { ok: true };
    },

    async remove(name) { await blobs.deletePrefix(`${name}/`); },

    // ---- activating: everything the live game needs, and the maps copied into the site under a new, unique folder.
    // Returns { ok: true, game, instructions, maps: { "zone 1": { thumb: "/event-maps/<id>/zone-1-thumb.webp", full: ... } } }.
    async activate(name) {
      const summary = await events.summary(name);
      if (summary.problems.length) return { ok: false, error: 'invalid-game-data', problems: summary.problems };
      if (summary.missingMaps.length) return { ok: false, error: 'maps-missing', missing: summary.missingMaps };
      const game = await readJson(name, QUESTIONS);
      const instructions = await read(name, INSTRUCTIONS);
      const stored = await storedMaps(name);
      const folder = `${MAP_PREFIX}${newId()}/`;
      const maps = {};
      for (const zone of Object.keys(game)) {
        const files = stored[mapId(zone)];
        maps[zone] = {};
        for (const part of ['thumb', 'full']) {
          const key = files[part];
          const kind = sniffImage(await blobs.get(key));
          const target = `${folder}${key.slice(`${name}/${MAP_FOLDER}`.length)}`;
          // A new folder each time, so the files never change under a URL and can be cached for good.
          await siteBlobs.put(target, await blobs.get(key), { contentType: kind.contentType, cacheControl: 'public, max-age=31536000, immutable' });
          maps[zone][part] = `/${target}`;
        }
      }
      await siteBlobs.deletePrefix(MAP_PREFIX, { keep: folder }); // the previous activation's maps are no longer needed
      return { ok: true, game, instructions: instructions ? instructions.toString('utf8') : '', maps };
    },
  };
  return events;
}

module.exports = { createEvents, isEventName, sniffImage, decodeBase64, LIMITS };
