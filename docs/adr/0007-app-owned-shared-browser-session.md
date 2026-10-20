# ADR 0007: App-Owned Shared Browser Session

- Status: Proposed; implementation tracked by `rearchitect-session-management`
- Date: 2026-10-19

## Context

Router guards, bootstrap pages, and the temporary route handoff currently split session ownership. Tab-scoped Cognito credentials require separate sign-in in new tabs. The browser-session-management change specifies one current browser account, persistent return visits, quiet renewal, and navigation without repeated authentication prerequisites.

## Decision

Create one injected session controller at the app composition root. It owns initialization, identity and membership/profile context, renewal, invalidation, and sign-out. Routes read ready context; pages own feature data and editable drafts. Share pending initialization, renewal, and context-refresh operations within the controller. Generation checks discard results from interrupted or replaced identities.

Use a versioned, narrowly scoped localStorage adapter for Cognito credentials and SDK-required account-locator metadata, plus non-sensitive coordination metadata. This explicitly replaces the current sessionStorage-only policy when the complete lifecycle implementation ships. One origin and browser profile has one current account across tabs and browser restarts. Other origins, profiles, and private contexts remain isolated. Persistence lasts only while provider credentials remain renewable, ending on explicit sign-out or browser storage removal; no Cognito lifetime is extended. No remember-me control or independent per-tab accounts are introduced.

Membership, profiles, household data, API results, and drafts remain memory-only. Passwords, Entry Codes, confirmation/recovery codes, and request bodies never persist. Credentials never enter URLs/history, logs, analytics, coordination messages, IndexedDB, or service-worker caches. Persistent browser credentials are JavaScript/XSS-readable and have longer exposure than tab-scoped storage. Keep CSP, escaped rendering, dependency controls, no unsafe HTML, and protected-response `no-store` controls. This storage is not a secure vault.

Bind SDK writes to the operation's captured credential namespace. An opaque active-generation marker selects the readable namespace. Publish a successful sign-in only after credentials are ready. BroadcastChannel and storage-event fallback request reconciliation against current storage and normal APIs; events never supply identity or grants. Suspended documents reconcile before private presentation on resume. Verify provider rotation semantics before implementing renewal and test any necessary cross-tab exclusion without changing provider configuration.

Sign-out immediately invalidates pending local work and clears private UI, drafts, and request results. Its shared cleanup asynchronously publishes a signed-out generation/tombstone before removing owned credentials. Local signed-out presentation does not imply that shared publication has already completed. SDK cleanup exceptions cannot prevent local cleanup or sign-out propagation. Retain non-sensitive tombstone metadata to prevent late writes from becoming current. Preserve unrelated storage and a peer's newly published credentials. Storage denial/corruption is an explicit recoverable error with Retry and Sign out, never an independent per-tab fallback. If storage itself is unavailable, clear local private state and report the propagation failure rather than claiming peer cleanup succeeded.

This is browser-local sign-out, not provider revocation on other devices. No server sign-out endpoint, cookie/BFF, server session database, new dependency, infrastructure mutation, or deployment is part of this decision. ADRs 0002 and 0004 continue governing stable identity and per-request server authorization.

## Renewal and authorization

Acquire credentials at API-send time. Use a named 60-second expiry margin, coalesce renewal, and reconcile elapsed time after sleep. Terminal provider invalidity ends the session; connectivity, timeouts, and throttling remain recoverable. A safe read can renew and retry at most once after authentication rejection. Never blindly replay a sent mutation; retain its endpoint's idempotency or uncertain-result contract. Target-specific denial does not end an otherwise valid account.

Refresh memory-only context on a named five-minute foreground freshness interval, stale foreground return, confirmed relevant mutations, and authoritative access denial. Navigation itself causes no auth reads. Preserve permitted content, safe drafts, and focus during transient background failure. Pending, inactive, inconsistent, credential-stale, unattached, and profile-required outcomes remain distinct. Server JWT, membership, role, tenant, and credential-cutoff enforcement remains authoritative on every protected request.

## Migration and rollback

On upgrade, remove only this app client's owned legacy sessionStorage credentials. Never copy them into shared storage or select among conflicting legacy tab accounts. Require one explicit sign-in unless valid new-format shared credentials already exist. Explain the transition once. Old-build tabs require reload before the shared-account guarantee applies.

Release and rollback remain manual. A compatible rollback build must remove the implemented version's credential namespaces and coordination marker, clear private memory, and require fresh sign-in before returning to tab-scoped behavior. Reverting directly to the old bundle leaves persistent credentials behind and is insufficient cleanup. Preserve unrelated origin keys. No application-data migration or Cognito pool/client replacement is required.

## Consequences and verification

The trade-off is longer-lived XSS-readable credentials and a shared-device account boundary in exchange for seamless same-browser return visits. A cookie/BFF alternative adds backend sessions, CSRF, infrastructure, and operations beyond this change.

Required evidence includes controller/storage race tests, cross-document and persistent-context browser tests, secret-leak and server-negative coverage, local-emulator parity evidence, accessibility/visual review, and aggregate verification. The session-state reference requires owner review before final UI implementation. This ADR does not imply implementation completion or production readiness.
