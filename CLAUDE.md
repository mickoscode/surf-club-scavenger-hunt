# CLAUDE.md

Website for the Sorrento SLS Youth Scavenger Hunt 2026/27: a static site (`web/`) in a private S3 bucket behind CloudFront, Terraform in `terraform/`, GitHub Actions for CI/CD. Same AWS account as `surf-club-signin` (account `722937635825`, `ap-southeast-2`). Currently a coming-soon page only. See `README.md` for layout and `docs/setup.md` for one-time setup.

## Frontend

- Bootstrap 5 (npm dependency, pinned) is copied into `dist/vendor/bootstrap/` by `scripts/build.sh`; it is not committed. `dist/` is the exact bucket contents and is gitignored.
- Mobile first: base styles are for phones, `@media (min-width: ...)` only enlarges. Prefer Bootstrap utilities and grid before adding CSS to `web/css/site.css`.
- The CSP (`terraform/cloudfront.tf`, `local.content_security_policy`) allows only same-origin scripts, styles, images (plus `data:`), fonts and connections. No inline `<script>`/`<style>`/`style=""`/`on*=` handlers and no CDN or external URLs. If a feature needs more (an API, an image host), widen the CSP deliberately in the same PR and update `tests/build.test.js` if its assumptions change.
- Use site-absolute paths (`/css/site.css`), because `404.html` is served from any URL.
- Static assets are synced with `Cache-Control: no-cache` and CloudFront is invalidated on each deploy, so there is no filename hashing.

## Infrastructure

- HCP Terraform org `mickoscode`, workspace `surf-club-scavenger-hunt` (remote execution; state and AWS credentials live there). Secrets are workspace variables, never in tfvars or the repo (the repo may be public).
- The bucket is private, readable only by this CloudFront distribution (OAC). The deploy role (`scavenger-hunt-deploy-role`) trusts only this repo's `main` branch via the account's existing GitHub OIDC provider, which is owned by `surf-club-signin` and only looked up here.
- Trivy accepted findings are in `terraform/.trivyignore.yaml`, each with a reason.
- `domain_name` is empty until a custom domain is chosen (see `docs/setup.md`).

## CI/CD

- `web-pr.yml` (`Validate site`) and `terraform-pr.yml` (validate, security scan, plan comment) run on PRs and are skipped, not absent, when their folders are unchanged, so they can be required checks.
- Merging to `main` deploys: `deploy.yml` for the frontend (needs repo variable `CF_DISTRIBUTION_ID`), `terraform-apply.yml` for `terraform/` (manual approval in the `terraform-production` environment). `terraform-drift.yml` checks weekly.
- Actions are pinned to commit SHAs with a version comment; Dependabot bumps them weekly.

## Working conventions

- Raise PRs with `gh` from a feature branch and commit only the files you changed (explicit `git add` paths). The owner reviews and merges every PR and handles GitHub settings, HCP/AWS settings and Terraform applies.
- Tests only where a regression would really hurt (currently the CSP/build check). No trivia or "guard" tests.
- Keep it simple: this site is deliberately much smaller than `surf-club-signin`.
