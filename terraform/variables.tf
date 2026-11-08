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

variable "api_throttle_rate_limit" {
  description = "Steady-state requests per second allowed across the whole API"
  type        = number
  default     = 50
  validation {
    condition     = var.api_throttle_rate_limit >= 1
    error_message = "Rate limit must be at least 1 request per second."
  }
}

variable "api_throttle_burst_limit" {
  description = "Maximum burst of requests allowed across the whole API (a burst absorbs everyone loading the game at the start; the sustained rate above is what limits the cost)"
  type        = number
  default     = 200
  validation {
    condition     = var.api_throttle_burst_limit >= 1
    error_message = "Burst limit must be at least 1."
  }
}

variable "admin_passcode_hash" {
  description = "One-way hash of the admin passcode, made on the admin's computer with scripts/admin-passcode.js. Set it as a sensitive HCP Terraform workspace variable, never in tfvars. Empty means no passcode is set yet and the admin pages stay open (rollout only)."
  type        = string
  sensitive   = true
  default     = ""
  validation {
    condition     = var.admin_passcode_hash == "" || can(regex("^scrypt\\$[0-9]+\\$[0-9]+\\$[0-9]+\\$[A-Za-z0-9_-]+\\$[A-Za-z0-9_-]+$", var.admin_passcode_hash))
    error_message = "The admin passcode hash must be empty or look like the output of scripts/admin-passcode.js (it starts with scrypt and has five $ separated parts)."
  }
}
