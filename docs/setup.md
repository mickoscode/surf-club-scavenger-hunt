# One-time setup

The repo needs three things set up outside git before it can deploy: HCP Terraform (state and AWS access), GitHub (a secret, an environment, a variable, a ruleset) and, after the first apply, a repository variable. **Nothing needs to change in AWS or in the `surf-club-signin` repo**: this repo reuses that account's existing GitHub OIDC provider.

## Before the first pull request

1. **HCP Terraform workspace.** In org `mickoscode`, create workspace `surf-club-scavenger-hunt` (CLI-driven workflow, execution mode *Remote*).
2. **AWS access for that workspace.** Give it the same AWS credentials mechanism the `surf-club-signin` workspace uses (workspace variables `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` marked sensitive, or HCP dynamic credentials; a *variable set* shared by both workspaces is the tidiest). The identity must be able to create S3 buckets and policies, CloudFront distributions / OACs / response-headers policies, ACM certificates, and IAM roles and policies, and read the account's OIDC provider (`iam:GetOpenIDConnectProvider`).
3. **GitHub secret `TF_API_TOKEN`.** Repo Settings > Secrets and variables > Actions > *New repository secret*. Use an HCP Terraform team token limited to this workspace (or a user token). All Terraform workflows need it, including the PR checks.
4. **GitHub environment `terraform-production`.** Settings > Environments > New environment, add yourself under *Required reviewers*. The Terraform apply job waits for your approval here. (On a private repo this needs a paid GitHub plan; a public repo is fine.)
5. **Repo settings.** Settings > Actions > General: *Workflow permissions* = "Read repository contents and packages permissions" (the workflows request what they need). Settings > General: tick *Automatically delete head branches* if you want (`delete-merged-branch.yml` does the same job).

## First pull request

Push the `bootstrap` branch, open a PR and let the checks run: `Validate site`, `Terraform validate`, `Terraform security scan`, `Terraform plan` (the plan comment should show 11 resources to add). Fix anything they flag, then merge.

## After the merge

1. `terraform-apply.yml` runs a plan, then waits. Open the run, review the plan, and click *Review deployments* > approve `terraform-production`.
2. When the apply finishes, read the `cloudfront_distribution_id` and `site_url` values from the HCP Terraform run's outputs.
3. Set repository variable **`CF_DISTRIBUTION_ID`** (Settings > Secrets and variables > Actions > *Variables*) to the distribution ID.
4. Run **Deploy site** from the Actions tab on `main` (*Run workflow*). The merge itself also triggered a deploy, but it fails fast with a clear message because the variable was not set yet. After this, every merge touching `web/` deploys automatically.
5. Open `site_url`: you should see the coming-soon page.

## Protect `main` (after the first PR has run once)

Settings > Rules > Rulesets > New branch ruleset, target `main`: require a pull request, block force pushes and deletion, and require status checks `Validate site`, `Terraform validate`, `Terraform security scan` and `Terraform plan`. The check names only appear in the picker after they have run once, which is why this comes after the first PR. These jobs are skipped (not absent) when their folder is unchanged, so they can safely be required.

## Custom domain (optional, later)

1. Set `domain_name = "hunt.example.org"` in `terraform/tfvars/prod.tfvars` and merge via PR.
2. The apply creates an ACM certificate and then **waits** for DNS validation. While it waits, read `acm_validation_records` from the run's outputs (or the ACM console in us-east-1) and create that CNAME at your DNS provider. Approve/let the apply finish once ACM issues the certificate.
3. Create a CNAME from `domain_name` to the `cloudfront_domain_name` output.

## Notes

- The deploy role is trusted only for `repo:mickoscode/surf-club-scavenger-hunt:ref:refs/heads/main`, so `deploy.yml` works only when run from `main`; PR branches cannot assume it.
- The GitHub OIDC provider is created by `surf-club-signin`'s Terraform (`aws_iam_openid_connect_provider.github`). This repo only looks it up. If that repo ever drops it, deploys here stop working until it is recreated.
- `terraform/.terraform.lock.hcl` is not committed yet (it could not be generated without Terraform locally). Run `terraform init` in `terraform/` once with HCP access and commit the file so provider versions are pinned.
- The bucket name `sorrento-sls-scavenger-hunt` must be globally unique; if the apply fails with `BucketAlreadyExists`, change `bucket_name` in `tfvars/prod.tfvars` **and** `BUCKET` in `deploy.yml`.
