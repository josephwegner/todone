# Browser Session Management

## Purpose

Provide a consistent browser-account session across Todone pages, tabs, and return visits while preserving responsive navigation, explicit session-loss recovery, and server-owned authorization.

## ADDED Requirements

### Requirement: Stable Session Across Pages
A running application SHALL initialize its session once and reuse the resulting session context across page navigation. Navigation with ready, fresh session context SHALL cause zero additional credential-restoration, membership, or self-profile requests solely because the route changes. It SHALL NOT show a restoration screen, reset private forms, or interrupt the destination's normal heading focus.

#### Scenario: Parent navigates with ready context
- **GIVEN** an active parent has fresh membership/profile context and usable credentials
- **WHEN** the parent follows Family and My profile links or uses Back and Forward
- **THEN** no session prerequisite request is triggered by navigation, no restoration screen appears, and the destination heading receives focus

#### Scenario: Child navigates with ready context
- **GIVEN** an active child is on `/todos` with fresh session context
- **WHEN** the child opens My profile and returns to Todos
- **THEN** navigation preserves the child route restrictions without another initialization, restoration announcement, or fabricated Todo action

#### Scenario: Multiple consumers initialize together
- **GIVEN** startup and a protected deep link need the same unresolved session
- **WHEN** both request initialization
- **THEN** they share one initialization operation rather than issuing duplicate credential, membership, or profile requests

### Requirement: Persistent Shared Browser Account
Sign-in SHALL apply to one current account across same-origin tabs in the same browser profile and survive reload, new tabs, and browser restarts while renewable credentials remain valid. Independent per-tab accounts SHALL NOT be supported. No credential lifetime SHALL be extended beyond the identity provider's configured policy.

#### Scenario: Returning user opens a new tab or browser
- **GIVEN** a browser account has a valid renewable session
- **WHEN** a user opens Todone in another tab or reopens the browser
- **THEN** that account is restored without password entry and is routed by its current onboarding and membership state

#### Scenario: Shared session is no longer renewable
- **GIVEN** saved credentials have expired or been invalidated definitively
- **WHEN** Todone starts or requests renewal
- **THEN** private state is cleared and an accessible sign-in experience explains that the session ended without exposing credentials

### Requirement: Silent Credential Renewal
Credential renewal SHALL run without replacing the current page, moving focus, clearing forms, or announcing routine authentication activity. Concurrent callers within a running application SHALL share one renewal. Requests SHALL NOT be sent with known expired credentials. Failed renewal SHALL distinguish recoverable connectivity/service failure from a definitive session-ended result.

#### Scenario: Token expiry during normal use
- **GIVEN** a valid refresh credential and several pending API reads
- **WHEN** a token needs renewal
- **THEN** renewal is shared, reads use the renewed token, and the page retains focus and form values without a full-page authentication state

#### Scenario: Renewal is temporarily unreachable
- **GIVEN** the identity provider cannot be reached and token renewal is required
- **WHEN** a user attempts a protected action
- **THEN** no expired-token write is sent, safe non-secret input remains in memory, and visible retry guidance appears without claiming the user signed out

#### Scenario: An interrupted mutation has an uncertain result
- **GIVEN** a write was already sent before an authentication or network failure was observed
- **WHEN** credentials become usable again
- **THEN** the write is not automatically replayed unless its existing endpoint contract explicitly permits that replay with the original idempotency key

### Requirement: Cross-Tab Identity and Sign-Out Consistency
Sign-out SHALL immediately clear the initiating application's credentials and private state despite SDK cleanup errors. Active peer tabs SHALL clear on the invalidation event; suspended tabs SHALL reconcile before displaying private content on resume. An account change SHALL clear the previous account's private state before adopting the current account. Older asynchronous work SHALL NOT resurrect a signed-out or replaced session.

#### Scenario: Child signs out in one tab
- **GIVEN** two tabs display the same child's account
- **WHEN** the child activates Sign out in one tab
- **THEN** both tabs reach sign-in and clear private forms, profile presentation, and session context; protected Back/reload requires authentication

#### Scenario: Sign-out races with renewal
- **GIVEN** a renewal or membership request is still pending
- **WHEN** sign-out occurs and the earlier work later succeeds
- **THEN** neither memory nor persistent storage makes that old session current again, including in another tab

#### Scenario: Another account signs in
- **GIVEN** a peer tab retains private content from a previous account
- **WHEN** another tab completes sign-in as a different account
- **THEN** the peer clears the previous account's content and unsaved private input before resolving and displaying the new account

