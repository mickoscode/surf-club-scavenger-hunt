# CLAUDE.md

Website for the Sorrento SLS Youth Scavenger Hunt 2026/27: a static site (`web/`) in a private S3 bucket behind CloudFront, Terraform in `terraform/`, GitHub Actions for CI/CD. Same AWS account as `surf-club-signin` (account `722937635825`, `ap-southeast-2`). Currently a coming-soon page only. See `README.md` for layout and `docs/setup.md` for one-time setup.

## Frontend

- Bootstrap 5 (npm dependency, pinned) is copied into `dist/vendor/bootstrap/` by `scripts/build.sh`; it is not committed. `dist/` is the exact bucket contents and is gitignored.
- Mobile first: base styles are for phones, `@media (min-width: ...)` only enlarges. Prefer Bootstrap utilities and grid before adding CSS to `web/css/site.css`.
- The CSP (`terraform/cloudfront.tf`, `local.content_security_policy`) allows only same-origin scripts, styles, images (plus `data:`), fonts and connections. No inline `<script>`/`<style>`/`style=""`/`on*=` handlers and no CDN or external URLs. If a feature needs more (an API, an image host), widen the CSP deliberately in the same PR and update `tests/build.test.js` if its assumptions change.
- Use site-absolute paths (`/css/site.css`), because `404.html` is served from any URL.
- Static assets are synced with `Cache-Control: no-cache` and CloudFront is invalidated on each deploy, so there is no filename hashing.

## Backend

- `api/` is the backend, plain CommonJS with no runtime dependencies (the AWS SDK comes with the Lambda runtime). `api/lib/` holds pure game logic: nothing there touches AWS, the clock (always passed in) or the network, so it is unit tested directly in `tests/unit/`. `api/store/` is the data layer: one `store` interface with `memory.js` (local development, handler and browser tests) and `dynamo.js` (production; one table, a team's whole state is one item so "submit once + add to score" is one atomic conditional update). `tests/api/contract.js` is the specification both must pass: it runs against the memory store everywhere and against DynamoDB Local in CI (`API tests`). Change behaviour in the contract first. `api/app/app.js` holds the routes (public and admin roles, deployed as two Lambda functions via `api/handlers/`), `api/app/lambda.js` adapts API Gateway events; the API is documented in `docs/api.md` (keep it in step with the routes). The app tests (`tests/api/app-*.test.js`) use the memory store and a fake clock, and check status/error codes, never wording. They include the leak tests: no public response may contain an official answer, a submitted answer or a team's secret id.
- The server decides everything (timing, answer checking, scoring); official answers and submitted answers never go to the browser. Known and accepted: the repo is public, so the answers are readable on GitHub, and the admin routes have no login (see `docs/requirements.md`). Rules are in `docs/requirements.md`, and the code comments point to the relevant section.

## Infrastructure

- HCP Terraform org `mickoscode`, workspace `surf-club-scavenger-hunt` (remote execution; state and AWS credentials live there). Secrets are workspace variables, never in tfvars or the repo (the repo may be public).
- The bucket is private, readable only by this CloudFront distribution (OAC). The deploy role (`scavenger-hunt-deploy-role`) trusts only this repo's `main` branch (matched on the immutable OIDC subject `github_oidc_subject_prefix`, not the repo name) via the account's existing GitHub OIDC provider, which is owned by `surf-club-signin` and only looked up here.
- API: CloudFront sends `/api/*` to an API Gateway HTTP API (two Lambda functions, one DynamoDB table; `terraform/lambda.tf`, `api-gateway.tf`, `dynamodb.tf`). Lambda code is NOT managed by Terraform (placeholder + `ignore_changes`): the deploy workflow pushes it. Only the routes listed in `api-gateway.tf` exist; add a route there when you add one in `api/app/app.js`.
- CloudFront custom error pages apply to every behaviour, so the API must never answer 403/404 for its own errors (a test enforces it).
- Only `/api/game` and `/api/scoreboard` are cached (3 s, nothing in the cache key); everything else under `/api/*` is uncached with the session cookie passed through. Never point a personal route at the shared cache policy.
- `terraform/rewrite.js` (CloudFront Function) serves `/view/` as `/view/index.html` and redirects `/view` to `/view/`; `tests/unit/rewrite.test.js` runs it.
- Trivy accepted findings are in `terraform/.trivyignore.yaml`, each with a reason.
- `domain_name` is empty until a custom domain is chosen (see `docs/setup.md`).

## CI/CD

- `web-pr.yml` (`Validate site`, `API tests`, `Game data`) and `terraform-pr.yml` (validate, security scan, plan comment) run on PRs and are skipped, not absent, when their folders are unchanged, so they can be required checks.
- Merging to `main` deploys: `deploy.yml` for the frontend (needs repo variable `CF_DISTRIBUTION_ID`), `terraform-apply.yml` for `terraform/` (manual approval in the `terraform-production` environment). `terraform-drift.yml` checks weekly.
- Actions are pinned to commit SHAs with a version comment; Dependabot bumps them weekly.

## Working conventions

- Raise PRs with `gh` from a feature branch and commit only the files you changed (explicit `git add` paths). The owner reviews and merges every PR and handles GitHub settings, HCP/AWS settings and Terraform applies.
- Tests only where a regression would really hurt. No trivia or "guard" tests, and nothing that depends on wording: tests use their own fixtures, never `docs/game-questions.json`, the instructions or page copy. Find elements by `data-testid`, not by text. Layout: `tests/unit/` (`npm test`), later `tests/api/` (store contract, DynamoDB Local in CI) and `tests/browser/` (Playwright under the real CSP).
- `scripts/validate-game-data.js` is the only thing that reads the real `docs/game-questions.json`, and it checks structure only (format in `docs/requirements.md`). It runs in CI as the `Game data` check.
- Keep it simple: this site is deliberately much smaller than `surf-club-signin`.
