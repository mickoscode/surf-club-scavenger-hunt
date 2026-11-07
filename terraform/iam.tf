# -------------------------------
# GitHub Actions deploys through OIDC: no long-lived AWS keys are stored in GitHub.
# -------------------------------
# The account's single GitHub OIDC provider is created and owned by the surf-club-signin repo's Terraform
# (an account can only have one per URL), so it is looked up here, never created.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

# New GitHub repositories issue tokens with an immutable subject that includes the owner and repository IDs
# (repo:<owner>@<id>/<repo>@<id>:ref:...), so renaming or recreating the repo cannot inherit this role.
# The old name-only form (repo:<owner>/<repo>:...) is rejected for such repositories.
resource "aws_iam_role" "github_deploy" {
  name                 = "scavenger-hunt-deploy-role"
  description          = "Assumed by GitHub Actions (main branch of ${var.github_repo} only) to deploy the scavenger hunt site"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "${var.github_oidc_subject_prefix}:ref:refs/heads/main"
        }
      }
    }]
  })
}

# Do not edit the description: an IAM policy description cannot change in place, so Terraform would delete and
# recreate the policy (and its attachment), briefly removing the deploy role's permissions.
resource "aws_iam_policy" "github_deploy" {
  name        = "scavenger-hunt-deploy-policy"
  description = "Sync the scavenger hunt site bucket and invalidate its CloudFront cache"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "SyncSiteBucket"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
        Resource = [aws_s3_bucket.site.arn, "${aws_s3_bucket.site.arn}/*"]
      },
      {
        Sid      = "DeployFunctionCode"
        Effect   = "Allow"
        Action   = ["lambda:UpdateFunctionCode", "lambda:GetFunction", "lambda:GetFunctionConfiguration"]
        Resource = [for f in aws_lambda_function.api : f.arn]
      },
      {
        Sid      = "InvalidateCache"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation"]
        Resource = aws_cloudfront_distribution.site.arn
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "github_deploy" {
  role       = aws_iam_role.github_deploy.name
  policy_arn = aws_iam_policy.github_deploy.arn
}
