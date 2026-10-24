locals {
  id_token_validity_hours = 1
  app_name                = "todone"
  environment             = "prod"
  lambda_table_actions = [
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:DeleteItem",
    "dynamodb:Query",
    "dynamodb:BatchGetItem",
    "dynamodb:BatchWriteItem",
    "dynamodb:ConditionCheckItem",
    "dynamodb:TransactGetItems",
    "dynamodb:TransactWriteItems",
  ]
  family_account_cognito_actions = [
    "cognito-idp:AdminCreateUser",
    "cognito-idp:AdminGetUser",
    "cognito-idp:AdminDeleteUser",
    "cognito-idp:AdminSetUserPassword",
    "cognito-idp:AdminUpdateUserAttributes",
    "cognito-idp:AdminUserGlobalSignOut",
  ]
  canonical_pwa_origin = one([
    for origin in var.allowed_origins : origin if startswith(origin, "https://")
  ])
}

# Every family-paas module below is pinned to this reviewed commit
# (?ref=beb37ef0e19d896984cb3c16165b2307e38fdf31). Do not float to main; bump the ref deliberately in every
# module block below after re-reviewing the new commit.

data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket = "terraform-state-743837809639"
    key    = "shared/terraform.tfstate"
    region = "us-east-1"
  }
}

resource "aws_cognito_user_pool" "todone" {
  name                     = "${local.app_name}-users-${local.environment}"
  auto_verified_attributes = ["email"]
  deletion_protection      = "ACTIVE"

  lifecycle {
    # Cognito schemas are immutable after creation. The provider may otherwise
    # attempt to reconcile computed schema defaults by removing/recreating a
    # schema block, which Cognito rejects. The reviewed email and
    # browser_write_guard definitions already exist; all non-schema pool
    # settings remain Terraform-managed.
    ignore_changes = [schema]
  }

  username_configuration {
    case_sensitive = false
  }

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = true
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = false
    mutable             = true
  }

  # This intentionally-unused immutable attribute gives the authenticated PWA
  # client a non-empty, non-email write allowlist. Cognito treats an empty
  # allowlist as omission/default permissions. Pool schemas are irreversible.
  schema {
    name                = "browser_write_guard"
    attribute_data_type = "String"
    mutable             = false
    required            = false

    string_attribute_constraints {
      min_length = 1
      max_length = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false

    invite_message_template {
      email_subject = "Set up your Todone parent account"
      email_message = <<-HTML
        <!doctype html>
        <html lang="en">
          <body>
            <h1>Welcome to Todone</h1>
            <p>Your username is <strong>{username}</strong>.</p>
            <p>Your one-time setup code is <strong>{####}</strong>.</p>
            <p><a href="${local.canonical_pwa_origin}/activate-parent">Activate your parent account</a></p>
            <p>Choose a password with at least 8 characters, including an uppercase letter, lowercase letter, number, and symbol.</p>
            <p>After choosing your password, request and enter a separate email-verification code to finish activation. Your one-time setup code is not the email-verification code.</p>
          </body>
        </html>
      HTML
      # The provider includes this field in UpdateUserPool even when email is
      # the only requested delivery medium. Cognito rejects an empty SMS
      # template, so keep this valid but dormant; administration.ts requests
      # EMAIL explicitly and Todone configures no SMS delivery path.
      sms_message = "Todone: {username}; one-time setup code: {####}. ${local.canonical_pwa_origin}/activate-parent"
    }
  }

  # Cognito sends the static invitation through its built-in low-volume sender.
  # Do not configure SES, a custom sender, or a custom-message Lambda.
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Cognito keeps the previously verified recovery address usable until the
  # replacement address completes verification.
  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  lambda_config {
    pre_sign_up = module.pre_signup_lambda.function_arn
  }

  tags = {
    Name        = "Todone users"
    Environment = local.environment
    ManagedBy   = "terraform"
  }
}

module "auth" {
  source = "git::https://github.com/josephwegner/family-paas.git//terraform/modules/cognito-app-client?ref=beb37ef0e19d896984cb3c16165b2307e38fdf31"

  app_name                = local.app_name
  environment             = local.environment
  user_pool_id            = aws_cognito_user_pool.todone.id
  id_token_validity_hours = local.id_token_validity_hours
  write_attributes        = ["custom:browser_write_guard"]
}

# Public, registration-only client. Its only configured authentication flow is
# unusable without custom-auth triggers; do not use it for sessions or APIs.
module "registration_auth" {
  source = "git::https://github.com/josephwegner/family-paas.git//terraform/modules/cognito-app-client?ref=beb37ef0e19d896984cb3c16165b2307e38fdf31"

  app_name                = local.app_name
  environment             = local.environment
  user_pool_id            = aws_cognito_user_pool.todone.id
  client_name             = "todone-registration-prod"
  id_token_validity_hours = local.id_token_validity_hours
  explicit_auth_flows     = ["ALLOW_CUSTOM_AUTH"]
  write_attributes        = ["email"]
}

module "table" {
  source = "./modules/todone-data-table"

  table_name  = "${local.app_name}-data-${local.environment}"
  environment = local.environment
  hash_key    = "pk"
  range_key   = "sk"
  attributes = [
    { name = "pk", type = "S" },
    { name = "sk", type = "S" },
  ]
  # Add global_secondary_indexes only when a delivered capability requires
  # one. See docs/architecture/data-model-and-access-patterns.md for the
  # exact projection contract before adding an index.
}

# Least-privilege runtime role: this repo's Lambda functions may read/write
# only the dedicated Todone table and its indexes, and emit logs. It has no
# access to Terraform state, S3 deployment buckets, CloudFront, IAM
# administration, or any other pool/table.
resource "aws_iam_role" "lambda_role" {
  name = "${local.app_name}-lambda-${local.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Privileged family-account handlers use a separate role from ordinary session,
# Membership, profile, and directory handlers. Future provisioning Lambdas must
# opt into this role only after their application authorization checks are wired.
resource "aws_iam_role" "family_account_admin_role" {
  name = "${local.app_name}-family-account-admin-${local.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "family_account_admin_basic" {
  role       = aws_iam_role.family_account_admin_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "family_account_cognito_admin" {
  name = "${local.app_name}-cognito-family-account-admin-${local.environment}"
  role = aws_iam_role.family_account_admin_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = local.family_account_cognito_actions
      Resource = aws_cognito_user_pool.todone.arn
    }]
  })
}

