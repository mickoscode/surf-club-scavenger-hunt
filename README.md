# surf-club-scavenger-hunt

Website for the Sorrento SLS Youth Scavenger Hunt 2026/27. A static site (HTML, [Bootstrap](https://getbootstrap.com/) 5 and a little JavaScript) hosted in a private S3 bucket behind CloudFront, with the infrastructure managed by Terraform and deployed by GitHub Actions. Currently a "coming soon" page.

## Layout

| Path | What it is |
|---|---|
| `web/` | The site itself: `index.html` (sends people to `/view/`), `view/` (scoreboard, join, Play link), `play/` (team, countdown, instructions, zone tiles and question/photo forms), `404.html`, `css/site.css`, `js/` (ES modules, no framework), `favicon.svg` |
| `api/app/`, `api/handlers/` | The API: routes and rules (`app/`) and the two Lambda entry points (`handlers/`). Reference: `docs/api.md`. |
| `api/store/` | The data layer: one `store` interface with an in-memory version (local development and tests) and a DynamoDB version (the data model is described at the top of `dynamo.js`) |
| `api/lib/` | Backend game logic as pure functions (timing, answer checking, scoring, team names, scoreboard order). No dependencies, no AWS: the Lambda handlers that use it come in a later PR. |
| `scripts/build.sh` | Assembles `dist/` = `web/` + the Bootstrap CSS from `node_modules` (the exact contents of the bucket) |
| `tests/unit/` | Unit tests (`npm test`): the built pages against the Content-Security-Policy, the page code that must agree with the server (`web/js`), the rewrite function, and the game-data validator |
| `tests/api/` | The store contract tests (the same tests run against the in-memory store always, and against DynamoDB Local in CI) and the API behaviour tests (`app-*.test.js`: in-memory store, controllable clock) |
| `scripts/build-maps.js` | Build step: turns each zone's map PNG (about 1 MB each) into a small thumbnail and a full-size WebP in `dist/maps` (about 100 KB each), named with the zone's `mapId` |
| `scripts/render-instructions.js` | Build step: renders `docs/player-instructions.md` into the play page (raw HTML in it is shown as text) |
| `scripts/package-backend.sh`, `scripts/smoke-test.js`, `scripts/dev-server.js` | Package the backend for Lambda; smoke-test a deployed site (`npm run smoke -- <url>`); serve the site and API locally with the in-memory store (`npm run dev`) |
| `tests/browser/` | The pages in real Chromium (Playwright) served with the real Content-Security-Policy (`npm run test:browser`) |
| `scripts/validate-game-data.js` | Checks the structure of `docs/game-questions.json` (`npm run validate:data`) |
| `docs/` | Game design (`requirements.md`), game content (`game-questions.json`, `game-zones/`, `player-instructions.md`) and one-time setup (`setup.md`) |
| `terraform/` | S3 bucket, CloudFront (HTTPS, security headers, page rewrites, `/api/*` to the API, optional custom domain), DynamoDB table, two Lambda functions behind an API Gateway HTTP API, and the GitHub deploy role |
| `.github/workflows/` | CI/CD, see below |
| `docs/setup.md` | One-time GitHub / HCP Terraform / AWS setup, and what to do after the first apply |

## Develop

```sh
npm ci            # installs Bootstrap and the test tools
npm run build     # builds dist/
npm test          # unit tests, including a build check of dist/
npm run validate:data   # checks docs/game-questions.json
DYNAMODB_ENDPOINT=http://localhost:8000 npm run test:api   # also test the DynamoDB store (start DynamoDB Local first: docker run --rm -p 8000:8000 amazon/dynamodb-local)
npx playwright install chromium   # once, for the browser tests
npm run test:browser              # the pages in real Chromium (skipped if Chromium is missing)
npm run dev       # builds, then serves the site and API on http://localhost:8787 (in-memory data; restart to reset)
```

Mobile first: write styles for phones in `web/css/site.css` and add `@media (min-width: ...)` blocks only to enlarge things on bigger screens. Use Bootstrap's grid and utility classes in the HTML first. The CSP allows only files served from the site itself: no inline `<script>`, `<style>` or `style=""`, and no CDNs (`npm test` fails if you break this).

## Infrastructure

- Runs in HCP Terraform (org `mickoscode`, workspace `surf-club-scavenger-hunt`), in the same AWS account as `surf-club-signin`, region `ap-southeast-2`.
- The bucket is private. Only this CloudFront distribution can read it (Origin Access Control).
- `/api/*` on the same address goes to API Gateway and two Lambda functions (`public` and `admin`, least-privilege roles) backed by one DynamoDB table. Terraform creates the functions with a placeholder (they answer 503 `not-deployed`); the deploy workflow pushes the real code, so a change to `api/` or the questions never needs a Terraform apply.
- The admin pages (`/game-config/*`, `/game-score/*`) are served with `X-Robots-Tag: noindex`.
- GitHub Actions deploys with OIDC and a role limited to this repo's `main` branch and this bucket; no AWS keys are stored in GitHub.
- No custom domain yet: the site is served from the `*.cloudfront.net` address in the `site_url` output. Set `domain_name` in `terraform/tfvars/prod.tfvars` to switch (see `docs/setup.md`).

## Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `web-pr.yml` | PR touching the frontend or tests | `npm test` (build + CSP checks + unit tests). Required check: `Validate site` |
| `web-pr.yml` | PR touching the frontend, backend or tests | The pages in real Chromium. Required check: `Browser tests` |
| `web-pr.yml` | PR touching `api/` or `tests/api/` | The store contract tests against DynamoDB Local. Required check: `API tests` |
| `web-pr.yml` | PR touching `docs/game-questions.json` or the maps | Structure check of the game file. Required check: `Game data` |
| `terraform-pr.yml` | PR touching `terraform/` | fmt, validate, tflint, Trivy security scan, speculative plan posted as a PR comment |
| `terraform-apply.yml` | push to `main` touching `terraform/` | checks, plan, then an apply that waits for manual approval in the `terraform-production` environment |
| `deploy.yml` | push to `main` touching the frontend, the backend (`api/`) or the questions, or manual | builds and tests, deploys the Lambda code, syncs `dist/` to S3, invalidates CloudFront, then smoke-tests the live site |
| `terraform-drift.yml` | weekly | plan only; fails if live AWS differs from `main` |
| `delete-merged-branch.yml` | PR merged | deletes the PR's branch |

The backend is deployed by `deploy.yml`, not by Terraform: merging a change to `api/` or to `docs/game-questions.json` updates the live game (no apply approval needed). If the smoke test fails, nothing is rolled back: fix forward, or revert the PR and re-run **Deploy site**.

Dependabot proposes weekly updates for GitHub Actions, Terraform providers and Bootstrap. Merging to `main` deploys to production.
