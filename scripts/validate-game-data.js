#!/usr/bin/env node
// CI check for the structure of docs/game-questions.json (never the wording of questions or answers).
// The rules live in api/lib/gamedata.js, which the backend also uses when the admin saves the game config.
//
//   node scripts/validate-game-data.js [path/to/game-questions.json]
const fs = require('node:fs');
const path = require('node:path');
const { validateGameData } = require('../api/lib/gamedata');

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
