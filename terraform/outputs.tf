output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.todone.id
}

output "cognito_user_pool_arn" {
  value = aws_cognito_user_pool.todone.arn
}

output "jwt_issuer" {
  value = "https://cognito-idp.us-east-1.amazonaws.com/${aws_cognito_user_pool.todone.id}"
}

output "jwt_audience" {
  value = module.auth.client_id
}

output "pwa_client_id" {
  value = module.auth.client_id
}

output "registration_client_id" {
  value = module.registration_auth.client_id
}

output "pwa_session_config" {
  value = module.auth.session_config
}

output "api_base_url" {
  value = module.api.api_endpoint
}

output "api_jwt_authorizer_id" {
  value = module.api.jwt_authorizer_id
}

output "static_site_url" {
  value = module.frontend.cloudfront_url
}

output "static_distribution_id" {
  value = module.frontend.cloudfront_distribution_id
}

output "static_bucket_name" {
  value = module.frontend.s3_bucket_name
}

output "dynamodb_table_name" {
  value = module.table.table_name
}

output "dynamodb_table_arn" {
  value = module.table.table_arn
}

output "dynamodb_pitr_enabled" {
  value = module.table.point_in_time_recovery_enabled
}

output "dynamodb_index_names" {
  value = module.table.global_secondary_index_names
}

output "lambda_function_names" {
  value = merge(
    { for name, lambda in module.lambdas : name => lambda.function_name },
    { "create-child" = module.create_child_lambda.function_name },
    { "reset-child-password" = module.reset_child_password_lambda.function_name },
    { for name, lambda in module.parent_account_lambdas : name => lambda.function_name },
  )
}

# Backward-compatible foundation outputs retained for release tooling that
# still addresses the session Lambda directly.
output "lambda_function_name" {
  value = module.lambdas["session"].function_name
}

output "lambda_function_arns" {
  value = merge(
    { for name, lambda in module.lambdas : name => lambda.function_arn },
    { "create-child" = module.create_child_lambda.function_arn },
    { "reset-child-password" = module.reset_child_password_lambda.function_arn },
    { for name, lambda in module.parent_account_lambdas : name => lambda.function_arn },
  )
}

output "lambda_function_arn" {
  value = module.lambdas["session"].function_arn
}

output "lambda_qualified_arns" {
  value = merge(
    { for name, lambda in module.lambdas : name => lambda.qualified_arn },
    { "create-child" = module.create_child_lambda.qualified_arn },
    { "reset-child-password" = module.reset_child_password_lambda.qualified_arn },
    { for name, lambda in module.parent_account_lambdas : name => lambda.qualified_arn },
  )
}

output "lambda_qualified_arn" {
  value = module.lambdas["session"].qualified_arn
}

output "lambda_versions" {
  value = merge(
    { for name, lambda in module.lambdas : name => lambda.version },
    { "create-child" = module.create_child_lambda.version },
    { "reset-child-password" = module.reset_child_password_lambda.version },
    { for name, lambda in module.parent_account_lambdas : name => lambda.version },
  )
}

output "lambda_version" {
  value = module.lambdas["session"].version
}

output "runtime_role_arn" {
  value = aws_iam_role.lambda_role.arn
}

output "family_account_admin_role_arn" {
  value = aws_iam_role.family_account_admin_role.arn
}

output "log_group_names" {
  value = concat(
    [for lambda in values(module.lambdas) : lambda.log_group_name],
    [module.create_child_lambda.log_group_name],
    [module.reset_child_password_lambda.log_group_name],
    [for lambda in values(module.parent_account_lambdas) : lambda.log_group_name],
    [module.api.access_log_group_name],
  )
}

output "pre_signup_log_group_name" {
  value = module.pre_signup_lambda.log_group_name
}

output "api_log_group_name" {
  value = module.api.access_log_group_name
}