# Family-account mutations also need the same dedicated application-table boundary as
# ordinary handlers. Keep this policy separate from Cognito administration so review
# can prove that neither permission set reaches an unrelated table or user pool.
resource "aws_iam_role_policy" "family_account_table_access" {
  name = "${local.app_name}-family-account-table-access-${local.environment}"
  role = aws_iam_role.family_account_admin_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = local.lambda_table_actions
      Resource = [
        module.table.table_arn,
        "${module.table.table_arn}/index/*",
      ]
    }]
  })
}

resource "aws_iam_role" "pre_signup_role" {
  name = "${local.app_name}-pre-signup-${local.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "pre_signup_basic" {
  role       = aws_iam_role.pre_signup_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

module "pre_signup_lambda" {
  source = "git::https://github.com/josephwegner/family-paas.git//terraform/modules/lambda-function?ref=beb37ef0e19d896984cb3c16165b2307e38fdf31"

  function_name    = "pre-signup"
  app_name         = local.app_name
  environment      = local.environment
  lambda_role_arn  = aws_iam_role.pre_signup_role.arn
  s3_bucket        = data.terraform_remote_state.shared.outputs.lambda_deployments_bucket
  s3_key           = var.lambda_artifacts["pre-signup"].s3_key
  source_code_hash = var.lambda_artifacts["pre-signup"].source_code_hash

  environment_variables = {
    REGISTRATION_GATE_PASSWORD_HASH = var.registration_gate_password_hash
  }
}

resource "aws_lambda_permission" "cognito_pre_signup" {
  statement_id  = "AllowCognitoPreSignup"
  action        = "lambda:InvokeFunction"
  function_name = module.pre_signup_lambda.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.todone.arn
}

resource "aws_iam_role_policy" "lambda_table_access" {
  name = "${local.app_name}-table-access-${local.environment}"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = local.lambda_table_actions
      Resource = [
        module.table.table_arn,
        "${module.table.table_arn}/index/*",
      ]
    }]
  })
}

module "lambdas" {
  source = "git::https://github.com/josephwegner/family-paas.git//terraform/modules/lambda-function?ref=beb37ef0e19d896984cb3c16165b2307e38fdf31"

