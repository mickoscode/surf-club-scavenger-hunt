'use strict';
// The API. Two roles share this code but are deployed as separate Lambda functions with separate permissions:
//   public: join, play, scoreboard (everyone)         admin: config, scoring, teams, export/delete (behind the admin passcode)
// Status codes: application errors never use 403 or 404, because CloudFront (terraform/cloudfront.tf) replaces ANY 403/404
// from ANY origin with the site's 404 page. Wrong state (not joinable, game active, ...) is 409, unknown references 400.
// Everything is decided here on the server: timing, answer checking, scoring. The browser never receives an
// official answer, and never receives what a team submitted. Rules: docs/requirements.md.
const crypto = require('node:crypto');
const { HttpError, respond, parseCookies, sessionCookie, adminCookie, readJson, COOKIE_NAME, ADMIN_COOKIE_NAME } = require('./http');
const { gameStatus, describeGame, can, validateConfig, TIME_ZONES, DEFAULT_GAME_NAME, DEFAULT_TIME_ZONE } = require('../lib/gamestate');
const { checkAnswer } = require('../lib/answers');
const { questionPoints, isDecision } = require('../lib/scoring');
const { validateTeamName, sortScoreboard, teamNamesOn, teamLabel } = require('../lib/teams');
const { countQuestions, countDone } = require('../lib/progress');
const { normaliseJoinCode, matchesJoinCode } = require('../lib/joincode');
const { isEventName, LIMITS: EVENT_LIMITS } = require('../lib/events');
const { placeOf } = require('../lib/results');
const { buildResults } = require('../lib/results');
const { normaliseWhatsappUrl } = require('../lib/whatsapp');
const { verifyPasscode, createSession, verifySession, SESSION_MS } = require('../lib/passcode');
const { mapId } = require('../lib/gamedata');

const PLAYER_ID = /^[0-9a-f]{32}$/;
const QUESTION_ID = /^Q\d+$/;
// Failed admin logins allowed in any 5 minutes (counted across everybody): after that, logins are refused until the window passes.
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILED_LOGINS = 10;
const CACHEABLE = { 'cache-control': 'public, max-age=3' }; // the same for everyone, so CloudFront may share it briefly

const questionId = (q) => Object.keys(q).find((k) => QUESTION_ID.test(k));
// A photo challenge is a question of type "photo" (a zone may have none, one or several); it has no answer to check.
const isPhoto = (q) => q.type === 'photo';
const findQuestion = (zone, id) => zone?.questions.find((q) => questionId(q) === id);
const findPhoto = (zone, id) => { const q = findQuestion(zone, id); return q && isPhoto(q) ? q : undefined; };
// Own properties only: a request naming a zone "__proto__" or "constructor" must be "not found", not an error.
const findZone = (game, key) => (typeof key === 'string' && game && Object.hasOwn(game, key) ? game[key] : undefined);

// The zones as players may see them: no answers, ever.
const publicZones = (game, maps = {}) => Object.entries(game).map(([key, zone]) => ({
  key,
  name: zone['zone-name'],
  mapId: mapId(key),
  ...(maps[key] ? { map: maps[key] } : {}), // an event's maps: { thumb, full } addresses on the site
  questions: zone.questions.map((q) => ({ id: questionId(q), text: q[questionId(q)], type: q.type, score: q.score })),
}));

