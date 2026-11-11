# API reference

The backend behind `/api/*` (code in `api/`, rules in `docs/requirements.md`). Two Lambda functions share the code but serve different routes and get different permissions:

- **public**: everything players and viewers use
- **admin**: the two admin pages (behind the admin passcode, see "Admin routes")

Requests with a body must be JSON sent as `Content-Type: application/json` and under 4 KB. Errors are `{ "error": "<code>" }` with an HTTP status; the codes are stable, the wording is up to the page. Unexpected failures are a plain `500 { "error": "server-error" }`.

**Status codes avoid 403 and 404 on purpose**: CloudFront replaces any 403/404 from any origin with the site's 404 page, which would hide the API's JSON. So the wrong state for a request (not joinable, not playing, game active, not scoring) is `409`, and an unknown zone, question, team or photo is `400`. `401` is a missing session, `415`/`413`/`400` a bad request body, `422` a broken game file.

## Session

`POST /api/join` sets a cookie `hunt=<random id>` (HttpOnly, Secure, SameSite=Strict, Path=/api, 30 days). It is the team's only credential and is never in a response body. Closing the browser does not end the session; clearing cookies does (recovery is parked).

## Public routes

| Route | Purpose | Cache |
|---|---|---|
| `GET /api/health` | `{ ok: true }` | no |
| `GET /api/game` | `{ game: { name, status, startMs, endMs, serverNowMs }, zones, instructions }`. `instructions` is the Markdown text of the event's player instructions (empty when it has none), or `null` when the game was not loaded from an event; each zone also has `map: { thumb, full }` (addresses on the site) when it came from an event. `zones` (key, name, mapId, questions: id/text/type/score; `type` is `photo` for a photo challenge, and a zone may have none, one or several) are only sent while the game is **active**, and never contain answers. | 3 s, shared |
| `GET /api/scoreboard` | `{ game: {...as above}, questionTotal, teams: [{ number, name, score, rank, done }] }` sorted by score then name. `rank` is the place (equal scores share one: 1, 1, 3); `done` is how many questions and photo challenges the team has attempted, of `questionTotal` (every question and photo challenge in the game); neither says anything about correctness | 3 s, shared |
| `GET /api/results` | A team's own final results. **Nothing about answers is sent unless the results are published AND the caller has a team session.** Always 200: `{ published, team: null }` (no session), `{ published: false, team: { number, name } }` (not published), or `{ published: true, team, results }` with `results = { place, teamCount, total, zones: [{ key, name, questions: [{ id, text, type, points, answered, yourAnswer, correct, earned, officialAnswers }], photo: { challenge, points, submitted, scored, decision, percent, earned } }] }`. Places are shared by equal scores (1st, 1st, 3rd). Every question is listed, answered or not (`yourAnswer`/`correct` are null if not); `officialAnswers` is always a list; a photo is `submitted: false` (percent null), submitted but `scored: false` (0%), or scored 100/50/0 | no |
| `GET /api/me` | `{ team: { number, name, score } \| null, whatsappUrl, done: { answers: ["zone 1#Q1"], photos: ["zone 1#Q4"] } }`: what is done, never what was submitted. `whatsappUrl` is the WhatsApp group's invite link, or null when none is set: **only a team with a session is given it** (a browser with no team gets `{ team: null }`), and it is in no public response | no |
| `POST /api/join` `{ name, code? }` | `{ team: { number, name } }` + cookie. When the game has team names switched off (`game.teamNames` is false) no name is needed or used, and `name` is `Team <number>`. Same browser joining again returns its existing team. Errors: `not-joinable` (409, only before/during the game), `wrong-code` (400: the admin set a join code and `code` is missing or wrong; checked before the name, nothing is created; a browser that already has a team is not asked), `empty` `too-long` `invalid-characters` `not-allowed` (400), `name-taken` (409) | no |
| `POST /api/answer` `{ zone, question, answer }` | `{ done: true }`, whether right or wrong. Errors: `no-session` (401), `not-playing` (409, only while active), `unknown-question` (400), `invalid-answer` (400, e.g. letters in a number: does not use up the submission), `already-submitted` (409) | no |
| `POST /api/photo` `{ zone, question }` | `question` is the id of a photo challenge (a question of type `photo`). `{ done: true }` ("photo sent to whatsapp"). Errors: `no-session`, `not-playing`, `unknown-zone`, `unknown-question` (400, also for a question that is not a photo challenge), `already-submitted`. `POST /api/answer` likewise refuses a photo challenge with `unknown-question` | no |

