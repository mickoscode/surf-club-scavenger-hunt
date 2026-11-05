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
# Security headers added to every response (pages, assets and the 404 page).
# -----------------------------------------------------------
resource "aws_cloudfront_response_headers_policy" "security" {
  name    = "${var.bucket_name}-security-headers"
  comment = "Browser security headers for the static site"

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
  }
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

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "site-bucket"
    compress         = true

    viewer_protocol_policy     = "redirect-to-https"
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
  }

  # Without s3:ListBucket for CloudFront, S3 answers 403 (not 404) for a missing file.
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
