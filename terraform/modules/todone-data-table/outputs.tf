# Vendored from family-paas beb37ef0e19d896984cb3c16165b2307e38fdf31; only expiresAt TTL is added.
output "table_arn" {
  description = "ARN of the DynamoDB table"
  value       = aws_dynamodb_table.this.arn
}

output "table_name" {
  description = "Name of the DynamoDB table"
  value       = aws_dynamodb_table.this.name
}

output "point_in_time_recovery_enabled" {
  description = "Whether point-in-time recovery is enabled (inspectable evidence)"
  value       = aws_dynamodb_table.this.point_in_time_recovery[0].enabled
}

output "global_secondary_index_names" {
  description = "Names of all GSIs on the table"
  value       = [for gsi in var.global_secondary_indexes : gsi.name]
}
