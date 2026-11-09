// Working out what to upload for an event from the files the admin chose (a folder, or several files). Pure functions: no
// DOM, no network, tested in Node. The files are anything with a `name` (and maybe a `webkitRelativePath`).
//
// An event folder holds game-questions.json, optionally player-instructions.md and game-config.json, and the zones' map
// images (named in each zone's "zone-map", wherever they sit in the folder).

const lower = (s) => String(s).toLowerCase();
export const baseName = (path) => String(path).split(/[\\/]/).pop();

// The chosen files by the file name they are known by (the last of two files with the same name wins).
export function indexFiles(files) {
  const byName = new Map();
  for (const file of files) byName.set(lower(baseName(file.name)), file);
  return byName;
}

// A suggestion for the event's name from the folder chosen: "Summer Hunt 2026" -> "summer-hunt-2026" (or '' if nothing usable).
export function suggestName(files) {
  const first = [...files].find((f) => f.webkitRelativePath);
  const folder = first ? first.webkitRelativePath.split('/')[0] : '';
  return folder.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

// "zone 1" -> "zone-1": the same rule as the server (api/lib/gamedata.js, mapId), which names the stored map files.
export const mapIdOf = (zoneKey) => zoneKey.trim().replace(/\s+/g, '-');

// What to upload: the three data files (or null when not chosen) and, for each zone of the game file, the map image chosen
// for it (or null). `game` is the parsed game-questions.json.
export function planUpload(files, game) {
  const byName = indexFiles(files);
  const zones = Object.entries(game ?? {}).map(([key, zone]) => {
    const wanted = typeof zone?.['zone-map'] === 'string' ? lower(baseName(zone['zone-map'])) : '';
    return { key, mapId: mapIdOf(key), mapName: wanted ? baseName(zone['zone-map']) : '', file: wanted ? byName.get(wanted) ?? null : null };
  });
  return {
    questions: byName.get('game-questions.json') ?? null,
    instructions: byName.get('player-instructions.md') ?? null,
    config: byName.get('game-config.json') ?? null,
    zones,
    missingMaps: zones.filter((z) => !z.file).map((z) => z.mapName || z.key),
  };
}