function createApp({
  store,
  now = Date.now,
  newId = () => crypto.randomBytes(16).toString('hex'),
  role,
  cookieSecure = true,
  events = null, // the events store (api/lib/events.js), or null where events are not available (the public function)
  adminPasscodeHash = '', // the hash of the admin passcode; empty = no passcode set yet, the admin stays open (rollout only)
}) {
  if (role !== 'public' && role !== 'admin') throw new Error('role must be "public" or "admin"');
  const passcodeRequired = typeof adminPasscodeHash === 'string' && adminPasscodeHash !== '';

  async function snapshot() {
    const saved = await store.getGame();
    const config = saved?.config ?? null;
    const t = now();
    return { saved, config, t, status: gameStatus(config, t), info: describeGame(config, t) };
  }
  // What the pages need to know about the game, including whether the final results are published (so the scoreboard
  // heading and the Results button can follow). The same for everyone, so CloudFront may share it briefly.
  async function gameSummary(saved, info) {
    return { name: saved?.config?.name ?? DEFAULT_GAME_NAME, ...info, teamNames: teamNamesOn(saved?.config), joinCodeRequired: Boolean(saved?.config?.joinCode), published: (await store.getPublishedAt()) !== null };
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
  // A team as the pages show it: with team names off its name is "Team <number>" (config: the saved game configuration).
  const summary = (team, config) => ({ number: team.number, name: teamLabel(team, config), score: team.score });

  // The configuration values from a request body, checked and tidied (throws 400 invalid-config).
  function buildConfig(body) {
    // The WhatsApp link is optional: left out of the saved configuration when empty, and stored in its plain form.
    const link = body.whatsappUrl === undefined || body.whatsappUrl === null ? '' : String(body.whatsappUrl).trim();
    const config = {
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : DEFAULT_GAME_NAME,
      timeZone: body.timeZone ?? DEFAULT_TIME_ZONE,
      day: body.day, start: body.start, end: body.end,
      ...(link ? { whatsappUrl: link } : {}),
      teamNames: body.teamNames === undefined ? true : body.teamNames, // on unless the admin turns it off
      ...(body.joinCode === undefined || body.joinCode === null || String(body.joinCode).trim() === '' ? {} : { joinCode: body.joinCode }), // optional; empty means no code (anything else is validated)
    };
    const fields = validateConfig(config);
    if (fields.length) throw new HttpError(400, 'invalid-config', { fields });
    if (config.whatsappUrl) config.whatsappUrl = normaliseWhatsappUrl(config.whatsappUrl).url;
    if (config.joinCode) config.joinCode = normaliseJoinCode(config.joinCode).code; // stored tidy, in capitals, as the admin reads it out
    return config;
  }

  const requireEvents = () => { if (!events) throw new HttpError(409, 'events-unavailable'); };
  const validName = (name) => { if (!isEventName(name)) throw new HttpError(400, 'invalid-event-name'); };
  // An event's summary, or 400 unknown-event (never 404: CloudFront would replace it).
  async function eventSummary(name) {
    requireEvents(); validName(name);
    if (!(await events.exists(name))) throw new HttpError(400, 'unknown-event');
    return events.summary(name);
  }
  const eventResult = (result) => {
    if (!result.ok) throw new HttpError(result.error === 'file-too-large' ? 413 : result.error === 'invalid-game-data' ? 422 : 400, result.error, { problems: result.problems, part: result.part });
    return respond(200, { saved: true });
  };

  // ---------------------------------------------------------------- public routes
  const publicRoutes = {
    'GET /api/health': async () => respond(200, { ok: true }),

    'GET /api/game': async () => {
      const { saved, info, status } = await snapshot();
      // Questions are only sent while the game is active, so nobody can read them before the start.
      const zones = status === 'active' ? publicZones(saved.game, saved.event?.maps) : [];
      // The instructions are public information (shown before the game starts too); null for a game not loaded from an event.
      return respond(200, { game: await gameSummary(saved, info), zones, instructions: saved?.event ? saved.event.instructions : null }, CACHEABLE);
    },

    'GET /api/scoreboard': async () => {
      const { saved, info } = await snapshot();
      const all = await store.listTeams();
      const config = saved?.config;
      // rank: teams on the same score share a place (1, 1, 3); done: questions and photo challenges attempted, of questionTotal.
      const teams = sortScoreboard(all.map((x) => summary(x, config)), { namesOn: teamNamesOn(config) }).map((t) => {
        const team = all.find((x) => x.number === t.number);
        return { ...t, rank: placeOf(team, all), done: countDone(team, saved?.game) };
      });
      return respond(200, { game: await gameSummary(saved, info), questionTotal: countQuestions(saved?.game), teams }, CACHEABLE);
    },

    // The caller's own team and which forms they have already submitted (never what they submitted).
    'GET /api/me': async (request) => {
      const team = await sessionTeam(request);
      if (!team) return respond(200, { team: null });
      const saved = await store.getGame();
      return respond(200, {
        team: summary(team, saved?.config),
        done: { answers: Object.keys(team.subs), photos: Object.keys(team.photos) },
        // The WhatsApp group's invite link works like a key to the group, so only a team with a session is given it: it is
        // never in the public game or scoreboard responses.
        whatsappUrl: saved?.config?.whatsappUrl ?? null,
      });
    },

    // A team's own final results. Nothing about answers is sent unless the final results are published AND the caller has a
    // team session: otherwise only whether they are published (and who the caller is), so a page can say "not ready yet".
    'GET /api/results': async (request) => {
      const published = (await store.getPublishedAt()) !== null;
      const team = await sessionTeam(request);
      if (!team) return respond(200, { published, team: null });
      const { saved } = await snapshot();
      const who = { number: team.number, name: teamLabel(team, saved?.config) };
      if (!published) return respond(200, { published: false, team: who });
      const results = buildResults({ team, teams: await store.listTeams(), game: saved.game });
      return respond(200, { published: true, team: who, results });
    },

    'POST /api/join': async (request) => {
      const body = readJson(request);
      const existing = await sessionTeam(request);
      const { status, config } = await snapshot();
      if (existing) return respond(200, { team: { number: existing.number, name: teamLabel(existing, config) } });
      if (!can(status, 'join')) throw new HttpError(409, 'not-joinable');
      // The join code, when one is set: checked first, so nothing else about joining is revealed to someone without it.
      if (config.joinCode && !matchesJoinCode(body.code, config.joinCode)) throw new HttpError(400, 'wrong-code');
      const playerId = newId();
      // With team names off nothing is asked, stored or checked: the team is "Team <number>", and its (unique) key cannot clash with any name.
      let name = { name: '', key: `#${playerId}` };
      if (teamNamesOn(config)) {
        name = validateTeamName(body.name);
        if (!name.ok) throw new HttpError(400, name.error);
      }
      const created = await store.createTeam({ playerId, name: name.name, key: name.key, joinedAt: now() });
      if (!created.ok) throw new HttpError(409, created.error);
      return respond(200, { team: { number: created.team.number, name: teamLabel(created.team, config) } }, {}, [sessionCookie(playerId, { secure: cookieSecure })]);
    },

    'POST /api/answer': async (request) => {
      const body = readJson(request);
      const team = await requireTeam(request);
      const { saved, status, t } = await snapshot();
      if (!can(status, 'play')) throw new HttpError(409, 'not-playing');
      const zone = findZone(saved.game, body.zone);
      const question = findQuestion(zone, body.question);
      if (!question || isPhoto(question)) throw new HttpError(400, 'unknown-question');
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
      if (!can(status, 'play')) throw new HttpError(409, 'not-playing');
      const zone = findZone(saved.game, body.zone);
      if (!zone) throw new HttpError(400, 'unknown-zone');
      if (!findPhoto(zone, body.question)) throw new HttpError(400, 'unknown-question'); // not there, or not a photo challenge
      const recorded = await store.recordPhotoSent(team.playerId, `${body.zone}#${body.question}`, { at: t });
      if (!recorded.ok) throw new HttpError(recorded.error === 'no-team' ? 401 : 409, recorded.error === 'no-team' ? 'no-session' : recorded.error);
      return respond(200, { done: true });
    },
  };

  // ---------------------------------------------------------------- admin routes
  // Login, logout and the session check are the only admin routes that work without a session.
  const OPEN_ADMIN_ROUTES = new Set(['POST /api/admin/login', 'POST /api/admin/logout', 'GET /api/admin/session']);
  const hasAdminSession = (request) => verifySession(parseCookies(request.headers.cookie)[ADMIN_COOKIE_NAME], adminPasscodeHash, now());

  const adminRoutes = {
    // Always answers 200, so a page can ask whether to show the login box without an error in the console.
    'GET /api/admin/session': async (request) => respond(200, { required: passcodeRequired, authenticated: !passcodeRequired || hasAdminSession(request) }),

    'POST /api/admin/login': async (request) => {
      const body = readJson(request);
      if (!passcodeRequired) return respond(200, { required: false, authenticated: true }); // nothing to log in to
      const t = now();
      if ((await store.getLoginFailures(t, LOGIN_WINDOW_MS)) >= MAX_FAILED_LOGINS) {
        const retryAfterSeconds = Math.ceil(((Math.floor(t / LOGIN_WINDOW_MS) + 1) * LOGIN_WINDOW_MS - t) / 1000);
        throw new HttpError(409, 'too-many-attempts', { retryAfterSeconds });
      }
      const ok = typeof body.passcode === 'string' && body.passcode.length <= 200 && (await verifyPasscode(body.passcode, adminPasscodeHash));
      if (!ok) {
        await store.registerLoginFailure(t, LOGIN_WINDOW_MS);
        throw new HttpError(401, 'wrong-passcode');
      }
      await store.clearLoginFailures(t, LOGIN_WINDOW_MS);
      const cookie = adminCookie(createSession(adminPasscodeHash, t), { secure: cookieSecure, maxAgeSeconds: SESSION_MS / 1000 });
      return respond(200, { required: true, authenticated: true }, {}, [cookie]);
    },

    'POST /api/admin/logout': async () => respond(200, { authenticated: false }, {}, [adminCookie('', { secure: cookieSecure, maxAgeSeconds: 0 })]),

    'GET /api/admin/config': async () => {
      const { saved, status } = await snapshot();
      const teams = await store.listTeams();
      const publishedAt = await store.getPublishedAt();
      return respond(200, {
        config: saved?.config ?? null,
        configuredAt: saved?.configuredAt ?? null,
        event: saved?.event?.name ?? null, // the event the live game was loaded from (null for a game loaded from the repository's file)
        eventsAvailable: Boolean(events),
        status,
        zoneCount: saved ? Object.keys(saved.game).length : 0,
        teamCount: teams.length,
        // Photos teams say they sent that have not been scored yet (they would count as 0% if the results were published).
        unscoredPhotos: teams.reduce((n, team) => n + Object.values(team.photos).filter((photo) => !photo.decision).length, 0),
        results: { published: publishedAt !== null, publishedAt },
        timeZones: TIME_ZONES,
        defaults: { name: DEFAULT_GAME_NAME, timeZone: DEFAULT_TIME_ZONE },
      });
    },

    // Saving loads the game: a copy of the chosen stored event (its questions, instructions and maps) is made, so the live game
    // never reads the events bucket again. The saved values are also written back to the event.
    'PUT /api/admin/config': async (request) => {
      const body = readJson(request);
      const { status } = await snapshot();
      if (!can(status, 'configure')) throw new HttpError(409, 'game-active');
      const config = buildConfig(body);
      if (!events) throw new HttpError(409, 'events-unavailable');
      if (typeof body.event !== 'string' || body.event === '') throw new HttpError(400, 'event-required');
      if (!isEventName(body.event) || !(await events.exists(body.event))) throw new HttpError(400, 'unknown-event');
      // Another event means another set of questions, so it cannot replace a game that has players (download and delete the data first).
      const current = (await store.getGame())?.event?.name ?? null;
      if (current !== body.event && (await store.listTeams()).length > 0) throw new HttpError(409, 'players-exist');
      const loaded = await events.activate(body.event);
      if (!loaded.ok) throw new HttpError(422, loaded.error === 'maps-missing' ? 'event-incomplete' : 'invalid-event', { problems: loaded.problems, missing: loaded.missing });
      const game = loaded.game;
      const event = { name: body.event, instructions: loaded.instructions, maps: loaded.maps };
      await events.putConfig(body.event, config); // the stored event always matches what was last used
      const t = now();
      await store.saveGame({ config, game, event, configuredAt: t });
      await store.unpublishResults(); // a new configuration starts a new game: the results are provisional again
      return respond(200, { config, event: event.name, zoneCount: Object.keys(game).length, status: gameStatus(config, t) });
    },

    // ---- events: games prepared in the private events bucket (docs/requirements.md, "Events")
    'GET /api/admin/events': async () => {
      const { saved } = await snapshot();
      if (!events) return respond(200, { available: false, active: null, events: [] });
      const list = [];
      for (const name of await events.names()) list.push(await events.summary(name));
      return respond(200, { available: true, active: saved?.event?.name ?? null, events: list });
    },

    'GET /api/admin/events/:name': async (request, params) => respond(200, await eventSummary(params.name)),

    'GET /api/admin/events/:name/download': async (request, params) => {
      await eventSummary(params.name);
      return respond(200, await events.download(params.name), { 'content-disposition': `attachment; filename="event-${params.name}.json"` });
    },

    // The game file itself is the request body (the zones and questions as the admin wrote them).
    'PUT /api/admin/events/:name/questions': async (request, params) => {
      requireEvents(); validName(params.name);
      const body = readJson(request, EVENT_LIMITS.questionsBytes);
      return eventResult(await events.putQuestions(params.name, body, Buffer.byteLength(request.body ?? '')));
    },

    'PUT /api/admin/events/:name/instructions': async (request, params) => {
      requireEvents(); validName(params.name);
      await eventSummary(params.name);
      return eventResult(await events.putInstructions(params.name, readJson(request, EVENT_LIMITS.instructionsBytes + 1024).text));
    },

    // One zone's map as the browser shrank it: { thumb, full } as base64. :map is the zone's map id ("zone-1").
    'PUT /api/admin/events/:name/maps/:map': async (request, params) => {
      requireEvents(); validName(params.name);
      await eventSummary(params.name);
      const body = readJson(request, 2 * Math.ceil((EVENT_LIMITS.imageBytes * 4) / 3) + 1024);
      return eventResult(await events.putMap(params.name, params.map, body));
    },

    'PUT /api/admin/events/:name/config': async (request, params) => {
      requireEvents(); validName(params.name);
      const config = buildConfig(readJson(request));
      await events.putConfig(params.name, config);
      return respond(200, { config });
    },

    'DELETE /api/admin/events/:name': async (request, params) => {
      requireEvents(); validName(params.name);
      await eventSummary(params.name);
      if ((await store.getGame())?.event?.name === params.name) throw new HttpError(409, 'event-active'); // the live game is loaded from it
      await events.remove(params.name);
      return respond(200, { removed: true });
    },

    'GET /api/admin/teams': async () => {
      const { config } = await snapshot();
      const teams = (await store.listTeams()).map((x) => summary(x, config)).sort((a, b) => a.number - b.number);
      return respond(200, { teams });
    },

    'DELETE /api/admin/teams/:number': async (request, params) => {
      const { status } = await snapshot();
      if (!can(status, 'removeTeam')) throw new HttpError(409, 'not-allowed');
      const team = await teamByNumber(Number(params.number));
      if (!team || !(await store.removeTeam(team.playerId))) throw new HttpError(400, 'no-team');
      return respond(200, { removed: true });
    },

    // Photo submissions to score: not yet scored first, in the order sent; scored ones after, in the order scored.
    'GET /api/admin/photos': async () => {
      const { saved } = await snapshot();
      const rows = [];
      for (const team of await store.listTeams()) {
        for (const [key, photo] of Object.entries(team.photos)) { // key: "<zone>#<question id>"
          const [zoneKey, id] = key.split('#');
          const zone = findZone(saved?.game, zoneKey);
          const challenge = findPhoto(zone, id);
          rows.push({
            teamNumber: team.number, zone: zoneKey, zoneName: zone?.['zone-name'] ?? zoneKey, question: id,
            challenge: challenge ? challenge[id] : id, photoScore: challenge?.score ?? 0,
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
      if (!can(status, 'score')) throw new HttpError(409, 'not-scoring');
      if ((await store.getPublishedAt()) !== null) throw new HttpError(409, 'results-published'); // return to provisional to correct a score
      if (!isDecision(body.decision)) throw new HttpError(400, 'invalid-decision');
      const zone = findZone(saved?.game, body.zone);
      if (!zone) throw new HttpError(400, 'unknown-zone');
      const challenge = findPhoto(zone, body.question);
      if (!challenge) throw new HttpError(400, 'unknown-question');
      const team = Number.isInteger(body.teamNumber) ? await teamByNumber(body.teamNumber) : null;
      if (!team) throw new HttpError(400, 'no-team');
      const applied = await store.applyPhotoDecision(team.playerId, `${body.zone}#${body.question}`, { decision: body.decision, photoScore: challenge.score, at: t });
      if (!applied.ok) throw new HttpError(400, applied.error);
      return respond(200, { delta: applied.delta, score: applied.score });
    },

    // Confirms every score has been applied and publishes the final results: only once the game is over. Photos still
    // unscored count as 0%. Publishing again changes nothing.
    'POST /api/admin/results/publish': async (request) => {
      const body = readJson(request);
      const { status, t } = await snapshot();
      if (!can(status, 'publish')) throw new HttpError(409, 'game-not-over');
      if (body.confirm !== true) throw new HttpError(400, 'confirmation-required');
      const publishedAt = await store.publishResults(t);
      return respond(200, { published: true, publishedAt });
    },

    // Back to provisional (a mistake, or a late correction): scoring opens again and the results page closes.
    'POST /api/admin/results/unpublish': async () => {
      await store.unpublishResults();
      return respond(200, { published: false });
    },

    'GET /api/admin/export': async () => {
      const t = now();
      const day = new Date(t).toISOString().slice(0, 10);
      return respond(200, { exportedAt: t, ...(await store.exportAll()) }, { 'content-disposition': `attachment; filename="scavenger-hunt-data-${day}.json"` });
    },

    'POST /api/admin/delete-all': async (request) => {
      const body = readJson(request);
      const { status } = await snapshot();
      if (!can(status, 'deleteData')) throw new HttpError(409, 'game-active');
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
    return { method, regex, names, run, open: OPEN_ADMIN_ROUTES.has(key) };
  });

  async function handle(request) {
    try {
      for (const route of table) {
        const match = route.method === request.method && route.regex.exec(request.path);
        if (match) {
          // Once a passcode is set, every admin call needs a valid session: nothing else is checked first.
          if (role === 'admin' && passcodeRequired && !route.open && !hasAdminSession(request)) throw new HttpError(401, 'not-authenticated');
          return await route.run(request, Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(match[i + 1])])));
        }
      }
      return respond(404, { error: 'not-found' });
    } catch (e) {
      if (e instanceof HttpError) return respond(e.status, { error: e.code, ...e.extra });
      console.error(JSON.stringify({ message: 'unhandled error', error: String(e), stack: e?.stack }));
      return respond(500, { error: 'server-error' });
    }
  }

  return { handle, routes: Object.keys(role === 'public' ? publicRoutes : adminRoutes) };
}

module.exports = { createApp, publicZones };
