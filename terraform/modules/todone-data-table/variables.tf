# Vendored from family-paas beb37ef0e19d896984cb3c16165b2307e38fdf31; only expiresAt TTL is added.
variable "table_name" {
  description = "DynamoDB table name"
  type        = string
}

variable "environment" {
  description = "Environment name (e.g. prod)"
  type        = string
}

variable "hash_key" {
  description = "Hash (partition) key attribute name"
  type        = string
}

variable "range_key" {
  description = "Range (sort) key attribute name"
  type        = string
  default     = null
}

variable "attributes" {
  description = "List of attribute definitions"
  type = list(object({
    name = string
    type = string
  }))
}

variable "global_secondary_indexes" {
  description = "List of GSI definitions"
  type = list(object({
    name            = string
    hash_key        = string
    range_key       = optional(string)
    projection_type = optional(string, "ALL")
  }))
  default = []
}

variable "point_in_time_recovery_enabled" {
  description = "Enable point-in-time recovery"
  type        = bool
  default     = true
}

variable "deletion_protection_enabled" {
  description = "Enable table deletion protection (prevents delete via API/console/plan until disabled)"
  type        = bool
  default     = true
}
