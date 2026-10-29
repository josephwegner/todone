# ADR 0004: Enforce Household Authorization Server-Side

- Status: Proposed
- Date: 2026-08-05

## Context

Todone contains private data for parents and children. Browser code and identifiers are attacker-controlled, and a valid Cognito token proves identity but not household, role, target ownership, or current membership.

## Decision

Every household-scoped API operation derives `sub` from a verified JWT, resolves an active user-to-household Membership on the server, and authorizes the operation by immutable role, target ownership, and resource state.

The server uses the resolved household ID to build persistence keys. A client-supplied household ID, member ID, Todo ID, label ID, template ID, username, or display name never grants authority. Cross-household resources are treated as absent and are not disclosed. Inactive or removed Membership denies access even if a token remains valid.

Shared principal resolution establishes identity and Membership. Every protected operation names a registered capability and uses the central policy to evaluate its role, state and trusted resource context; feature code does not recreate these decisions. Test helpers MUST NOT bypass these checks.

## Consequences

- UI hiding is convenience only; negative API tests are mandatory.
- Every new endpoint needs an authorization-matrix entry and cross-household tests.
- User-to-household lookup is a security-critical access pattern.
- Parent and child behavior can evolve without changing the authentication identity model.
- Parent-only Cognito administration is performed only after application authorization and with pool-scoped IAM.
- Stale sessions from removed members fail closed.
