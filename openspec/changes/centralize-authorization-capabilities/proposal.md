## Why

Todone currently derives authorization independently in handlers, repositories, response projections, and UI state from combinations of Membership role, activation state, ownership, household scope, and resource lifecycle. As family-account behavior grows, these conditionals are becoming difficult to audit and easy to make inconsistent: the server may authorize an operation differently from the client affordance that represents it, and each new feature must rediscover the same principal-state rules.

The desired outcome is one server-authoritative capability policy that gives every role and Membership state a reviewable contract, produces broad client presentation capabilities, and evaluates contextual resource actions without turning capability strings into authorization tokens.

## What Changes

- Add a stable, namespaced authorization-capability vocabulary and central registry for currently delivered household, profile, and family-account operations.
- Derive capabilities from trusted server state. Capability grants are not persisted on Membership and cannot be supplied by clients.
- Resolve one authenticated principal model from verified Cognito identity plus Membership state, then evaluate all protected operations through one policy boundary.
- Return broad principal capabilities to the client for navigation and global affordances, and return contextual `allowedActions` on target/resource representations.
- Require every server mutation to re-evaluate capability, household/ownership scope, target type, and resource lifecycle before reads with disclosure risk or writes with side effects.
- Migrate existing household bootstrap, Membership, profile, and family-directory/family-account authorization to the shared policy.
- Update the authorization matrix, API conventions, threat model, testing strategy, project instructions, and active/future OpenSpec changes so new operations extend the registry and policy tests rather than adding feature-local role/state checks.

## Scope

This change defines the application-wide authorization structure and migrates behavior that exists when the change is implemented. It establishes extension requirements for Todo, label, recurrence, and later capabilities, but it does not implement those product features early.

## Non-Goals

- Persisted, user-editable, or administrator-configurable permission grants.
- Custom household roles, parent demotion, parent removal, or role mutation.
- Treating client-returned capabilities or `allowedActions` as proof of authorization.
- Replacing Cognito authentication, API Gateway JWT validation, IAM, tenant-scoped repository queries, or resource lifecycle validation.
- A general-purpose policy language, external authorization service, or new dependency.

## Capabilities

### New Capabilities

- `capability-authorization`: Derived server-side authorization policy and client presentation contracts.

### Modified Capabilities

- `household-membership`: Membership role/state authorization moves behind the shared principal and capability policy.
- `family-account-management`: Profile, directory, pending-parent, and child-management affordances use shared capability keys and contextual decisions.

## Assumptions and Decisions

- Cognito authentication and the server-resolved Membership remain the trusted identity inputs.
- Capability grants are computed per request or from an equivalently short-lived request-local principal; they are never persisted as independent authority.
- The client receives a broad additive capability list for application composition and resource-specific `allowedActions` for contextual controls.
- The server ignores any capability or allowed-action value sent by a client and independently decides every protected operation.
- Stable capability keys may be added compatibly, but renaming or changing the meaning of an existing key requires an explicit contract migration.

## Success Criteria

- One registry defines every currently delivered protected operation, its stable key, eligible principal states, and required context.
- Existing protected handlers contain no feature-local parent/child or activation-state authorization branches outside the shared policy and principal-resolution boundary.
- The current-member/session application contract exposes only the capabilities available to that principal and never exposes internal denial reasons.
- Contextual representations expose only actions that the same policy would authorize for the caller and target at that moment.
- Table-driven and integration tests cover every role/state combination, self/peer/child targets, inactive/pending principals, cross-household identifiers, stale credentials, and denial before side effects.
- Active OpenSpec changes and project instructions require future operations to register capability keys, define context, update the authorization matrix, and add policy/security-negative tests.

## Impact

- Security improves through a single fail-closed policy surface, consistent client/server contracts, and auditable capability coverage.
- Privacy remains enforced by tenant-scoped queries and response projection; a capability does not grant access to arbitrary identifiers.
- Client capability fields are additive and presentation-only, so older clients may ignore them during migration.
- No data migration, new managed service, or recurring infrastructure cost is required.
- The change belongs together because policy vocabulary, server enforcement, client representation, migration, and future extension rules must agree atomically; splitting them would preserve the inconsistent intermediate state this change is intended to remove.

## Approved completed-retry contract

Completed retries remain successful after household attachment or target deletion. The central
policy explicitly authorizes replay from a server-owned, caller-bound completed receipt matching
the operation, target and payload. Replay returns only a recorded result; it never authorizes a
new mutation or repeats external calls. Missing-target mutations continue to fail closed.
