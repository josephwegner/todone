# household-membership Specification

## Purpose
Connect authenticated identities to server-authorized households through first-parent registration, verified recovery email, atomic household creation, and privacy-safe session and Membership resolution.
## Requirements
### Requirement: Username Session Lifecycle

The application SHALL replace and remove the foundation's temporary sign-in probe.

#### Scenario: Production session identity storage and feedback

- **WHEN** production session flows are implemented or exercised
- **THEN** It SHALL provide production username/password sign-in, shared-browser session restoration, sign-out, and a first-parent registration flow.
- **AND** Usernames SHALL be immutable, case-insensitive, and globally unique across the user pool, while display names remain separate mutable application profile data.
- **AND** Cognito session persistence, renewal, and cross-tab sign-out SHALL follow the browser-session-management capability; the previous sessionStorage-only restriction is replaced by its narrowly scoped shared-browser auth-storage contract.
- **AND** The flow SHALL display loading, invalid-credential, duplicate-username, invalid-registration-gate, registration-closed, network-failure, retry, and signed-out states without exposing credential values.

#### Scenario: Failed sign-in
- **WHEN** credentials are invalid
- **THEN** the user remains signed out, receives an understandable error, and can retry

#### Scenario: Duplicate username registration
- **WHEN** first-parent registration submits a username that case-insensitively matches an existing username
- **THEN** registration is rejected with an accessible field-level conflict and no duplicate identity is created

#### Scenario: Temporary sign-in is replaced
- **WHEN** the production session flow is delivered
- **THEN** the foundation's temporary sign-in form, verification-account setup, and obsolete tests are removed

#### Scenario: Session is restored in the current tab
- **WHEN** a signed-in user reloads the current tab while the shared browser session remains renewable
- **THEN** the application restores the shared browser account without password entry and resolves its current membership/onboarding state

#### Scenario: User signs out
- **WHEN** a signed-in user signs out
- **THEN** owned authentication storage and private rendered state are cleared, sign-out propagates to other tabs, and the signed-out experience is displayed

### Requirement: Setup-Gated First-Parent Registration

The deployment SHALL accept public first-parent registration only when a Cognito pre-signup trigger hashes the submitted reusable registration gate password and validates it against the configured `REGISTRATION_GATE_PASSWORD_HASH` environment value.

#### Scenario: Registration confirmation and household separation

- **WHEN** public registration is configured or processed, or an account is added to an existing household
- **THEN** A successful signup SHALL create an unconfirmed Cognito identity with no household Membership; email confirmation SHALL activate it for authentication.
- **AND** The gate password SHALL NOT join an existing household and SHALL NOT be logged or stored as user data.
- **AND** Every later account for an existing household SHALL be created by a parent from family management rather than public registration.
- **AND** A missing or empty configured hash SHALL close public registration.

#### Scenario: Valid first registration
- **WHEN** a user submits the valid registration gate password with valid account details
- **THEN** an unattached account is created and may create one new household after login

#### Scenario: Another household already exists
- **WHEN** a different user submits the valid registration gate password after other households exist
- **THEN** another unattached account is created without access to or membership in any existing household

#### Scenario: Public registration cannot join household
- **WHEN** a public registration request includes an existing household identifier or code
- **THEN** the request does not create that Membership and discloses no household data

#### Scenario: Registration is closed
- **WHEN** the pre-signup trigger has no configured registration gate value
- **THEN** every public signup is rejected with a safe registration-closed result and no identity is created

### Requirement: Parent Recovery Email
The first-parent registration flow SHALL require an email address and SHALL use Cognito-assisted confirmation to verify it before sign-in and household onboarding. Cognito SHALL use `verified_email` for self-service account recovery. Every adult/parent account SHALL have a verified recovery email before activation; the later family-management flow SHALL preserve this invariant for additional parents. This requirement SHALL NOT make email mandatory for child accounts.

#### Scenario: Parent verifies recovery email
- **WHEN** the first parent completes the email verification challenge
- **THEN** the account becomes recovery-ready and may continue to household onboarding

