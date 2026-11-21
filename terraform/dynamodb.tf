# The game's data: teams, answers, scores, photo decisions and the configured game.
# One table; the item layout is described at the top of api/store/dynamo.js and the keys must match
# TABLE_DEFINITION there (tests/api runs the same table definition against DynamoDB Local).
resource "aws_dynamodb_table" "game" {
  name         = local.name
  billing_mode = "PAY_PER_REQUEST" # nothing to size, and it costs next to nothing when idle
  hash_key     = "pk"
  range_key    = "sk"

  # The only copy of every event's teams, answers and scores: neither a console click nor a Terraform change may remove it.
  deletion_protection_enabled = true

  lifecycle {
    prevent_destroy = true
  }

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}
