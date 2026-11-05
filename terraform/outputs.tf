output "site_url" {
  value       = local.use_custom_domain ? "https://${var.domain_name}" : "https://${aws_cloudfront_distribution.site.domain_name}"
  description = "Where the site is served"
}

output "cloudfront_distribution_id" {
  value       = aws_cloudfront_distribution.site.id
  description = "Set this as the GitHub repository variable CF_DISTRIBUTION_ID (used by deploy.yml)"
}

output "cloudfront_domain_name" {
  value       = aws_cloudfront_distribution.site.domain_name
  description = "Point a CNAME for var.domain_name at this when using a custom domain"
}

output "github_deploy_role_arn" {
  value       = aws_iam_role.github_deploy.arn
  description = "Role ARN for GitHub Actions to assume via OIDC (role-to-assume in deploy.yml)"
}

# The DNS validation record to add at your DNS provider. Empty unless var.domain_name is set.
output "acm_validation_records" {
  value = local.use_custom_domain ? {
    for dvo in aws_acm_certificate.site[0].domain_validation_options : dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  } : {}
  description = "DNS records to create so ACM can validate the custom domain certificate"
}
