locals {
  name = "scavenger-hunt"

  # Two functions run the same code (api/) with different routes and different permissions: "public" is what
  # players and viewers use, "admin" serves the two admin pages. Each gets only the DynamoDB actions it needs.
  functions = {
    public = {
      description    = "Scavenger hunt API: join, play, scoreboard"
      dynamo_actions = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem"]
      manages_events = false
    }
    admin = {
      description    = "Scavenger hunt admin API: config, scoring, teams, events, export and delete"
      manages_events = true # reads and writes the events bucket, and copies the active event's maps to the site

      dynamo_actions = [
        "dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem",
        "dynamodb:DeleteItem", "dynamodb:BatchWriteItem",
      ]
    }
  }
}

resource "aws_cloudwatch_log_group" "api" {
  for_each = local.functions

  name              = "/aws/lambda/${local.name}-${each.key}"
  retention_in_days = 30
}

resource "aws_iam_role" "lambda" {
  for_each = local.functions

  name = "${local.name}-${each.key}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "lambda" {
  for_each = local.functions

  name = "${local.name}-${each.key}-access"
  role = aws_iam_role.lambda[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        {
          Sid      = "GameTable"
          Effect   = "Allow"
          Action   = each.value.dynamo_actions
          Resource = [aws_dynamodb_table.game.arn]
        },
        {
          Sid      = "OwnLogGroupOnly"
          Effect   = "Allow"
          Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
          Resource = "${aws_cloudwatch_log_group.api[each.key].arn}:*"
        }
      ],
      # Only the admin function: the events (a real game's questions and answers) are private, and the live game never reads them.
      each.value.manages_events ? [
        {
          Sid      = "ListEvents"
          Effect   = "Allow"
          Action   = ["s3:ListBucket"]
          Resource = aws_s3_bucket.events.arn
        },
        {
          Sid      = "ReadWriteEvents"
          Effect   = "Allow"
          Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
          Resource = "${aws_s3_bucket.events.arn}/*"
        },
        {
          # Activating an event copies its maps into the site under event-maps/ (a path the deploy leaves alone).
          Sid       = "ListEventMapsOnSite"
          Effect    = "Allow"
          Action    = ["s3:ListBucket"]
          Resource  = aws_s3_bucket.site.arn
          Condition = {
            StringLike = { "s3:prefix" = ["event-maps/*"] }
          }
        },
        {
          Sid      = "WriteEventMapsOnSite"
          Effect   = "Allow"
          Action   = ["s3:PutObject", "s3:DeleteObject"]
          Resource = "${aws_s3_bucket.site.arn}/event-maps/*"
        },
      ] : [],
    )
  })
}

# Terraform creates each function with a tiny placeholder that answers "not deployed". The real code is pushed
# by the deploy workflow (aws lambda update-function-code), so merging a change to api/ or to the questions
# updates the game without a Terraform apply. ignore_changes stops Terraform undoing that on its next run.
data "archive_file" "placeholder" {
  for_each = local.functions

  type        = "zip"
  output_path = "${path.module}/.placeholder-${each.key}.zip"

  source {
    filename = "handlers/${each.key}.js"

    content = <<-EOT
      exports.handler = async () => ({
        statusCode: 503,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'not-deployed' }),
      });
    EOT
  }
}

resource "aws_lambda_function" "api" {
  for_each = local.functions

  function_name    = "${local.name}-${each.key}"
  description      = each.value.description
  role             = aws_iam_role.lambda[each.key].arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "handlers/${each.key}.handler"
  memory_size      = 256
  timeout          = 10
  filename         = data.archive_file.placeholder[each.key].output_path
  source_code_hash = data.archive_file.placeholder[each.key].output_base64sha256

  # Only the admin function is given the passcode hash (a one-way hash: it cannot be turned back into the passcode) and the bucket names.
  environment {
    variables = merge(
      { TABLE_NAME = aws_dynamodb_table.game.name },
      each.key == "admin" ? tomap({ ADMIN_PASSCODE_HASH = var.admin_passcode_hash, EVENTS_BUCKET = aws_s3_bucket.events.bucket, SITE_BUCKET = aws_s3_bucket.site.bucket }) : tomap({}),
    )
  }

  depends_on = [aws_cloudwatch_log_group.api]

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}
