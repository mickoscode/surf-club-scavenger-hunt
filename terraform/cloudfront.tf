locals {
  use_custom_domain = var.domain_name != ""

  # The browser only runs scripts and styles served from this site (no inline code, no CDNs).
  # tests/build.test.js keeps the pages compatible with this.
  content_security_policy = join("; ", [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:", # data: for the SVG icons inside bootstrap.min.css
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ])
}

# -----------------------------------------------------------
# Optional custom domain: ACM certificate (must be in us-east-1) validated by a DNS record you add.
# -----------------------------------------------------------
resource "aws_acm_certificate" "site" {
  count    = local.use_custom_domain ? 1 : 0
  provider = aws.us-east-1

  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Apply waits here until the DNS validation record exists and ACM has issued the certificate.
resource "aws_acm_certificate_validation" "site" {
  count    = local.use_custom_domain ? 1 : 0
  provider = aws.us-east-1

  certificate_arn = aws_acm_certificate.site[0].arn
}

# -----------------------------------------------------------
# Security headers added to every response (pages, assets, the 404 page and the API).
# "site" is used everywhere except the admin pages, which use "admin": the same headers plus X-Robots-Tag, so
# search engines never index them.
# -----------------------------------------------------------
moved {
  from = aws_cloudfront_response_headers_policy.security
  to   = aws_cloudfront_response_headers_policy.security["site"]
}

resource "aws_cloudfront_response_headers_policy" "security" {
  for_each = {
    site  = "Browser security headers for the static site"
    admin = "Browser security headers for the admin pages, which search engines must not index"
  }

  name    = each.key == "site" ? "${var.bucket_name}-security-headers" : "${var.bucket_name}-security-headers-${each.key}"
  comment = each.value

  security_headers_config {
    # Only ever use HTTPS for this domain (1 year).
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = false
      preload                    = false
      override                   = true
    }

    # Stop browsers guessing a file's type.
    content_type_options {
      override = true
    }

    # Stop other sites embedding this one in a frame (clickjacking).
    frame_options {
      frame_option = "DENY"
      override     = true
    }

    # Send only the origin (not the full URL) to other sites.
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    content_security_policy {
      content_security_policy = local.content_security_policy
      override                = true
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
      override = true
    }

    dynamic "items" {
      for_each = each.key == "admin" ? [1] : []
      content {
        header   = "X-Robots-Tag"
        value    = "noindex, nofollow"
        override = true
      }
    }
  }
}

# -----------------------------------------------------------
# Page rewrites: /view/ -> /view/index.html, /view -> /view/ (see rewrite.js). S3 only knows exact file names.
# -----------------------------------------------------------
resource "aws_cloudfront_function" "rewrite" {
  name    = "${replace(var.bucket_name, ".", "-")}-rewrite" # function names cannot contain dots
  runtime = "cloudfront-js-2.0"
  comment = "Serve directory index pages and add the trailing slash"
  publish = true
  code    = file("${path.module}/rewrite.js")
}

# -----------------------------------------------------------
# CloudFront distribution: HTTPS only, reads the private bucket via Origin Access Control.
# -----------------------------------------------------------
resource "aws_cloudfront_origin_access_control" "site" {
  name                              = var.bucket_name
  description                       = "Lets CloudFront (and only CloudFront) read the site bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

# Forwards the cookie, headers and body the API needs, but not the Host header (API Gateway needs its own).
data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

# For the two API responses that are the same for everyone (/api/game, /api/scoreboard): CloudFront keeps them for
# as long as the API says (Cache-Control max-age=3, at most 10 seconds), so many viewers share one lookup. With
# no TTL from the API (or no-store) nothing is cached. No cookies are in the cache key, so ONLY routes that give
# everybody the same answer may use this policy: everything personal goes through Managed-CachingDisabled.
resource "aws_cloudfront_cache_policy" "api_shared" {
  name        = "${local.name}-api-shared"
  comment     = "Honour the API's own short Cache-Control; nothing in the cache key"
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 10

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_distribution" "site" {
  comment             = "Sorrento SLS Youth Scavenger Hunt"
  enabled             = true
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  default_root_object = "index.html"
  price_class         = "PriceClass_All" # the cheaper classes have no Australian edge locations
  aliases             = local.use_custom_domain ? [var.domain_name] : []

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "site-bucket"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  origin {
    domain_name = replace(aws_apigatewayv2_api.api.api_endpoint, "https://", "")
    origin_id   = "api"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "site-bucket"
    compress         = true

    viewer_protocol_policy     = "redirect-to-https"
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security["site"].id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.rewrite.arn
    }
  }

  # The API. The two shared responses first (more specific), then everything else uncached with the cookie passed on.
  dynamic "ordered_cache_behavior" {
    for_each = ["/api/game", "/api/scoreboard"]
    content {
      path_pattern     = ordered_cache_behavior.value
      allowed_methods  = ["GET", "HEAD"]
      cached_methods   = ["GET", "HEAD"]
      target_origin_id = "api"
      compress         = true

      viewer_protocol_policy     = "https-only"
      cache_policy_id            = aws_cloudfront_cache_policy.api_shared.id
      response_headers_policy_id = aws_cloudfront_response_headers_policy.security["site"].id
    }
  }

  ordered_cache_behavior {
    path_pattern     = "/api/*"
    allowed_methods  = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "api"
    compress         = true

    viewer_protocol_policy     = "https-only"
    cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security["site"].id
  }

  # The admin pages: same bucket, but marked noindex.
  dynamic "ordered_cache_behavior" {
    for_each = ["/game-config/*", "/game-score/*", "/game-events/*", "/game-teams/*"]
    content {
      path_pattern     = ordered_cache_behavior.value
      allowed_methods  = ["GET", "HEAD"]
      cached_methods   = ["GET", "HEAD"]
      target_origin_id = "site-bucket"
      compress         = true

      viewer_protocol_policy     = "redirect-to-https"
      cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
      response_headers_policy_id = aws_cloudfront_response_headers_policy.security["admin"].id

      function_association {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.rewrite.arn
      }
    }
  }

  # Without s3:ListBucket for CloudFront, S3 answers 403 (not 404) for a missing file.
  # NOTE: custom error pages apply to EVERY behaviour, the API included, so the API never uses 403 or 404 for its own
  # errors (see api/app/app.js and docs/api.md).
  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 404
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 10
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = local.use_custom_domain ? null : true
    acm_certificate_arn            = local.use_custom_domain ? aws_acm_certificate_validation.site[0].certificate_arn : null
    ssl_support_method             = local.use_custom_domain ? "sni-only" : null
    minimum_protocol_version       = local.use_custom_domain ? "TLSv1.2_2021" : null
  }
}