#### Scenario: Coordination event is untrusted
- **GIVEN** an event announces a browser-session change
- **WHEN** a tab receives it
- **THEN** it obtains authoritative credentials/context through the normal session flow rather than accepting an event's identity, role, or grants

### Requirement: Private Persistence Boundary
Only narrowly scoped authentication material and non-sensitive coordination metadata SHALL persist in the browser's shared auth storage. Passwords, Entry Codes, confirmation/recovery codes, household/profile records, and unsaved private forms SHALL NOT persist there. Credentials SHALL NOT enter URLs, history, logs, analytics, cross-tab messages, IndexedDB, or service-worker caches.

#### Scenario: Storage is denied or corrupt
- **GIVEN** shared authentication storage is unavailable or malformed
- **WHEN** initialization or sign-in accesses it
- **THEN** the app exposes a recoverable storage/sign-in error without leaking values, using corrupt credentials, or silently creating an independent per-tab account

#### Scenario: Sign-out clears only owned credentials
- **GIVEN** unrelated same-origin storage keys exist alongside Todone auth keys
- **WHEN** a user signs out
- **THEN** Todone auth state is cleared without deleting unrelated storage, and a non-sensitive sign-out marker prevents late credential writes from becoming current

### Requirement: Context Freshness Without Navigation Authentication
Membership and profile context SHALL remain memory-only and refresh on bounded freshness, foreground return, relevant successful mutations, or authoritative API denial. Background refresh SHALL preserve usable page content and focus while pending. Context SHALL never be treated as server authorization. Missing, pending, inactive, inconsistent, and credential-stale membership SHALL remain distinct outcomes.

#### Scenario: Initial context cannot be loaded
- **GIVEN** usable credentials exist but the first membership/profile read fails transiently
- **WHEN** the protected app initializes
- **THEN** a stable accessible loading/error region provides retry without guessing a role, presenting another household, or forcing password entry

#### Scenario: Onboarding advances
- **GIVEN** a user is unattached or lacks a profile
- **WHEN** household or profile creation succeeds
- **THEN** session context updates from the confirmed result and selects the correct next route without restarting authentication

#### Scenario: Access is revoked after context was cached
- **GIVEN** a page retains an earlier active-member context
- **WHEN** a protected API rejects removed membership or stale credentials
- **THEN** the client follows the authoritative denial, clears inaccessible content, and does not retry with guessed ownership or replay a mutation

#### Scenario: A target-specific action is forbidden
- **GIVEN** the current browser account still has valid household access
- **WHEN** one resource operation is denied
- **THEN** that operation shows its safe domain error without incorrectly signing out the entire browser account

### Requirement: Server-Owned Household Authorization
Every protected API request SHALL retain verified-token, active-membership, tenant-isolation, role, and credential-cutoff enforcement. Client context, persisted credentials, and cross-tab signals SHALL NOT grant access or bypass those checks. Protected API responses SHALL remain non-cacheable.

#### Scenario: Client state is manipulated
- **GIVEN** a child or another household's caller changes browser context to claim parent access
- **WHEN** a protected operation is requested
- **THEN** the server denies it before private disclosure or side effects using its existing authorization boundary

### Requirement: Accessible Session Feedback
Only unresolved application startup, identity replacement, or an actual blocking session failure SHALL use a session-level loading/error surface. Routine renewal SHALL remain silent. Errors and retry/sign-out controls SHALL be labelled, keyboard operable, and announced without exposing secrets. Confirmed session loss SHALL focus the signed-out heading.

#### Scenario: Startup retry and cancellation
- **GIVEN** initial session resolution fails recoverably
- **WHEN** the user retries or chooses Sign out
- **THEN** retry avoids duplicate submissions and sign-out cancels outstanding work, clears private state, and moves focus to sign-in

#### Scenario: Reduced motion or enlarged text
- **GIVEN** reduced motion, a 320px viewport, or actual 200% browser zoom
- **WHEN** session feedback is shown
- **THEN** text and controls remain readable without clipping, state does not rely on color/motion, and background work does not steal focus

### Requirement: Explicit Legacy Session Migration
The new session policy SHALL NOT silently promote independent legacy tab sessions into a shared browser account. The first upgraded visit SHALL clear owned legacy credentials and require one explicit sign-in unless a valid new-format shared session already exists. This rollout transition SHALL be explained once and SHALL NOT recur on ordinary navigation.

#### Scenario: Legacy tabs contain different accounts
- **GIVEN** legacy tabs retain different tab-scoped accounts
- **WHEN** the upgraded app starts
- **THEN** it does not pick an account from those tabs or merge their private state; after explicit sign-in, upgraded tabs follow the shared account
