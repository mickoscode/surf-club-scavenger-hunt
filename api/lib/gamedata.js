'use strict';
// Checks the STRUCTURE of the game file (an event's game-questions.json; docs/game-questions.json is the example), never the wording of questions or answers.
// Format: docs/requirements.md, "game-questions.json format". Used by the CI check (scripts/validate-game-data.js)
// and by the backend when the admin saves the game config. Built-in modules only.
//
// validateGameData(data, { rootDir, checkMaps }) returns a list of problems (empty = valid), each saying exactly
// where the problem is. checkMaps: false skips the check that map files exist (the backend has no images; CI has
// already checked them).
const fs = require('node:fs');
const path = require('node:path');

const TYPES = ['string', 'whole-number', 'decimal', 'photo']; // a photo challenge is a question of type photo: sent by WhatsApp, scored by the admin
const MAP_EXTENSIONS = ['.png', '.jpg', '.jpeg'];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isPoints = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function checkAnswer(question, where, problems) {
  const { type, answer } = question;
  if (type === 'string') {
    const answers = Array.isArray(answer) ? answer : [answer];
    if (answers.length === 0) problems.push(`${where}: "answer" must not be an empty list`);
    answers.forEach((a) => {
      if (!isText(a)) problems.push(`${where}: each string answer must be non-empty text`);
      else if (a !== a.trim().toLowerCase()) problems.push(`${where}: answer "${a}" must be lower case with no leading/trailing spaces (players' answers are compared in lower case)`);
    });
  } else if (type === 'whole-number') {
    if (typeof answer !== 'string' || !/^\d+$/.test(answer)) problems.push(`${where}: a whole-number answer must be digits only, written as text, e.g. "42"`);
  } else if (type === 'decimal') {
    if (typeof answer !== 'string' || !/^\d+(\.\d+)?$/.test(answer)) problems.push(`${where}: a decimal answer must look like "2.5" (digits, optional point, no minus sign), written as text`);
  }
}

function checkQuestion(question, where, ids, problems) {
  if (!isObject(question)) return problems.push(`${where}: must be an object`);
  const idKeys = Object.keys(question).filter((k) => /^Q\d+$/.test(k));
  if (idKeys.length !== 1) return problems.push(`${where}: needs exactly one question-text key named Q1, Q2, ...`);
  const [id] = idKeys;
  where = `${where} (${id})`;
  if (ids.has(id)) problems.push(`${where}: duplicate question id in this zone`);
  ids.add(id);
  if (!isText(question[id])) problems.push(`${where}: question text must be non-empty text`);
  const extra = Object.keys(question).filter((k) => k !== id && !['type', 'answer', 'score'].includes(k));
  if (extra.length) problems.push(`${where}: unknown field(s): ${extra.join(', ')}`);
  if (!TYPES.includes(question.type)) return problems.push(`${where}: "type" must be one of ${TYPES.join(', ')}`);
  if (!isPoints(question.score)) problems.push(`${where}: "score" must be a number, 0 or more`);
  if (question.type === 'photo') {
    if (question.answer !== undefined) problems.push(`${where}: a photo challenge has no "answer" (the admin scores the photo)`);
    return;
  }
  checkAnswer(question, where, problems);
}

function validateGameData(data, { rootDir = process.cwd(), checkMaps = true } = {}) {
  const problems = [];
  if (!isObject(data) || Object.keys(data).length === 0) return ['the file must be an object with at least one zone'];
  const names = new Set();
  for (const [key, zone] of Object.entries(data)) {
    const where = key;
    if (!/^zone \d+$/.test(key)) problems.push(`${where}: zone keys must look like "zone 1", "zone 2", ...`);
    if (!isObject(zone)) { problems.push(`${where}: must be an object`); continue; }
    const extra = Object.keys(zone).filter((k) => !['zone-name', 'zone-map', 'questions', 'photo-challenge', 'photo-score', 'photos'].includes(k)); // the old photo fields get their own message below
    if (extra.length) problems.push(`${where}: unknown field(s): ${extra.join(', ')}`);

    if (!isText(zone['zone-name'])) problems.push(`${where}: "zone-name" must be non-empty text`);
    else if (names.has(zone['zone-name'].trim().toLowerCase())) problems.push(`${where}: zone-name "${zone['zone-name']}" is used by another zone`);
    else names.add(zone['zone-name'].trim().toLowerCase());

    if (!isText(zone['zone-map'])) problems.push(`${where}: "zone-map" must be a path to an image`);
    else if (!MAP_EXTENSIONS.includes(path.extname(zone['zone-map']).toLowerCase())) problems.push(`${where}: zone-map must be a ${MAP_EXTENSIONS.join(', ')} file`);
    else if (checkMaps && !fs.existsSync(path.resolve(rootDir, zone['zone-map']))) problems.push(`${where}: zone-map file not found: ${zone['zone-map']}`);

    if (zone['photo-challenge'] !== undefined || zone['photo-score'] !== undefined || zone.photos !== undefined) problems.push(`${where}: photo challenges are questions with "type": "photo" (and a "score", no "answer") in the "questions" list`);
    if (!Array.isArray(zone.questions) || zone.questions.length === 0) { problems.push(`${where}: "questions" must be a list with at least one question or photo challenge`); continue; }
    const ids = new Set();
    zone.questions.forEach((q, i) => checkQuestion(q, `${where} question ${i + 1}`, ids, problems));
  }
  return problems;
}

// "zone 1" -> "zone-1": names a zone's map image files (dist/maps/zone-1.webp, zone-1-thumb.webp). The API sends it
// as mapId and the site build (scripts/build-maps.js) writes the files with it, so both must use this one function.
const mapId = (zoneKey) => zoneKey.trim().replace(/\s+/g, '-');

module.exports = { validateGameData, mapId };
