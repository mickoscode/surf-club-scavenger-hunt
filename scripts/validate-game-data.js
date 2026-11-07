#!/usr/bin/env node
// Checks the STRUCTURE of docs/game-questions.json (never the wording of questions or answers), so a content
// PR that would break the game fails in CI instead of on game day. Format: docs/requirements.md,
// "game-questions.json format". Built-in modules only, so it runs without `npm ci`.
//
//   node scripts/validate-game-data.js [path/to/game-questions.json]
//
// Also exported as validateGameData(data, { rootDir }) for the backend and the tests; it returns a list of
// problems (empty = valid), each saying exactly where the problem is.
const fs = require('node:fs');
const path = require('node:path');

const TYPES = ['string', 'whole-number', 'decimal'];
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
  checkAnswer(question, where, problems);
}

function validateGameData(data, { rootDir = process.cwd() } = {}) {
  const problems = [];
  if (!isObject(data) || Object.keys(data).length === 0) return ['the file must be an object with at least one zone'];
  const names = new Set();
  for (const [key, zone] of Object.entries(data)) {
    const where = key;
    if (!/^zone \d+$/.test(key)) problems.push(`${where}: zone keys must look like "zone 1", "zone 2", ...`);
    if (!isObject(zone)) { problems.push(`${where}: must be an object`); continue; }
    const extra = Object.keys(zone).filter((k) => !['zone-name', 'zone-map', 'photo-challenge', 'photo-score', 'questions'].includes(k));
    if (extra.length) problems.push(`${where}: unknown field(s): ${extra.join(', ')}`);

    if (!isText(zone['zone-name'])) problems.push(`${where}: "zone-name" must be non-empty text`);
    else if (names.has(zone['zone-name'].trim().toLowerCase())) problems.push(`${where}: zone-name "${zone['zone-name']}" is used by another zone`);
    else names.add(zone['zone-name'].trim().toLowerCase());

    if (!isText(zone['zone-map'])) problems.push(`${where}: "zone-map" must be a path to an image`);
    else if (!MAP_EXTENSIONS.includes(path.extname(zone['zone-map']).toLowerCase())) problems.push(`${where}: zone-map must be a ${MAP_EXTENSIONS.join(', ')} file`);
    else if (!fs.existsSync(path.resolve(rootDir, zone['zone-map']))) problems.push(`${where}: zone-map file not found: ${zone['zone-map']}`);

    if (!isText(zone['photo-challenge'])) problems.push(`${where}: "photo-challenge" must be non-empty text`);
    if (!isPoints(zone['photo-score'])) problems.push(`${where}: "photo-score" must be a number, 0 or more`);

    if (!Array.isArray(zone.questions) || zone.questions.length === 0) { problems.push(`${where}: "questions" must be a list with at least one question`); continue; }
    const ids = new Set();
    zone.questions.forEach((q, i) => checkQuestion(q, `${where} question ${i + 1}`, ids, problems));
  }
  return problems;
}

module.exports = { validateGameData };

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const file = path.resolve(process.argv[2] || path.join(root, 'docs', 'game-questions.json'));
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`::error::${path.relative(root, file)} is not readable JSON: ${err.message}`);
    process.exit(1);
  }
  const problems = validateGameData(data, { rootDir: root });
  if (problems.length) {
    problems.forEach((p) => console.error(`::error::${p}`));
    console.error(`${problems.length} problem(s) in ${path.relative(root, file)}`);
    process.exit(1);
  }
  const zones = Object.values(data);
  console.log(`${path.relative(root, file)} is valid: ${zones.length} zones, ${zones.reduce((n, z) => n + z.questions.length, 0)} questions`);
}
