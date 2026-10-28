# registration-password-clarity Specification

## Purpose
Distinguish the deployment Entry Code from account passwords and provide consistent, accessible account-password guidance across registration, recovery, and family-account flows.
## Requirements
### Requirement: Distinct Entry Code and Account Password

First-parent registration SHALL label the reusable deployment registration gate as "Entry Code" and SHALL distinguish it from the permanent account password in labels, help, validation, and errors. Entry Code failures SHALL remain generic and SHALL NOT reveal, echo, compare, or characterize submitted or configured gate values.

#### Scenario: Entry Code is rejected

- **WHEN** first-parent registration receives an invalid Entry Code response
- **THEN** the Entry Code field receives a generic accessible error and the account-password field is not identified as the cause

### Requirement: Shared Account-Password Guidance

Every flow that selects a new Cognito account password SHALL state before submission that the password requires at least 8 characters with uppercase, lowercase, number, and symbol.

#### Scenario: Shared password flow and rejection guidance

- **WHEN** registration, recovery, child provisioning, or additional-parent setup selects or rejects a password
- **THEN** First-parent registration and Forgot Password SHALL implement the shared guidance in this change; later child and additional-parent password flows SHALL reuse the same contract.
- **AND** When Cognito rejects a password, the UI SHALL associate actionable policy guidance with the password field without exposing the submitted password.

#### Scenario: Registration password fails policy

- **WHEN** Cognito rejects the first parent's proposed account password
- **THEN** the registration form preserves safe context, identifies the account-password field, and announces the complete shared policy

#### Scenario: Recovery password fails policy

- **WHEN** Cognito rejects a replacement password during Forgot Password
- **THEN** the recovery form identifies the new-password field and announces the same complete shared policy

