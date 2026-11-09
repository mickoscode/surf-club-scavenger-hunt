# The events bucket: private storage for the games ("events") the admin prepares, one folder per event
# (<event>/game-config.json, game-questions.json, player-instructions.md and game-zones/*). Unlike the site bucket nothing
# reads it through CloudFront and nothing here is public: only the admin Lambda function can read and write it (lambda.tf),
# and the live game never touches it (activating an event copies it into the game's table). Kept apart from the site
# bucket because a real game's questions and answers live here, not in the public repository.
data "aws_caller_identity" "current" {}

locals {
  events_bucket_name = "${data.aws_caller_identity.current.account_id}-scavenger-events"
}

resource "aws_s3_bucket" "events" {
  bucket = local.events_bucket_name
}

resource "aws_s3_bucket_ownership_controls" "events" {
  bucket = aws_s3_bucket.events.id

  rule {
    object_ownership = "BucketOwnerEnforced" # ACLs disabled
  }
}

resource "aws_s3_bucket_public_access_block" "events" {
  bucket = aws_s3_bucket.events.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "events" {
  bucket = aws_s3_bucket.events.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Unlike the site (rebuilt from git), the events exist nowhere else, so keep old versions: a bad edit or delete can be undone
# in the S3 console. Old versions are removed after 30 days so they do not pile up.
resource "aws_s3_bucket_versioning" "events" {
  bucket = aws_s3_bucket.events.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "events" {
  bucket = aws_s3_bucket.events.id

  rule {
    id     = "expire-old-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  depends_on = [aws_s3_bucket_versioning.events]
}

data "aws_iam_policy_document" "events_bucket" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.events.arn, "${aws_s3_bucket.events.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "events" {
  bucket = aws_s3_bucket.events.id
  policy = data.aws_iam_policy_document.events_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.events]
}
