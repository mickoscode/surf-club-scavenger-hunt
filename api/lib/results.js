'use strict';
// A team's final results: its place, and a breakdown of every question and photo challenge with the official answers.
// Pure function; the API only calls it once the admin has published the final results and the caller has a team
// session. Rules: docs/requirements.md ("Results page"). The names (yourAnswer, officialAnswers) deliberately avoid the
// plain key "answer", which no public response may ever contain before publication (a test and the smoke test look for it).
const { roundScore, decisionPercent } = require('./scoring');

const QUESTION_ID = /^Q\d+$/;
const questionId = (q) => Object.keys(q).find((k) => QUESTION_ID.test(k));

// Teams with the same score share a place (1st, 1st, 3rd): the place is one more than the number of teams scoring higher.
function placeOf(team, teams) {
  return 1 + teams.filter((t) => roundScore(t.score) > roundScore(team.score)).length;
}

function buildQuestion(zoneKey, q, team) {
  const id = questionId(q);
  const given = team.subs[`${zoneKey}#${id}`];
  return {
    id,
    text: q[id],
    type: q.type,
    points: q.score,
    answered: Boolean(given),
    yourAnswer: given ? given.answerGiven : null,
    correct: given ? given.correct : null,
    earned: given ? given.points : 0,
    officialAnswers: Array.isArray(q.answer) ? [...q.answer] : [q.answer],
  };
}

// photo: not submitted -> submitted false; submitted but never scored -> scored false, 0%; scored -> 100, 50 or 0 per cent.
function buildPhoto(zoneKey, zone, team) {
  const sent = team.photos[zoneKey];
  const decision = sent?.decision ?? null;
  return {
    challenge: zone['photo-challenge'],
    points: zone['photo-score'],
    submitted: Boolean(sent),
    scored: decision !== null,
    decision,
    percent: !sent ? null : decision === null ? 0 : decisionPercent(decision),
    earned: sent?.points ?? 0,
  };
}

// team: the team's stored item; teams: every team (for the place and the count); game: the game's zones as configured.
function buildResults({ team, teams, game }) {
  return {
    place: placeOf(team, teams),
    teamCount: teams.length,
    total: team.score,
    zones: Object.entries(game).map(([zoneKey, zone]) => ({
      key: zoneKey,
      name: zone['zone-name'],
      questions: zone.questions.map((q) => buildQuestion(zoneKey, q, team)),
      photo: buildPhoto(zoneKey, zone, team),
    })),
  };
}

module.exports = { buildResults, placeOf };