  for_each = {
    session            = var.lambda_artifacts["session"]
    current-membership = var.lambda_artifacts["current-membership"]
    create-household   = var.lambda_artifacts["create-household"]
    profile            = var.lambda_artifacts["profile"]
    family-directory   = var.lambda_artifacts["family-directory"]
  }

  function_name    = each.key
  app_name         = local.app_name
  environment      = local.environment
  lambda_role_arn  = aws_iam_role.lambda_role.arn
  s3_bucket        = data.terraform_remote_state.shared.outputs.lambda_deployments_bucket
  s3_key           = each.value.s3_key
  source_code_hash = each.value.source_code_hash

  environment_variables = {
    TODONE_TABLE_NAME    = module.table.table_name
    COGNITO_USER_POOL_ID = aws_cognito_user_pool.todone.id
    COGNITO_CLIENT_ID    = module.auth.client_id
  }
}

# This handler is intentionally separate from ordinary API Lambdas: it is the
# first deployed caller of Cognito's reviewed family-account administration
# permissions, after its own active-parent authorization check.
module "create_child_lambda" {
  source = "git::https://github.com/josephwegner/family-paas.git//terraform/modules/lambda-function?ref=beb37ef0e19d896984cb3c16165b2307e38fdf31"

  function_name    = "create-child"
  app_name         = local.app_name
  environment      = local.environment
  lambda_role_arn  = aws_iam_role.family_account_admin_role.arn
  s3_bucket        = data.terraform_remote_state.shared.outputs.lambda_deployments_bucket
  s3_key           = var.lambda_artifacts["create-child"].s3_key
  source_code_hash = var.lambda_artifacts["create-child"].source_code_hash

  environment_variables = {
    TODONE_TABLE_NAME    = module.table.table_name
    COGNITO_USER_POOL_ID = aws_cognito_user_pool.todone.id
    COGNITO_CLIENT_ID    = module.auth.client_id
  }
}

module "reset_child_password_lambda" {
  source = "git::https://github.com/josephwegner/family-paas.git//terraform/modules/lambda-function?ref=beb37ef0e19d896984cb3c16165b2307e38fdf31"

  function_name    = "reset-child-password"
  app_name         = local.app_name
  environment      = local.environment
  lambda_role_arn  = aws_iam_role.family_account_admin_role.arn
  s3_bucket        = data.terraform_remote_state.shared.outputs.lambda_deployments_bucket
  s3_key           = var.lambda_artifacts["reset-child-password"].s3_key
  source_code_hash = var.lambda_artifacts["reset-child-password"].source_code_hash

  environment_variables = {
    TODONE_TABLE_NAME    = module.table.table_name
    COGNITO_USER_POOL_ID = aws_cognito_user_pool.todone.id
    COGNITO_CLIENT_ID    = module.auth.client_id
  }
}

module "parent_account_lambdas" {
  source           = "git::https://github.com/josephwegner/family-paas.git//terraform/modules/lambda-function?ref=beb37ef0e19d896984cb3c16165b2307e38fdf31"
  for_each         = toset(["create-parent", "activate-parent", "pending-parent-actions", "recovery-email", "remove-child"])
  function_name    = each.key
  app_name         = local.app_name
  environment      = local.environment
  lambda_role_arn  = each.key == "activate-parent" ? aws_iam_role.lambda_role.arn : aws_iam_role.family_account_admin_role.arn
  s3_bucket        = data.terraform_remote_state.shared.outputs.lambda_deployments_bucket
  s3_key           = var.lambda_artifacts[each.key].s3_key
  source_code_hash = var.lambda_artifacts[each.key].source_code_hash
  environment_variables = {
    TODONE_TABLE_NAME    = module.table.table_name
    COGNITO_USER_POOL_ID = aws_cognito_user_pool.todone.id
    COGNITO_CLIENT_ID    = module.auth.client_id
  }
}

module "api" {
  source = "git::https://github.com/josephwegner/family-paas.git//terraform/modules/api-gateway?ref=beb37ef0e19d896984cb3c16165b2307e38fdf31"

  app_name    = local.app_name
  environment = local.environment

  # Must be explicit. Leaving this unset falls back to the module default of
  # ["*"], which fails the Todone CORS/authorization boundary.
  cors_allowed_origins = var.allowed_origins

