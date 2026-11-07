#!/usr/bin/env node
// Build step: turns each zone's map image (the PNG named in docs/game-questions.json, ~1 MB each) into two small WebP
// files in dist/maps: <mapId>-thumb.webp for the zone tile and <mapId>.webp for the full-size view. Phones play this
// game on mobile data, so the originals (about 6 MB for five zones) are never served. The files are named with mapId(),
// the same function the API uses for the mapId it sends to the page.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { mapId } = require('../api/lib/gamedata');

const ROOT = path.join(__dirname, '..');
const THUMB_WIDTH = 320;
const FULL_MAX_WIDTH = 1400;

async function buildMaps({ gameFile = path.join(ROOT, 'docs', 'game-questions.json'), rootDir = ROOT, outDir = path.join(ROOT, 'dist', 'maps') } = {}) {
  const game = JSON.parse(fs.readFileSync(gameFile, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const [zoneKey, zone] of Object.entries(game)) {
    const source = path.resolve(rootDir, zone['zone-map']);
    if (!fs.existsSync(source)) throw new Error(`${zoneKey}: map image not found: ${zone['zone-map']}`);
    const id = mapId(zoneKey);
    await sharp(source).resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 75 }).toFile(path.join(outDir, `${id}-thumb.webp`));
    await sharp(source).resize({ width: FULL_MAX_WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(outDir, `${id}.webp`));
    written.push(id);
  }
  return written;
}

module.exports = { buildMaps };

if (require.main === module) {
  buildMaps().then((ids) => console.log(`Map images built for ${ids.length} zones in dist/maps`)).catch((e) => { console.error(e.message); process.exit(1); });
}