#### Scenario: Email confirmation code is invalid or expired
- **WHEN** the first parent submits an invalid or expired Cognito email confirmation code
- **THEN** the account remains unconfirmed, the form presents safe correction guidance, and the parent can request a replacement code

#### Scenario: Parent uses Forgot Password
- **WHEN** the first parent initiates Forgot Password for their username
- **THEN** Cognito sends recovery verification to the parent's verified email and permits a conforming password reset

### Requirement: Mandatory Household Bootstrap
An authenticated user without a membership SHALL be routed to household creation and SHALL NOT access application content until creation succeeds. Successful creation SHALL create a Household and a Membership with immutable `role: parent` atomically from the user perspective. The server SHALL reject household creation by any user who already has a membership, so each self-registered account can create exactly one household.

#### Scenario: First account creates household
- **WHEN** a newly registered user submits valid household details
- **THEN** the user becomes a parent member and enters an onboarding landing that displays the household name and directs the parent to add family members before creating Todos

#### Scenario: Creation fails
- **WHEN** household creation fails
- **THEN** no partially usable household is presented and the user can retry safely

#### Scenario: Existing member attempts second bootstrap
- **WHEN** an authenticated user with an existing membership calls household creation
- **THEN** the server rejects the request and creates no second household

### Requirement: Household Timezone
Each Household SHALL have an IANA timezone selected from a browser-provided default and confirmed by the first parent. The user SHALL be able to choose from supported IANA timezones when the browser does not provide a default. Later date-based behavior SHALL interpret dates in this timezone.

#### Scenario: Invalid timezone
- **WHEN** a user submits an invalid timezone
- **THEN** creation is rejected with field-level validation guidance

#### Scenario: Browser timezone is unavailable
- **WHEN** the browser does not provide a usable timezone
- **THEN** the form requires the parent to select and confirm an IANA timezone before submission

### Requirement: Tenant Isolation
Every household-scoped API operation SHALL derive the caller identity from the verified JWT and SHALL verify Membership server-side. The application SHALL NOT trust a client-supplied household identifier for authorization.

#### Scenario: Cross-household request
- **WHEN** a member submits an identifier belonging to another household
- **THEN** the request is denied without disclosing the other household's data

### Requirement: Accessible Bootstrap Experience
Registration, sign-in, parent recovery, and household creation SHALL be keyboard operable, labelled for screen readers, and provide announced validation and submission outcomes. They SHALL work at compact viewports below 768px, medium viewports from 768 through 1023px, and wide viewports at or above 1024px.

#### Scenario: Screen-reader validation
- **WHEN** a required household name is omitted
- **THEN** focus and an accessible error message identify the field that requires correction

### Requirement: Typed Caller Membership Outcomes
The current-membership API SHALL distinguish the verified caller's pending, inactive, inconsistent, and credential-stale outcomes with stable safe error codes. Denials SHALL disclose no household, target, or stored identity details and SHALL remain non-cacheable. Only unattached identities SHALL receive a successful null membership. Other protected-operation denial contracts SHALL remain unchanged.

#### Scenario: Caller has pending or inactive membership
- **GIVEN** a verified caller resolves to pending or inactive membership
- **WHEN** the caller reads current membership
- **THEN** the response is respectively `403 MEMBERSHIP_PENDING_ACTIVATION` or `403 MEMBERSHIP_INACTIVE`, without household authority or private record fields

#### Scenario: Caller records are inconsistent or credentials are stale
- **GIVEN** a verified caller has inconsistent membership records or a credential-cutoff rejection
- **WHEN** the caller reads current membership
- **THEN** the response is respectively `500 MEMBERSHIP_INCONSISTENT` or `401 SESSION_REAUTHENTICATION_REQUIRED`, with a safe message and request ID, never successful null membership

#### Scenario: Caller outcome is unavailable
- **GIVEN** current membership fails from an unknown service or network failure
- **WHEN** the controller resolves context
- **THEN** it preserves a recoverable failure and does not infer pending, inactive, inconsistent, or unattached membership