`game.joinCodeRequired` is true when the admin set a code to join (the code itself is never in a public response). `game.teamNames` is false when the admin has switched team names off: every team is then shown as `Team <number>` (in every `name` the API sends), and the join form asks for no name. `game.published` is true while the admin has published the final results (the scoreboard heading and the Results button follow it). `status` is `unconfigured`, `pre`, `active` or `post`. The server clock decides; `serverNowMs` lets the page show the countdown without trusting the phone's clock.

`mapId` is the zone key with spaces as hyphens (`zone 1` becomes `zone-1`); the site build names the map images after it.

## Admin routes

**Authentication.** Once an admin passcode is set (the `ADMIN_PASSCODE_HASH` setting of the admin function, from the HCP variable `admin_passcode_hash`), every admin route except the three below answers a caller with no valid session with `401 { "error": "not-authenticated" }` (never 403/404, see above). With no passcode set the admin stays open (rollout only; the smoke test warns). A setting that is not a valid hash locks everything instead: a mistake can never open the admin.

- A session is a 12-hour signed token in the cookie `hunt_admin` (HttpOnly, Secure, SameSite=Strict, `Path=/api/admin`, so only the admin API receives it). It is signed with a key made from the stored hash, so changing the passcode ends every session.
- `POST /api/admin/login` `{ passcode }`: the passcode is compared with the hash (scrypt, constant time; case, spaces and dashes are ignored). `401 wrong-passcode` for a wrong one. **At most 10 failures in any 5-minute window, counted across everybody**: after that `409 too-many-attempts` (with `retryAfterSeconds`) even for the right passcode, until the window passes. A success clears the count.

