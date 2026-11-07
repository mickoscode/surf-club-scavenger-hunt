'use strict';
// The API. Two roles share this code but are deployed as separate Lambda functions with separate permissions:
//   public: join, play, scoreboard (everyone)         admin: config, scoring, teams, export/delete (no login: see docs)
// Everything is decided here on the server: timing, answer checking, scoring. The browser never receives an
// official answer, and never receives what a team submitted. Rules: docs/requirements.md.
const crypto = require('node:crypto');
const { HttpError, respond, parseCookies, sessionCookie, readJson, COOKIE_NAME } = require('./http');
const { gameStatus, describeGame, can, validateConfig, AU_TIME_ZONES, DEFAULT_GAME_NAME, DEFAULT_TIME_ZONE } = require('../lib/gamestate');
const { checkAnswer } = require('../lib/answers');
const { questionPoints, isDecision } = require('../lib/scoring');
const { validateTeamName, sortScoreboard } = require('../lib/teams');
const { validateGameData } = require('../lib/gamedata');

const PLAYER_ID = /^[0-9a-f]{32}$/;
const QUESTION_ID = /^Q\d+$/;
const CACHEABLE = { 'cache-control': 'public, max-age=3' }; // the same for everyone, so CloudFront may share it briefly

const questionId = (q) => Object.keys(q).find((k) => QUESTION_ID.test(k));
// Own properties only: a request naming a zone "__proto__" or "constructor" must be "not found", not an error.
const findZone = (game, key) => (typeof key === 'string' && game && Object.hasOwn(game, key) ? game[key] : undefined);
const mapId = (zoneKey) => zoneKey.trim().replace(/\s+/g, '-'); // "zone 1" -> "zone-1": names the map image files

// The zones as players may see them: no answers, ever.
const publicZones = (game) => Object.entries(game).map(([key, zone]) => ({
  key,
  name: zone['zone-name'],
  mapId: mapId(key),
  photoChallenge: zone['photo-challenge'],
  photoScore: zone['photo-score'],
  questions: zone.questions.map((q) => ({ id: questionId(q), text: q[questionId(q)], type: q.type, score: q.score })),
}));

