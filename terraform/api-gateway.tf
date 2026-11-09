locals {
  # Only these routes exist: anything else is answered by API Gateway without running any code, and the admin
  # function can never be reached through a player route (or the other way round).
  api_routes = {
    public = [
      "GET /api/health",
      "GET /api/game",
      "GET /api/scoreboard",
      "GET /api/me",
      "GET /api/results",
      "POST /api/join",
      "POST /api/answer",
      "POST /api/photo",
    ]
    admin = [
      "GET /api/admin/session",
      "POST /api/admin/login",
      "POST /api/admin/logout",
      "GET /api/admin/config",
      "PUT /api/admin/config",
      "GET /api/admin/events",
      "GET /api/admin/events/{name}",
      "DELETE /api/admin/events/{name}",
      "GET /api/admin/events/{name}/download",
      "PUT /api/admin/events/{name}/config",
      "PUT /api/admin/events/{name}/questions",
      "PUT /api/admin/events/{name}/instructions",
      "PUT /api/admin/events/{name}/maps/{map}",
      "GET /api/admin/teams",
      "DELETE /api/admin/teams/{number}",
      "GET /api/admin/photos",
      "POST /api/admin/photos/apply",
      "POST /api/admin/results/publish",
      "POST /api/admin/results/unpublish",
      "GET /api/admin/export",
      "POST /api/admin/delete-all",
    ]
  }
  api_route_targets = merge([for fn, routes in local.api_routes : { for route in routes : route => fn }]...)
}

resource "aws_apigatewayv2_api" "api" {
  name          = local.name
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "api" {
  for_each = local.functions

  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api[each.key].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "api" {
  for_each = local.api_route_targets

  api_id    = aws_apigatewayv2_api.api.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.api[each.value].id}"
}

# Limits for the whole API, so a runaway client cannot run up a bill.
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_rate_limit  = var.api_throttle_rate_limit
    throttling_burst_limit = var.api_throttle_burst_limit
  }
}

resource "aws_lambda_permission" "api" {
  for_each = local.functions

  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
