'use strict';
// In-memory store: same behaviour as the DynamoDB store (tests/api/contract.js proves it), with no AWS needed.
// Used for local development, the browser tests and the handler tests. Every method is async and returns
// copies, like a real database. See dynamo.js for the data model and the meaning of each method.
const { decisionDelta, photoPoints, roundScore } = require('../lib/scoring');

const copy = (v) => (v === undefined ? v : structuredClone(v));

function createMemoryStore() {
  let game = null;
  let lastNumber = 0;
  const loginFailures = new Map(); // window number -> failed admin logins in it
  let publishedAt = null; // when the final results were published, or null while they are provisional
  const teams = new Map(); // playerId -> team
  const names = new Map(); // key -> playerId

  return {
    async getGame() { return copy(game); },
    async saveGame({ config, game: snapshot, configuredAt = Date.now() }) {
      game = copy({ config, game: snapshot, configuredAt });
    },

    async createTeam({ playerId, name, key, joinedAt = Date.now() }) {
      if (names.has(key)) return { ok: false, error: 'name-taken' };
      const team = { playerId, number: ++lastNumber, name, key, score: 0, joinedAt, subs: {}, photos: {} };
      names.set(key, playerId);
      teams.set(playerId, team);
      return { ok: true, team: copy(team) };
    },
    async getTeam(playerId) { return copy(teams.get(playerId)) ?? null; },
    async listTeams() { return [...teams.values()].map(copy); },
    async removeTeam(playerId) {
      const team = teams.get(playerId);
      if (!team) return false;
      teams.delete(playerId);
      names.delete(team.key);
      return true;
    },

    async recordAnswer(playerId, zoneKey, questionId, { answerGiven, correct, points, at = Date.now() }) {
      const team = teams.get(playerId);
      if (!team) return { ok: false, error: 'no-team' };
      const k = `${zoneKey}#${questionId}`;
      if (team.subs[k]) return { ok: false, error: 'already-submitted' };
      team.subs[k] = { answerGiven, correct, points, at };
      team.score = roundScore(team.score + points);
      return { ok: true, score: team.score };
    },
    async recordPhotoSent(playerId, zoneKey, { at = Date.now() } = {}) {
      const team = teams.get(playerId);
      if (!team) return { ok: false, error: 'no-team' };
      if (team.photos[zoneKey]) return { ok: false, error: 'already-submitted' };
      team.photos[zoneKey] = { sentAt: at };
      return { ok: true };
    },
    async applyPhotoDecision(playerId, zoneKey, { decision, photoScore, at = Date.now() }) {
      const team = teams.get(playerId);
      if (!team) return { ok: false, error: 'no-team' };
      const photo = team.photos[zoneKey];
      if (!photo) return { ok: false, error: 'no-photo' };
      const delta = decisionDelta(photoScore, photo.decision ?? null, decision);
      photo.decision = decision;
      photo.points = photoPoints(photoScore, decision);
      photo.appliedAt = at;
      team.score = roundScore(team.score + delta);
      return { ok: true, delta, score: team.score };
    },

    // Final results: published once (the first time wins, so publishing twice changes nothing) and undone with unpublishResults.
    async getPublishedAt() { return publishedAt; },
    async publishResults(at = Date.now()) {
      publishedAt ??= at;
      return publishedAt;
    },
    async unpublishResults() { publishedAt = null; },

    // Failed admin logins are counted in fixed windows (windowMs long): the login refuses once a window has too many.
    async getLoginFailures(now, windowMs) { return loginFailures.get(Math.floor(now / windowMs)) ?? 0; },
    async registerLoginFailure(now, windowMs) {
      const window = Math.floor(now / windowMs);
      loginFailures.set(window, (loginFailures.get(window) ?? 0) + 1);
      return loginFailures.get(window);
    },
    async clearLoginFailures(now, windowMs) { loginFailures.delete(Math.floor(now / windowMs)); },

    async exportAll() { return { game: copy(game), teams: [...teams.values()].map(copy) }; },
    // Removes teams, their names and the team numbering, and returns the results to provisional; the configured game stays.
    async deleteAllPlayerData() {
      teams.clear();
      names.clear();
      lastNumber = 0;
      publishedAt = null;
    },
  };
}

module.exports = { createMemoryStore };
