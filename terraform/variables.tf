variable "bucket_name" {
  description = "S3 bucket name (private; only CloudFront can read it). S3 names are global, so it must be unique."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9.-]{3,63}$", var.bucket_name))
    error_message = "Bucket name must be 3-63 characters, lowercase, and valid for S3."
  }
}

variable "github_repo" {
  description = "GitHub repository (owner/name) allowed to assume the deploy role"
  type        = string
  validation {
    condition     = can(regex("^[a-zA-Z0-9-]{1,39}/[a-zA-Z0-9._-]+$", var.github_repo))
    error_message = "GitHub repository must be in the form owner/name."
  }
}

variable "github_oidc_subject_prefix" {
  description = "Subject prefix of the repository's GitHub OIDC tokens. Get it with: gh api repos/<owner>/<repo>/actions/oidc/customization/sub --jq .sub_claim_prefix"
  type        = string
  validation {
    condition     = can(regex("^repo:[^:*?]+$", var.github_oidc_subject_prefix))
    error_message = "Subject prefix must look like repo:owner@id/name@id (no colons or wildcards)."
  }
}

variable "domain_name" {
  description = "Custom domain for the site (e.g. hunt.example.org). Leave empty to serve from the generated *.cloudfront.net address. When set, apply creates an ACM certificate and waits until you add its DNS validation record (see the acm_validation_records output)."
  type        = string
  default     = ""
  validation {
    condition     = var.domain_name == "" || can(regex("^([a-z0-9-]+\\.)+[a-z]{2,}$", var.domain_name))
    error_message = "Domain name must be empty or a lowercase fully qualified domain name."
  }
}
