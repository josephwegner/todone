variable "allowed_origins" {
  description = <<-EOT
    Explicit browser origins permitted by API Gateway CORS. Must NOT be left
    unset/default; the api-gateway module defaults to ["*"], which fails the
    Todone authorization boundary (see docs/architecture/system-context.md).
    Include local development origins and the production Todone origin only.
  EOT
  type        = list(string)

  validation {
    condition     = length(var.allowed_origins) > 0 && !contains(var.allowed_origins, "*")
    error_message = "allowed_origins must be a non-empty list of explicit origins, not \"*\"."
  }

  validation {
    condition = length([
      for origin in var.allowed_origins : origin if startswith(origin, "https://")
    ]) == 1
    error_message = "allowed_origins must include exactly one HTTPS production PWA origin."
  }
}

variable "lambda_artifacts" {
  description = "Release-supplied S3 key and base64 SHA-256 for every Lambda artifact."
  type = map(object({
    s3_key           = string
    source_code_hash = string
  }))

  validation {
    condition = alltrue([
      for name in ["session", "current-membership", "create-household", "profile", "family-directory", "create-child", "reset-child-password", "create-parent", "activate-parent", "pending-parent-actions", "recovery-email", "remove-child", "pre-signup"] :
      contains(keys(var.lambda_artifacts), name)
    ])
    error_message = "lambda_artifacts must include every bootstrap Lambda."
  }
}

variable "registration_gate_password_hash" {
  description = "Lower-case hexadecimal SHA-256 of the reusable registration gate password. Never output or log this value."
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[a-f0-9]{64}$", var.registration_gate_password_hash))
    error_message = "registration_gate_password_hash must be a lower-case SHA-256 hex digest."
  }
}

variable "production_domain" {
  description = "Optional custom domain for the production PWA. Leave empty to use the default CloudFront domain."
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "Optional ACM certificate ARN for production_domain. Must be issued in us-east-1 for CloudFront."
  type        = string
  default     = ""
}
