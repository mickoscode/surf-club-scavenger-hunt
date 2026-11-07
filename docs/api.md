# API reference

The backend behind `/api/*` (code in `api/`, rules in `docs/requirements.md`). Two Lambda functions share the code but serve different routes and get different permissions:

- **public**: everything players and viewers use
- **admin**: the two admin pages (no login, accepted risk: see requirements)

Requests with a body must be JSON sent as `Content-Type: application/json` and under 4 KB. Errors are `{ "error": "<code>" }` with an HTTP status; the codes are stable, the wording is up to the page. Unexpected failures are a plain `500 { "error": "server-error" }`.

**Status codes avoid 403 and 404 on purpose**: CloudFront replaces any 403/404 from any origin with the site's 404 page, which would hide the API's JSON. So the wrong state for a request (not joinable, not playing, game active, not scoring) is `409`, and an unknown zone, question, team or photo is `400`. `401` is a missing session, `415`/`413`/`400` a bad request body, `422` a broken game file.

## Session

`POST /api/join` sets a cookie `hunt=<random id>` (HttpOnly, Secure, SameSite=Strict, Path=/api, 30 days). It is the team's only credential and is never in a response body. Closing the browser does not end the session; clearing cookies does (recovery is parked).

## Public routes

| Route | Purpose | Cache |
|---|---|---|
| `GET /api/health` | `{ ok: true }` | no |
| `GET /api/game` | `{ game: { name, status, startMs, endMs, serverNowMs }, zones }`. `zones` (key, name, mapId, photoChallenge, photoScore, questions: id/text/type/score) are only sent while the game is **active**, and never contain answers. | 3 s, shared |
| `GET /api/scoreboard` | `{ game: {...as above}, teams: [{ number, name, score }] }` sorted by score then name | 3 s, shared |
| `GET /api/me` | `{ team: { number, name, score } \| null, done: { answers: ["zone 1#Q1"], photos: ["zone 1"] } }`: what is done, never what was submitted | no |
| `POST /api/join` `{ name }` | `{ team: { number, name } }` + cookie. Same browser joining again returns its existing team. Errors: `not-joinable` (409, only before/during the game), `empty` `too-long` `invalid-characters` `not-allowed` (400), `name-taken` (409) | no |
| `POST /api/answer` `{ zone, question, answer }` | `{ done: true }`, whether right or wrong. Errors: `no-session` (401), `not-playing` (409, only while active), `unknown-question` (400), `invalid-answer` (400, e.g. letters in a number: does not use up the submission), `already-submitted` (409) | no |
| `POST /api/photo` `{ zone }` | `{ done: true }` ("photo sent to whatsapp"). Errors: `no-session`, `not-playing`, `unknown-zone`, `already-submitted` | no |

`status` is `unconfigured`, `pre`, `active` or `post`. The server clock decides; `serverNowMs` lets the page show the countdown without trusting the phone's clock.

`mapId` is the zone key with spaces as hyphens (`zone 1` becomes `zone-1`); the site build names the map images after it.

## Admin routes

| Route | Purpose |
|---|---|
| `GET /api/admin/config` | `{ config, configuredAt, status, zoneCount, teamCount, timeZones, defaults }` |
| `PUT /api/admin/config` `{ name, timeZone, day, start, end }` | Saves the config **and loads the zones and questions from the game file as deployed** (see below). `game-active` (409) while the game is active; `invalid-config` (400, with `fields`); `invalid-game-data` (422, with `problems`) |
| `GET /api/admin/teams` | `{ teams: [{ number, name, score }] }` |
| `DELETE /api/admin/teams/:number` | Removes a team and its data (any time) |
| `GET /api/admin/photos` | `{ photos: [{ teamNumber, zone, zoneName, photoScore, sentAt, decision, appliedAt }] }`: not yet scored first (in the order sent), then scored (in the order scored) |
| `POST /api/admin/photos/apply` `{ teamNumber, zone, decision }` | `decision` is `full`, `half` or `zero`. Re-applying replaces the previous decision, never adds. `not-scoring` (409) before the game starts. Returns `{ delta, score }` |
| `GET /api/admin/export` | All data as a JSON download (includes each team's secret id and submitted answers: keep it private) |
| `POST /api/admin/delete-all` `{ confirm: "delete" }` | Deletes all teams, submissions and numbering; keeps the game. `game-active` (409) while active |

Admin routes identify a team by its **number** (the hidden form field on the scoring page), never by its secret id.

## The game file

When the admin saves the config, the backend takes a copy of the game file and stores it with the config; the running game uses that copy. Where the file comes from: `GAME_QUESTIONS_FILE`, else `game-questions.json` next to the code (`scripts/package-backend.sh` puts a copy of `docs/game-questions.json` into the Lambda package, so every deploy carries the current questions), else `docs/game-questions.json` (local development).

## Data

DynamoDB, one table, described at the top of `api/store/dynamo.js`. Locally and in most tests the in-memory store is used instead; `tests/api/contract.js` keeps the two identical.