  auth = {
    issuer   = "https://cognito-idp.us-east-1.amazonaws.com/${aws_cognito_user_pool.todone.id}"
    audience = [module.auth.client_id]
  }

  routes = [
    {
      route_key     = "GET /api/v1/session"
      function_arn  = module.lambdas["session"].invoke_arn
      function_name = module.lambdas["session"].function_name
      auth_required = true
    },
    {
      route_key     = "GET /api/v1/memberships/current"
      function_arn  = module.lambdas["current-membership"].invoke_arn
      function_name = module.lambdas["current-membership"].function_name
      auth_required = true
    },
    {
      route_key     = "POST /api/v1/households"
      function_arn  = module.lambdas["create-household"].invoke_arn
      function_name = module.lambdas["create-household"].function_name
      auth_required = true
    },
    {
      route_key     = "GET /api/v1/profiles/me"
      function_arn  = module.lambdas["profile"].invoke_arn
      function_name = module.lambdas["profile"].function_name
      auth_required = true
    },
    {
      route_key     = "PUT /api/v1/profiles/me"
      function_arn  = module.lambdas["profile"].invoke_arn
      function_name = module.lambdas["profile"].function_name
      auth_required = true
    },
    {
      route_key     = "GET /api/v1/family-members"
      function_arn  = module.lambdas["family-directory"].invoke_arn
      function_name = module.lambdas["family-directory"].function_name
      auth_required = true
    },
    {
      route_key     = "POST /api/v1/family-members/children"
      function_arn  = module.create_child_lambda.invoke_arn
      function_name = module.create_child_lambda.function_name
      auth_required = true
    },
    {
      route_key     = "PUT /api/v1/family-members/{memberId}/password"
      function_arn  = module.reset_child_password_lambda.invoke_arn
      function_name = module.reset_child_password_lambda.function_name
      auth_required = true
    },
    {
      route_key     = "POST /api/v1/family-members/parents"
      function_arn  = module.parent_account_lambdas["create-parent"].invoke_arn
      function_name = module.parent_account_lambdas["create-parent"].function_name
      auth_required = true
    },
    {
      route_key     = "POST /api/v1/parent-activations"
      function_arn  = module.parent_account_lambdas["activate-parent"].invoke_arn
      function_name = module.parent_account_lambdas["activate-parent"].function_name
      auth_required = true
    },
    {
      route_key     = "POST /api/v1/family-members/{memberId}/welcome-email-resends"
      function_arn  = module.parent_account_lambdas["pending-parent-actions"].invoke_arn
      function_name = module.parent_account_lambdas["pending-parent-actions"].function_name
      auth_required = true
    },
    {
      route_key     = "PUT /api/v1/family-members/{memberId}/pending-email"
      function_arn  = module.parent_account_lambdas["pending-parent-actions"].invoke_arn
      function_name = module.parent_account_lambdas["pending-parent-actions"].function_name
      auth_required = true
    },
    {
      route_key     = "DELETE /api/v1/family-members/{memberId}/pending-account"
      function_arn  = module.parent_account_lambdas["pending-parent-actions"].invoke_arn
      function_name = module.parent_account_lambdas["pending-parent-actions"].function_name
      auth_required = true
    },
    {
      route_key     = "GET /api/v1/security/recovery-email"
      function_arn  = module.parent_account_lambdas["recovery-email"].invoke_arn
      function_name = module.parent_account_lambdas["recovery-email"].function_name
      auth_required = true
    },
    {
      route_key     = "PUT /api/v1/security/recovery-email"
      function_arn  = module.parent_account_lambdas["recovery-email"].invoke_arn
      function_name = module.parent_account_lambdas["recovery-email"].function_name
      auth_required = true
    },
    {
      route_key     = "DELETE /api/v1/family-members/{memberId}"
      function_arn  = module.parent_account_lambdas["remove-child"].invoke_arn
      function_name = module.parent_account_lambdas["remove-child"].function_name
      auth_required = true
    },
  ]
}

module "frontend" {
  source = "git::https://github.com/josephwegner/family-paas.git//terraform/modules/frontend-hosting?ref=beb37ef0e19d896984cb3c16165b2307e38fdf31"

  app_name             = local.app_name
  environment          = local.environment
  api_gateway_endpoint = module.api.api_endpoint
  domain_name          = var.production_domain
  acm_certificate_arn  = var.acm_certificate_arn
}
