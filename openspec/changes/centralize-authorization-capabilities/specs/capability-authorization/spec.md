## ADDED Requirements

### Requirement: Derived Authorization Principal
The application SHALL resolve a typed authorization principal from verified authentication claims and current server-owned Membership data. Authorization capabilities SHALL be derived from that principal and trusted resource context and SHALL NOT be persisted as independent grants or accepted from a client as authority. Pending, inactive, inconsistent, and credential-invalid Memberships SHALL fail closed for protected household operations.

#### Scenario: Active parent principal is resolved
- **GIVEN** a valid Cognito identity with a consistent active parent Membership
- **WHEN** the caller accesses a protected household operation
- **THEN** the server resolves an active-parent principal with the server-owned household/member scope used for authorization

#### Scenario: Client submits a claimed capability
- **GIVEN** a client that includes a capability or allowed-action value in a request
- **WHEN** the server authorizes the operation
- **THEN** the claimed value is ignored and authorization is derived independently from trusted current state

#### Scenario: Membership is no longer active
- **GIVEN** a cryptographically valid token whose Membership is pending, inactive, removed, inconsistent, or invalid under the credential cutoff
- **WHEN** it calls a protected household operation
- **THEN** the operation is denied before protected data or a side effect is reached

### Requirement: Stable Capability Registry
The application SHALL define each authorization capability once in a typed, namespaced registry. Every registered capability SHALL identify whether it is principal-wide or requires contextual target/resource evaluation. Unknown capabilities and contextual capabilities without required trusted context SHALL fail closed. Feature code SHALL NOT create parallel role/state-to-action mappings or raw action strings.

#### Scenario: Registered capability is evaluated
- **GIVEN** a registered capability and the required trusted context
- **WHEN** the central policy evaluates it
- **THEN** it returns a deterministic allow or deny decision without performing a write or external administration call

#### Scenario: Capability context is missing
- **GIVEN** a target-specific capability without its required target, ownership, or lifecycle context
- **WHEN** the policy evaluates it
- **THEN** the decision is deny and the policy does not fall back to a broad role check

#### Scenario: New feature adds an operation
- **GIVEN** a future OpenSpec change that adds a protected operation
- **WHEN** that change is reviewed for implementation
- **THEN** it defines a stable registry key, eligible principals, required context/scope, client presentation contract, authorization-matrix entry, and security-negative tests before completion

### Requirement: Contextual Server Enforcement
Every protected operation SHALL be authorized by the central policy before any disclosure-risk read, write, or Cognito administration. A capability SHALL NOT replace household scoping, self/target relationship checks, target role/state validation, resource lifecycle validation, optimistic concurrency, or IAM. Cross-household and hidden targets SHALL retain the same safe non-disclosure behavior as absence.

#### Scenario: Parent manages a same-household child
- **GIVEN** an active parent and an active child in the same household
- **WHEN** the parent requests a registered child-management operation allowed for that target
- **THEN** the policy allows the contextual action before the scoped side effect executes

#### Scenario: Parent targets another parent
- **GIVEN** an active parent target in the caller's household
- **WHEN** the caller requests a child-only password reset or removal capability
- **THEN** the policy denies before any Cognito or persistence mutation

#### Scenario: Cross-household identifier is supplied
- **GIVEN** a caller with a broad family-management capability
- **WHEN** the request supplies an identifier owned by another household
- **THEN** the policy and scoped repository reveal no target data and perform no side effect

### Requirement: Client Capability Contract
The application SHALL return a sorted, deduplicated list of broad principal capabilities for authenticated application composition. A representation with contextual operations SHALL return a sorted, deduplicated `allowedActions` list using the same registered capability keys and current server policy. These fields SHALL be presentation hints only; the server SHALL re-evaluate every request because principal, target, or lifecycle state may have changed.

#### Scenario: Parent application composition loads
- **GIVEN** an active parent
- **WHEN** the application loads its current-principal contract
- **THEN** it receives the broad capabilities currently available to that parent without receiving private policy inputs or denial reasons

#### Scenario: Pending parent appears in directory
- **GIVEN** an active parent viewing a pending parent in the same household
- **WHEN** the directory representation is built
- **THEN** `allowedActions` contains only the registered resend-welcome, change-email-and-resend, and cancel-pending capability keys authorized for that caller and target

#### Scenario: Child views family directory
- **GIVEN** an active child
- **WHEN** the child reads the safe family directory
- **THEN** the response omits pending-account management affordances and contains no action the policy would deny to that child

#### Scenario: Previously allowed action becomes stale
- **GIVEN** a client representation containing an allowed action
- **WHEN** server state changes before the mutation is submitted
- **THEN** the server uses current policy and safely denies or returns the applicable lifecycle conflict rather than trusting the stale representation

### Requirement: Capability Policy Coverage
The capability registry and central policy SHALL have automated coverage for every registered operation and every supported principal role/state. Endpoint integration tests SHALL continue to prove authorization before side effects, tenant isolation, and safe response projection. Authorization observability SHALL use only stable capability keys and coarse outcomes and SHALL NOT record private identity, household, target, token, credential, or content values.

#### Scenario: Registry coverage test runs
- **WHEN** the policy test suite enumerates the registry
- **THEN** every key has explicit decisions for supported principal states and required contextual cases with no implicit default allow

#### Scenario: Authorization is denied
- **WHEN** a protected operation is denied
- **THEN** metrics may record the capability key and coarse denial category while logs and responses disclose no hidden resource or private principal data

#### Scenario: Existing endpoint is migrated
- **WHEN** a household, profile, directory, or family-account endpoint moves to the central policy
- **THEN** its prior positive and security-negative integration behavior remains covered and feature-local role/state authorization branches are removed

### Requirement: Completed Request Replay
The server SHALL preserve successful completed retries through an explicit central replay decision.
It SHALL require current authenticated principal eligibility and a server-owned completed receipt
bound to the caller, operation, target and matching request payload. A replay decision SHALL only
return the recorded result and SHALL NOT authorize a write or external administration call.
Missing target context SHALL continue to deny a new mutation.

#### Scenario: Household creation is retried after attachment
- **GIVEN** an active parent with a matching completed household-creation receipt
- **WHEN** that caller repeats the same idempotent request
- **THEN** the policy permits returning the original successful result without creating data

#### Scenario: Cancellation or removal is retried after target deletion
- **GIVEN** an active parent and their matching completed cancellation or removal receipt
- **WHEN** the same completed request is retried after deletion
- **THEN** the policy permits returning success without another Cognito or persistence mutation

#### Scenario: Receipt cannot authorize a new mutation
- **GIVEN** a missing, incomplete, foreign or mismatched receipt, or an ineligible current principal
- **WHEN** a replay is requested
- **THEN** no replay result is disclosed and no side effect occurs
