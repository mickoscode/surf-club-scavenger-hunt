terraform {
  cloud {
    organization = "mickoscode"

    workspaces {
      name = "surf-club-scavenger-hunt"
    }
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.67"
    }

    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }

  required_version = ">= 1.12.0"
}

provider "aws" {
  region = "ap-southeast-2"

  default_tags {
    tags = {
      Project   = "surf-club-scavenger-hunt"
      ManagedBy = "terraform"
    }
  }
}

# CloudFront only accepts ACM certificates from us-east-1 (used only when var.domain_name is set).
provider "aws" {
  alias  = "us-east-1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project   = "surf-club-scavenger-hunt"
      ManagedBy = "terraform"
    }
  }
}