function createApp({
  store,
  now = Date.now,
  newId = () => crypto.randomBytes(16).toString('hex'),
  loadGameData,
  role,
  cookieSecure = true,
}) {
  if (role !== 'public' && role !== 'admin') throw new Error('role must be "public" or "admin"');

  async function snapshot() {
    const saved = await store.getGame();
    const config = saved?.config ?? null;
    const t = now();
    return { saved, config, t, status: gameStatus(config, t), info: describeGame(config, t) };
  }
  async function sessionTeam(request) {
    const id = parseCookies(request.headers.cookie)[COOKIE_NAME];
    return id && PLAYER_ID.test(id) ? store.getTeam(id) : null;
  }
  const requireTeam = async (request) => {
    const team = await sessionTeam(request);
    if (!team) throw new HttpError(401, 'no-session');
    return team;
  };
  const teamByNumber = async (number) => (await store.listTeams()).find((t) => t.number === number) ?? null;
  const summary = (team) => ({ number: team.number, name: team.name, score: team.score });

  // ---------------------------------------------------------------- public routes
  const publicRoutes = {
    'GET /api/health': async () => respond(200, { ok: true }),

    'GET /api/game': async () => {
      const { saved, info, status } = await snapshot();
      // Questions are only sent while the game is active, so nobody can read them before the start.
      const zones = status === 'active' ? publicZones(saved.game) : [];
      return respond(200, { game: { name: saved?.config?.name ?? DEFAULT_GAME_NAME, ...info }, zones }, CACHEABLE);
    },

    'GET /api/scoreboard': async () => {
      const { saved, info } = await snapshot();
      const teams = sortScoreboard((await store.listTeams()).map(summary));
      return respond(200, { game: { name: saved?.config?.name ?? DEFAULT_GAME_NAME, ...info }, teams }, CACHEABLE);
    },

    // The caller's own team and which forms they have already submitted (never what they submitted).
    'GET /api/me': async (request) => {
      const team = await sessionTeam(request);
      if (!team) return respond(200, { team: null });
      return respond(200, {
        team: summary(team),
        done: { answers: Object.keys(team.subs), photos: Object.keys(team.photos) },
      });
    },

    'POST /api/join': async (request) => {
      const body = readJson(request);
      const existing = await sessionTeam(request);
      if (existing) return respond(200, { team: { number: existing.number, name: existing.name } });
      const { status } = await snapshot();
      if (!can(status, 'join')) throw new HttpError(403, 'not-joinable');
      const name = validateTeamName(body.name);
      if (!name.ok) throw new HttpError(400, name.error);
      const playerId = newId();
      const created = await store.createTeam({ playerId, name: name.name, key: name.key, joinedAt: now() });
      if (!created.ok) throw new HttpError(409, created.error);
      return respond(200, { team: { number: created.team.number, name: created.team.name } }, {}, [sessionCookie(playerId, { secure: cookieSecure })]);
    },

    'POST /api/answer': async (request) => {
      const body = readJson(request);
      const team = await requireTeam(request);
      const { saved, status, t } = await snapshot();
      if (!can(status, 'play')) throw new HttpError(403, 'not-playing');
      const zone = findZone(saved.game, body.zone);
      const question = zone?.questions.find((q) => questionId(q) === body.question);
      if (!question) throw new HttpError(404, 'unknown-question');
      const result = checkAnswer(question, body.answer);
      if (!result.valid) throw new HttpError(400, 'invalid-answer'); // does not use up the one submission
      const recorded = await store.recordAnswer(team.playerId, body.zone, body.question, {
        answerGiven: body.answer, correct: result.correct, points: questionPoints(question, result.correct), at: t,
      });
      if (!recorded.ok) throw new HttpError(recorded.error === 'no-team' ? 401 : 409, recorded.error === 'no-team' ? 'no-session' : recorded.error);
      return respond(200, { done: true }); // never says whether it was right
    },

    'POST /api/photo': async (request) => {
      const body = readJson(request);
      const team = await requireTeam(request);
      const { saved, status, t } = await snapshot();
      if (!can(status, 'play')) throw new HttpError(403, 'not-playing');
      if (!findZone(saved.game, body.zone)) throw new HttpError(404, 'unknown-zone');
      const recorded = await store.recordPhotoSent(team.playerId, body.zone, { at: t });
      if (!recorded.ok) throw new HttpError(recorded.error === 'no-team' ? 401 : 409, recorded.error === 'no-team' ? 'no-session' : recorded.error);
      return respond(200, { done: true });
    },
  };

  // ---------------------------------------------------------------- admin routes
  const adminRoutes = {
    'GET /api/admin/config': async () => {
      const { saved, status } = await snapshot();
      return respond(200, {
        config: saved?.config ?? null,
        configuredAt: saved?.configuredAt ?? null,
        status,
        zoneCount: saved ? Object.keys(saved.game).length : 0,
        teamCount: (await store.listTeams()).length,
        timeZones: AU_TIME_ZONES,
        defaults: { name: DEFAULT_GAME_NAME, timeZone: DEFAULT_TIME_ZONE },
      });
    },

    // Saving also loads (takes a copy of) the zones and questions from game-questions.json.
    'PUT /api/admin/config': async (request) => {
      const body = readJson(request);
      const { status } = await snapshot();
      if (!can(status, 'configure')) throw new HttpError(403, 'game-active');
      const config = {
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : DEFAULT_GAME_NAME,
        timeZone: body.timeZone ?? DEFAULT_TIME_ZONE,
        day: body.day, start: body.start, end: body.end,
      };
      const fields = validateConfig(config);
      if (fields.length) throw new HttpError(400, 'invalid-config', { fields });
      const game = loadGameData();
      const problems = validateGameData(game, { checkMaps: false });
      if (problems.length) throw new HttpError(422, 'invalid-game-data', { problems });
      const t = now();
      await store.saveGame({ config, game, configuredAt: t });
      return respond(200, { config, zoneCount: Object.keys(game).length, status: gameStatus(config, t) });
    },

    'GET /api/admin/teams': async () => {
      const teams = (await store.listTeams()).map(summary).sort((a, b) => a.number - b.number);
      return respond(200, { teams });
    },

    'DELETE /api/admin/teams/:number': async (request, params) => {
      const { status } = await snapshot();
      if (!can(status, 'removeTeam')) throw new HttpError(403, 'not-allowed');
      const team = await teamByNumber(Number(params.number));
      if (!team || !(await store.removeTeam(team.playerId))) throw new HttpError(404, 'no-team');
      return respond(200, { removed: true });
    },

    // Photo submissions to score: not yet scored first, in the order sent; scored ones after, in the order scored.
    'GET /api/admin/photos': async () => {
      const { saved } = await snapshot();
      const rows = [];
      for (const team of await store.listTeams()) {
        for (const [zoneKey, photo] of Object.entries(team.photos)) {
          const zone = findZone(saved?.game, zoneKey);
          rows.push({
            teamNumber: team.number, zone: zoneKey, zoneName: zone?.['zone-name'] ?? zoneKey, photoScore: zone?.['photo-score'] ?? 0,
            sentAt: photo.sentAt, decision: photo.decision ?? null, appliedAt: photo.appliedAt ?? null,
          });
        }
      }
      const pending = rows.filter((r) => !r.decision).sort((a, b) => a.sentAt - b.sentAt || a.teamNumber - b.teamNumber);
      const applied = rows.filter((r) => r.decision).sort((a, b) => a.appliedAt - b.appliedAt || a.teamNumber - b.teamNumber);
      return respond(200, { photos: [...pending, ...applied] });
    },

    'POST /api/admin/photos/apply': async (request) => {
      const body = readJson(request);
      const { saved, status, t } = await snapshot();
      if (!can(status, 'score')) throw new HttpError(403, 'not-scoring');
      if (!isDecision(body.decision)) throw new HttpError(400, 'invalid-decision');
      const zone = findZone(saved?.game, body.zone);
      if (!zone) throw new HttpError(404, 'unknown-zone');
      const team = Number.isInteger(body.teamNumber) ? await teamByNumber(body.teamNumber) : null;
      if (!team) throw new HttpError(404, 'no-team');
      const applied = await store.applyPhotoDecision(team.playerId, body.zone, { decision: body.decision, photoScore: zone['photo-score'], at: t });
      if (!applied.ok) throw new HttpError(404, applied.error);
      return respond(200, { delta: applied.delta, score: applied.score });
    },

    'GET /api/admin/export': async () => {
      const t = now();
      const day = new Date(t).toISOString().slice(0, 10);
      return respond(200, { exportedAt: t, ...(await store.exportAll()) }, { 'content-disposition': `attachment; filename="scavenger-hunt-data-${day}.json"` });
    },

    'POST /api/admin/delete-all': async (request) => {
      const body = readJson(request);
      const { status } = await snapshot();
      if (!can(status, 'deleteData')) throw new HttpError(403, 'game-active');
      if (body.confirm !== 'delete') throw new HttpError(400, 'confirmation-required');
      await store.deleteAllPlayerData();
      return respond(200, { deleted: true });
    },
  };

  // ---------------------------------------------------------------- routing
  const table = Object.entries(role === 'public' ? publicRoutes : adminRoutes).map(([key, run]) => {
    const [method, pattern] = key.split(' ');
    const names = [];
    const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; })}/?$`);
    return { method, regex, names, run };
  });

  async function handle(request) {
    try {
      for (const route of table) {
        const match = route.method === request.method && route.regex.exec(request.path);
        if (match) return await route.run(request, Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(match[i + 1])])));
      }
      return respond(404, { error: 'not-found' });
    } catch (e) {
      if (e instanceof HttpError) return respond(e.status, { error: e.code, ...e.extra });
      console.error(JSON.stringify({ message: 'unhandled error', error: String(e), stack: e?.stack }));
      return respond(500, { error: 'server-error' });
    }
  }

  return { handle };
}

module.exports = { createApp, publicZones };
