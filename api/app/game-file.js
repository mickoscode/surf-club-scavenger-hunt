'use strict';
// Where the backend gets the zones and questions from when the admin saves the game config.
// In AWS the deploy puts a copy of docs/game-questions.json next to the code (api/game-questions.json);
// when developing locally it falls back to the file in docs/. GAME_QUESTIONS_FILE overrides both.
const fs = require('node:fs');
const path = require('node:path');

function loadGameData(env = process.env) {
  const candidates = [
    env.GAME_QUESTIONS_FILE,
    path.join(__dirname, '..', 'game-questions.json'),
    path.join(__dirname, '..', '..', 'docs', 'game-questions.json'),
  ].filter(Boolean);
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) throw new Error('game-questions.json not found');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = { loadGameData };
