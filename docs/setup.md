# One-time setup

The repo needs these set up outside git before it can deploy: HCP Terraform (state, AWS access and the admin passcode hash), GitHub (secrets, an environment, variables, a ruleset) and, after the first apply, two repository variables. **Nothing needs to change in AWS or in the `surf-club-signin` repo**: this repo reuses that account's existing GitHub OIDC provider.

## Before the first deploy

1. **HCP Terraform workspace.** In org `mickoscode`, create workspace `surf-club-scavenger-hunt` (CLI-driven workflow, execution mode *Remote*).
2. **AWS access for that workspace.** Give it the same AWS credentials mechanism the `surf-club-signin` workspace uses (workspace variables `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` marked sensitive, or HCP dynamic credentials; a *variable set* shared by both workspaces is the tidiest). The identity must be able to create S3 buckets and policies, CloudFront distributions / OACs / response-headers policies, ACM certificates, and IAM roles and policies, and read the account's OIDC provider (`iam:GetOpenIDConnectProvider`).
3. **GitHub secret `TF_API_TOKEN`.** Repo Settings > Secrets and variables > Actions > *New repository secret*. Use an HCP Terraform team token limited to this workspace (or a user token). All Terraform workflows need it, including the PR checks.
4. **GitHub environment `terraform-production`.** Settings > Environments > New environment, add yourself under *Required reviewers*. The Terraform apply job waits for your approval here. (On a private repo this needs a paid GitHub plan; a public repo is fine.)
5. **Repo settings.** Settings > Actions > General: *Workflow permissions* = "Read repository contents and packages permissions" (the workflows request what they need). Settings > General: tick *Automatically delete head branches* if you want (`delete-merged-branch.yml` does the same job).

## The first change

Open a pull request from a branch and let the checks run: `Validate site`, `Terraform validate`, `Terraform security scan` and `Terraform plan` (the plan is posted as a comment; review it). Fix anything they flag, then merge.

## After the merge

1. `terraform-apply.yml` runs a plan, then waits. Open the run, review the plan, and click *Review deployments* > approve `terraform-production`.
2. When the apply finishes, read the `cloudfront_distribution_id` and `site_url` values from the HCP Terraform run's outputs.
3. Set repository variables **`CF_DISTRIBUTION_ID`** and **`SITE_URL`** (Settings > Secrets and variables > Actions > *Variables*) to the distribution ID and the `site_url` output (e.g. `https://d123abc.cloudfront.net`, no trailing slash needed). `SITE_URL` is used by the post-deploy smoke test; the deploy refuses to run without both.
4. Run **Deploy site** from the Actions tab on `main` (*Run workflow*). The merge itself also triggered a deploy, but it fails fast with a clear message because the variable was not set yet. After this, every merge touching `web/` deploys automatically.
5. Open `site_url`: you should see the scoreboard page (its status reads "Coming soon" until a game is configured).

## The API

The API's infrastructure (DynamoDB, two Lambda functions, API Gateway, the `/api/*` route on CloudFront) is created by Terraform, so **the HCP workspace's AWS identity also needs permission** to create Lambda functions, API Gateway APIs, DynamoDB tables, CloudWatch log groups and CloudFront functions/cache policies, and to create IAM roles for the functions. Terraform creates the functions with a placeholder that answers `503 {"error":"not-deployed"}`; the deploy workflow replaces it with the real code, so a change to `api/` or the questions never needs a Terraform apply.

## Protect `main` (after the first pull request has run once)

Settings > Rules > Rulesets > New branch ruleset, target `main`: require a pull request, block force pushes and deletion, and require status checks `Validate site`, `Browser tests`, `API tests`, `Game data`, `Terraform validate`, `Terraform security scan` and `Terraform plan`. The check names only appear in the picker after they have run once, which is why this comes after the first pull request. These jobs are skipped (not absent) when their folder is unchanged, so they can safely be required.

## The events bucket

Terraform also creates a second, private bucket, `<aws-account-id>-scavenger-events` (see the `events_bucket_name` output), where the games ("events") the admin prepares are kept, away from the public repository. Nothing is public and nothing reads it through CloudFront: only the admin Lambda function can read and write it, and it also writes the active event's maps to the site bucket under `event-maps/` (the deploy leaves that folder alone). Versioning is on (old versions are removed after 30 days), so a bad edit can be undone in the S3 console. **The HCP workspace's AWS identity also needs permission** to create it: the same S3 bucket permissions as for the site bucket, plus versioning and lifecycle configuration.

## Admin passcode

The two admin pages and the admin API need a passcode. Until it is set they are open to anyone who knows the page addresses, so set it before the real game.

1. On your own computer: `node scripts/admin-passcode.js`. It prints a random passcode and its one-way hash. Keep the passcode in your password manager; it is never stored anywhere else by the site.
2. In the HCP Terraform workspace add a **Terraform variable** `admin_passcode_hash` with the hash, marked **sensitive** (never put it in `tfvars` or the repo), and run an apply.
3. Optional, for the load test (`docs/runbook.md`, "Load test"): add the passcode as the GitHub secret `ADMIN_PASSCODE` so the test can remove its own test teams.

To change or recover the passcode, generate a new one, replace the variable and apply: every existing admin session ends.

## Custom domain (optional)

1. Set `domain_name = "hunt.example.org"` in `terraform/tfvars/prod.tfvars` and merge via PR.
2. The apply creates an ACM certificate and then **waits** for DNS validation. While it waits, read `acm_validation_records` from the run's outputs (or the ACM console in us-east-1) and create that CNAME at your DNS provider. Approve/let the apply finish once ACM issues the certificate.
3. Create a CNAME from `domain_name` to the `cloudfront_domain_name` output.

## Notes

- The deploy role is trusted only for this repo's `main` branch, matched on GitHub's immutable subject (`github_oidc_subject_prefix` in `tfvars/prod.tfvars`, which includes the owner and repo IDs; the plain `repo:owner/name` form is rejected for new repos), so `deploy.yml` works only when run from `main`; PR branches cannot assume it.
- The GitHub OIDC provider is created by `surf-club-signin`'s Terraform (`aws_iam_openid_connect_provider.github`). This repo only looks it up. If that repo ever drops it, deploys here stop working until it is recreated.
- `terraform/.terraform.lock.hcl` pins the provider versions. Dependabot's Terraform updates refresh it; if you add a provider, run `terraform init` in `terraform/` and commit the updated file.
- The bucket name `sorrento-sls-scavenger-hunt` must be globally unique; if the apply fails with `BucketAlreadyExists`, change `bucket_name` in `tfvars/prod.tfvars` **and** `BUCKET` in `deploy.yml`.
