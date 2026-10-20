# Proposal

## Why

Parents and children should move between Todone pages without seeing repeated session restoration or waiting for redundant authentication requests. Session ownership is currently split between router guards, bootstrap pages, and a temporary route handoff; tab-scoped credentials also require separate sign-in in new tabs, contrary to the owner's desired shared-browser experience.

## What Changes

- Introduce one app-level session controller per running app, shared by routes, pages, and authenticated requests. Initialize once, renew credentials silently, and resolve membership/profile independently from page navigation.
- Make ready-state navigation require zero additional Cognito, current-membership, or self-profile requests solely because the route changes. Keep page-specific fetching and actual authorization failures explicit.
- **BREAKING:** Replace the current-tab-only session contract with persistent same-origin browser sign-in shared across tabs and browser restarts, bounded by Cognito refresh validity and explicit sign-out.
- Synchronize sign-out and account changes across tabs; clear private views and ignore stale asynchronous results. Do not broadcast credentials or private household data.
- Preserve server-side tenant/role/credential-cutoff enforcement, canonical routes, onboarding, accessible feedback, and fail-safe local sign-out.
- Retire component-owned session restoration, duplicated auth clients, and the temporary route-to-page handoff after consumers migrate.
- Extend only the verified caller's current-membership response with distinct pending, inactive, and inconsistent outcome codes so the controller preserves the server's typed lifecycle outcomes. No household, target, or stored identity details accompany a denial. The owner explicitly chose API outcome disclosure over retaining the generic pending/inactive response on 2026-10-19.

### Scope and non-goals

Covers startup, sign-in, silent renewal, ready navigation, onboarding transitions, persistent storage, cross-tab invalidation, recoverable failures, and sign-out. No account switcher, remember-me toggle, offline write queue, server session database, cookie/BFF migration, new remote logout endpoint, Cognito pool replacement, or production deployment.

### Acceptance and assumptions

One startup initialization and one renewal/context-refresh operation at a time per controller; fresh ready-state navigation makes zero session prerequisite requests and never shows a restoration screen or loses unsaved form input. A new tab and reopened browser can restore the current browser account without passwords while renewal remains valid. Sign-out clears the initiating tab immediately; active peer tabs clear on the invalidation event, and suspended tabs reconcile before showing private content on resume.

Persistent sign-in across browser restarts is the proposed default, without extending configured Cognito lifetimes. Storage denial must produce an explicit recoverable state, not silently revert to independent per-tab accounts. These choices are reviewable in this proposal; no implementation or existing security policy changes occur yet.

## Capabilities

### New Capabilities

- `browser-session-management`: Shared-browser session lifecycle, seamless navigation, background renewal, cross-tab coordination, and private-state cleanup.

### Modified Capabilities

- `household-membership`: Replace current-tab restoration and sessionStorage-only restrictions in Username Session Lifecycle with the shared-browser contract; preserve identity, registration, onboarding, and server authorization semantics.

## Impact

Affects `src/main.ts`, router guards, `AuthClient`, authenticated-request helpers, bootstrap/Todo pages, app presentation context, and the temporary route handoff. Update security/system-context/testing documentation and add a session-lifecycle ADR during implementation. No new dependency or infrastructure change is expected; existing Cognito and API contracts remain authoritative.

Persistent browser credentials increase their residence time and remain XSS-readable: narrowly scope auth storage, retain CSP/no-unsafe-HTML controls, keep private application data memory-only, and preserve no-store responses. Accessible startup, renewal-error, signed-out, and session-ended states require visual/keyboard/screen-reader review; routine renewal must not announce or move focus.

Depends on the delivered membership/profile APIs and existing Cognito refresh configuration. `centralize-authorization-capabilities` may later add advisory capability data to the same controller context without becoming a prerequisite. Coordinate with the active visual-foundation change: its one-use handoff/current-navigation checks are transitional and will be superseded, not installed alongside a second controller.

This is one change because credential storage, lifecycle ownership, request renewal, and cross-tab invalidation must agree on identity and sign-out. Tasks deliver independently verified slices behind that single contract.
