# deployable-pwa-foundation Specification

## Purpose
Establish the responsive Todone PWA, username-based Cognito authentication, protected API, recoverable dedicated data store, privacy-safe operations, and reviewed production deployment boundary.
## Requirements
### Requirement: Username-Based Authentication Foundation
The platform SHALL provide a Cognito user pool that accepts case-insensitive username and password sign-in. Usernames SHALL be immutable and globally unique across the Todone user pool. Email and phone SHALL remain optional pool attributes, while later parent-account requirements MAY require verified email for parent recovery. The application SHALL use the Cognito `sub` claim as the stable user identity and SHALL NOT use username or display name as an ownership key.

#### Scenario: User signs in with no email attribute
- **WHEN** an account has only a username and password
- **THEN** the account can authenticate and receive a valid application session

#### Scenario: Identity is exposed to the protected API
- **WHEN** an authenticated user calls the current-session endpoint
- **THEN** the endpoint returns only `sub`, `username`, and `expiresAt`

#### Scenario: Duplicate username is rejected
- **WHEN** account creation requests a case-insensitive username already present in the user pool
- **THEN** Cognito rejects the duplicate and no second identity is created

### Requirement: Temporary Authentication Probe
The foundation SHALL provide a minimal, intentionally temporary username/password sign-in form only to prove the end-to-end authentication boundary. The form SHALL expose loading, invalid-credential, network-error, retry, and signed-in states and SHALL be keyboard and screen-reader operable. The household-bootstrap change SHALL replace and remove this probe rather than maintain two sign-in flows.

#### Scenario: Temporary form authenticates test account
- **WHEN** a verification account submits valid credentials through the temporary form
- **THEN** the form establishes a session and calls the protected current-session endpoint

#### Scenario: Temporary form reports invalid credentials
- **WHEN** the verification account submits invalid credentials
- **THEN** the form remains signed out and presents an accessible retryable error without exposing credential details

### Requirement: Protected API Boundary
The API SHALL reject requests without a valid JWT before application handlers execute. The frontend SHALL send its Cognito ID token only to configured API requests and SHALL NOT cache protected API responses in the service worker.

#### Scenario: Missing token
- **WHEN** a caller requests the protected endpoint without a token
- **THEN** the API responds with an authentication failure and no session data

### Requirement: Recoverable Dedicated Data Store
Todone SHALL use a dedicated on-demand DynamoDB table with point-in-time recovery enabled. The runtime role SHALL have access only to the Todone table and explicitly required Cognito administration actions.

#### Scenario: Infrastructure inspection
- **WHEN** the deployed data store is inspected
- **THEN** it is separate from shared application data and has point-in-time recovery enabled

### Requirement: Accessible Responsive Application Shell
The PWA SHALL render a responsive application shell at compact viewports below 768 CSS pixels, medium viewports from 768 through 1023 CSS pixels, and wide viewports at or above 1024 CSS pixels. Representative verification viewports SHALL include iPhone, iPad, and laptop sizes. Interactive controls SHALL be keyboard operable, visibly focused, labelled for screen readers, and usable at 200 percent browser zoom. The shell SHALL honor reduced-motion preferences.

#### Scenario: Keyboard navigation
- **WHEN** a keyboard-only user navigates the shell
- **THEN** focus order is logical and every interactive control has a visible focus indication

### Requirement: Observable and Safe Operations
The deployment SHALL produce structured logs and CloudWatch metrics for API error count, API latency, and authorization denials without emitting credentials, JWTs, names, Todo titles, or other private family data. The project SHALL document deploy, rollback, backup, and restore responsibilities.

#### Scenario: Protected endpoint failure
- **WHEN** a protected endpoint fails unexpectedly
- **THEN** logs contain a request identifier, route, and outcome without private request content

### Requirement: Production Deployment Verification
The foundation SHALL target one production environment with no staging environment. Completion SHALL require a human-authorized deployment followed by a recorded smoke test that signs in through the deployed PWA and calls the live protected endpoint.

#### Scenario: Live smoke test succeeds
- **WHEN** an authorized human deploys the reviewed infrastructure and application
- **THEN** the production URL can authenticate the verification account and the live protected endpoint returns the expected current-session contract