| Route | Purpose |
|---|---|
| `GET /api/admin/session` | Always 200 `{ required, authenticated }`: whether a passcode is set and whether this browser has a valid session (so a page can show the login box without an error in the console) |
| `POST /api/admin/login` `{ passcode }` | Starts a session (sets the cookie). Returns `{ required: true, authenticated: true }`; `{ required: false, authenticated: true }` when no passcode is set |
| `POST /api/admin/logout` | Ends the session (clears the cookie) |
| `GET /api/admin/config` | `{ config, configuredAt, event, eventsAvailable, status, zoneCount, teamCount, unscoredPhotos, results: { published, publishedAt }, timeZones, defaults }`: `unscoredPhotos` is how many sent photos have no decision yet; `event` is the name of the event the live game was loaded from (or null) |
| `PUT /api/admin/config` `{ name, timeZone, day, start, end, whatsappUrl?, teamNames?, joinCode?, event? }` | Saves the config **and loads the game**: from the stored event named in `event` (its questions, instructions and maps; the saved values are also written back to the event), or, with no `event`, from the game file as deployed (see below). With `event`: `unknown-event` (400), `invalid-event` (422, with `problems`), `event-incomplete` (422, with `missing` maps), `players-exist` (409: another event cannot replace a game that has teams: download and delete the player data first; saving the same event again is fine), `events-unavailable` (409). `game-active` (409) while the game is active; `invalid-config` (400, with `fields`; `joinCode` is named there when it is not 5 to 12 letters and digits (case, spaces and dashes are ignored; it is saved tidy, in capitals; empty means no code); `teamNames` is named there when it is not true or false (left out means true); `whatsappUrl` is named there when the link is not a `https://chat.whatsapp.com/...` invite, and the saved link has any tracking query removed; an empty link means none); `invalid-game-data` (422, with `problems`) |
| `GET /api/admin/events` | `{ available, active, events: [{ name, config, gameName, day, zoneCount, questionCount, hasInstructions, problems, missingMaps, complete }] }`. `available` is false where the events bucket is not configured. `complete` means the questions are valid and every zone has both map files |
| `GET /api/admin/events/:name` | The same summary for one event. `unknown-event` (400) |
| `PUT /api/admin/events/:name/questions` `<the game file>` | The body IS the game file (zones and questions, see "The game file"), up to 256 KB. Creates the event if it is new. `invalid-game-data` (422, with `problems`), `too-many-zones`, `too-many-events` (400), `file-too-large` (413). Maps of zones no longer in the file are removed |
| `PUT /api/admin/events/:name/instructions` `{ text }` | The instructions (Markdown, up to 20 KB); empty removes them |
| `PUT /api/admin/events/:name/maps/:map` `{ thumb, full }` | One zone's map as base64 images (webp, jpeg or png by content, each up to 500 KB). `:map` is the zone's map id (`zone-1`). `invalid-image` (400, with `part`), `unknown-zone` (400), `file-too-large` (413) |
| `PUT /api/admin/events/:name/config` `{ name, timeZone, day, start, end, ... }` | The configuration values stored with the event (same fields and checks as the live configuration) |
| `GET /api/admin/events/:name/download` | The event's config, questions and instructions as one JSON download (not the maps) |
| `DELETE /api/admin/events/:name` | Deletes the event. `event-active` (409) for the one the live game was loaded from |
| `GET /api/admin/teams` | `{ teams: [{ number, name, score }] }` |
| `GET /api/admin/teams/:number/results` | `{ team, published, results }`: the team's breakdown exactly as `/api/results` gives it to the team once the results are published (place, total, every question with the team's answer, whether it was right, points and the official answers, and each photo challenge), but at any time, so the admin can check on a team during the game. `no-team` (400) for an unknown team, `no-game` (409) before a game is set up |
| `DELETE /api/admin/teams/:number` | Removes a team and its data (any time) |
| `GET /api/admin/photos` | `{ photos: [{ teamNumber, zone, zoneName, question, challenge, photoScore, sentAt, decision, appliedAt }] }`: not yet scored first (in the order sent), then scored (in the order scored) |
| `POST /api/admin/photos/apply` `{ teamNumber, zone, question, decision }` | `question` is the id of the photo challenge. `decision` is `full`, `half` or `zero`. Re-applying replaces the previous decision, never adds. `not-scoring` (409) before the game starts, and `results-published` (409) while the final results are published (return to provisional to correct a score). Returns `{ delta, score }` |
| `POST /api/admin/results/publish` `{ confirm: true }` | Publishes the final results. Only once the game is over (`game-not-over`, 409, before that, including at the exact end time); `confirmation-required` (400) unless `confirm` is exactly `true`. Photos never scored count as 0%. Publishing again changes nothing. Returns `{ published: true, publishedAt }` |
| `POST /api/admin/results/unpublish` | Back to provisional, at any time. Returns `{ published: false }` |
| `GET /api/admin/export` | All data as a JSON download (includes each team's secret id and submitted answers: keep it private) |
| `POST /api/admin/delete-all` `{ confirm: "delete", override? }` | Deletes all teams, submissions and numbering; keeps the game. `game-active` (409) while active, unless `override` is the word `override` (see below) |

**Overriding the lock (for testing).** While the game is in progress, `PUT /api/admin/config` and `POST /api/admin/delete-all` answer `game-active` (409). Sending `override` set to the word `override` (any capitals) with the request lifts that one block; nothing else is skipped (an invalid configuration or a missing `confirm` is still refused), and every use is written to the function's log. The config page asks the admin to type the word.

Admin routes identify a team by its **number** (the hidden form field on the scoring page), never by its secret id.

## Events

A stored event is a folder in a private bucket (`<event>/game-config.json`, `game-questions.json`, `player-instructions.md`, `game-zones/*`) that only the admin function can reach (see `docs/requirements.md`, "Events"). Event names are 1 to 40 lower case letters, digits and hyphens. The live game never reads the bucket: saving the configuration with an `event` copies it into the game's table and its maps into the site under `/event-maps/<activation>/` (a new folder each time, cached for good; the previous one is removed). Uploads go through the routes above, so request bodies for those routes may be larger than the usual 4 KB (the questions up to 256 KB, a map about 1.4 MB).

## The game file

A game is an event's `game-questions.json` (format: `docs/requirements.md`, "game-questions.json format"). When the admin saves the config the backend takes a copy of the chosen event's game and stores it with the config; the running game uses that copy, so it never reads the events bucket. The file `docs/game-questions.json` in the repository is only an example of the format.

## Data

DynamoDB, one table, described at the top of `api/store/dynamo.js`. Locally and in most tests the in-memory store is used instead; `tests/api/contract.js` keeps the two identical.
