'use strict';
// How far through the game a team is: the number of questions and photo challenges (photo challenges are questions of
// type "photo") in the whole game, and how many of them a team has attempted, right or wrong. Counts say nothing about
// correctness. Only questions that are in the game as configured are counted. Pure functions.

const QUESTION_ID = /^Q\d+$/;
const questionId = (q) => Object.keys(q).find((k) => QUESTION_ID.test(k));

// Every question and photo challenge of every zone.
const countQuestions = (game) => Object.values(game ?? {}).reduce((n, zone) => n + (zone.questions?.length ?? 0), 0);

// Answers given and photos sent by a team, for questions that exist in the game.
function countDone(team, game) {
  let n = 0;
  for (const [zoneKey, zone] of Object.entries(game ?? {})) {
    for (const q of zone.questions ?? []) {
      const key = `${zoneKey}#${questionId(q)}`;
      if (q.type === 'photo' ? team.photos?.[key] : team.subs?.[key]) n += 1;
    }
  }
  return n;
}

module.exports = { countQuestions, countDone };
