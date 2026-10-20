# Tasks

## 1. Lifecycle Contract and Feedback Review

- [x] 1.1 Record an app-session ADR and update the browser-session threat-model proposal for persistent shared authentication; completion: persistence lifetime, same-origin account scope, XSS exposure, sign-out boundary, and migration/rollback are explicit and match these specs without infrastructure changes.
- [x] 1.2 Map current sign-in/onboarding/session-error states onto the accepted visual foundation and create a standalone session-state reference for any substantial new startup/storage-error/session-ended surface; completion: owner-reviewed anatomy covers Retry, Sign out, background failure, reduced motion, and realistic long content before final UI implementation.

## 2. Controller-Owned Startup and Navigation

- [x] 2.1 Extend the caller-only current-membership API with safe typed pending/inactive/inconsistent codes and introduce an injected app-level controller and provider/clock seams with readonly lifecycle state and shared initialization; completion: API unit/integration tests preserve authorization and no-store disclosure boundaries, unit/component tests prove simultaneous consumers initialize once, typed membership/onboarding outcomes remain distinct, and interrupted initialization cannot publish stale identity.
- [x] 2.2 Move route decisions and page startup to controller context; completion: browser tests count zero session-prerequisite requests solely from ready navigation across parent/child links, Back/Forward, and deep links, with no restoration screen/announcement and correct destination focus. Document controller/feature ownership in system context.
- [x] 2.3 Route sign-in and confirmed household/profile changes through the controller and remove independent bootstrap/Todo auth clients plus the temporary route handoff; completion: component/browser tests preserve registration/recovery, onboarding, profile updates, unsaved safe drafts, secret clearing, and role-appropriate landing with one final lifecycle owner.

## 3. Silent Renewal and Context Freshness

- [x] 3.1 Implement provider renewal with one pending renewal per controller, the named expiry-skew margin, and sleep/resume reconciliation; completion: deterministic tests cover valid/expired credentials, concurrent callers, timeout/throttling versus terminal invalidity, cancellation, and silent focus/form preservation. Document SDK event/response and local-emulator parity contracts.
- [x] 3.2 Integrate credential acquisition and typed auth-failure classification with the shared authenticated-request helper; completion: tests prove no known-expired-token sends, at most one safe-read renewal retry, target-level denial does not sign out a valid account, and uncertain/non-idempotent mutations are not blindly replayed.
- [x] 3.3 Add coalesced five-minute foreground context freshness, stale foreground-return refresh, confirmed-mutation updates, and authoritative-denial handling; completion: fake-clock/component tests prove navigation does not trigger auth reads, transient failures retain permitted content with useful retry, background work does not reset drafts/focus, and removed/stale/inactive identities lose access safely.

## 4. Shared Browser Account and Cross-Tab Privacy

- [x] 4.1 Implement the versioned shared auth-storage adapter and explicit legacy-tab migration; completion: storage tests prove reload/new-tab/reopened-browser restoration, no promotion of conflicting legacy tab accounts, SDK-only credential persistence, scoped cleanup, and safe storage-denied/corrupt outcomes. Update obsolete sessionStorage-only tests to these replacement contracts and document the persistence exception.
- [x] 4.2 Add cross-tab change notification and reconciliation with BroadcastChannel plus storage-event fallback; completion: multi-page tests prove sign-in/sign-out and account replacement converge without credential-bearing messages or mixing old-account content, and suspended pages reconcile before private presentation on resume.
- [x] 4.3 Complete generation-bound credential publication and fail-safe shared sign-out; completion: adversarial storage/controller tests prove old provider writes and pending API results cannot resurrect a session after sign-out or identity replacement, SDK exceptions do not retain private UI, unrelated storage survives, and local request caches/drafts are discarded.
- [x] 4.4 Add browser coverage for simultaneous tabs, duplicate/reordered events, fallback coordination, separate-profile isolation, protected history/reload, and returning persistent contexts; completion: all cases pass against synthetic credentials with sensitive artifacts disabled where appropriate. Record provider rotation/refresh semantics and any tested coordination constraint.

## 5. Security, Accessibility, and Operational Evidence

- [x] 5.1 Preserve and exercise server-negative integration coverage plus client secret-leak checks; completion: wrong issuer/audience, expiry, revoked/credential-stale membership, parent/child and cross-household denials, no-store, idempotency boundaries, and credential-free URLs/history/logs/messages/caches pass without auth bypasses.
- [x] 5.2 Review implemented startup/error/renewal/sign-out states at compact, medium, wide, 320px, and actual 200% browser zoom, including long content, keyboard/screen-reader focus, contrast, and reduced motion; completion: real screenshots and assistive-technology results are recorded, retry/sign-out are accessible, and routine renewal produces no visible authentication state, layout shift, or announcement.
- [x] 5.3 Run the documented emulator setup/startup and real local-auth smoke, including supported renewal and multi-tab paths; completion: commands run as documented before owner testing, unsupported emulator behavior is explicit, and concise signed-out/onboarding/parent/child return-visit journeys state expected results.
- [x] 5.4 Update system context, threat model, user flows, testing strategy, and safe controller diagnostics; completion: documentation no longer promises per-tab sessions, explains cross-tab sign-out and migration/rollback, and diagnostic tests exclude tokens, identity/private values, and raw provider messages without introducing remote telemetry.

## 6. Aggregate Verification and Handoff

- [x] 6.1 Run `npm run verify-local` including format, lint, typecheck, unit, integration, frontend and Lambda builds; completion: required application checks pass, exact results are recorded, and any pre-existing CLI/baseline spec blocker is explicitly separated from new failures without weakening checks.
- [x] 6.2 Run `npm run test:e2e`, `npm run test:a11y`, supported `npm run test:e2e:local-auth`, and strict validation for this change; completion: configured browser projects and accessibility checks pass, new behavior has complete regression evidence, and the final diff contains no unrelated changes.
- [x] 6.3 Reconcile the checklist and prepare a manual release/rollback handoff; completion: completed, remaining, blocked, and intentionally deferred work is explicit, compatible auth-storage cleanup is documented for rollback, and no deployment or production-infrastructure mutation occurred.

## Workflow follow-up

- Archive only after implementation and the project's required review/verification are complete.
- Coordinate archive ordering with visual-design-foundation so its transitional guard-handoff description is superseded by this controller design rather than retained as the target architecture.

## Implementation checkpoint — 2026-10-20

- Completed: 1.1–1.2, 2.1–2.3, 3.1–3.3, 4.1–4.4, 5.1–5.4, and 6.1–6.3 (19/19 tasks after owner review). The owner approved reference anatomy and the caller-only typed membership extension before implementation.
- Final evidence: 324 unit tests, 33 integration tests, 215 full browser cases, 45 accessibility cases, and 2 real-emulator cases passed. Lint, typecheck, frontend/Lambda builds, targeted formatting, strict validation of this change, and tracked diff whitespace checks passed. Actual implementation screenshots at compact, medium, wide, and 320px were visually reviewed.
- Remaining implementation tasks: none. The owner reported performing the requested actual 200% browser zoom and screen-reader checks in Firefox on macOS and accepted the result without reporting issues. This owner-reported evidence completes task 5.2; details are recorded separately from automated checks in `docs/ux/session-state-review.md`.
- Blocked aggregate gates: `npm run verify-local` stops at 12 pre-existing protected skill formatting issues; separate repository-wide strict validation reports seven unrelated baseline spec items. These failures are recorded explicitly, not waived or represented as passing. Task 6.1 records execution and separation of baseline blockers, not an all-green release gate.
- Intentionally deferred: none. No deployment, production infrastructure/provider change, or application-data migration occurred. Existing unrelated workflow and visual-foundation archive edits were preserved.
- Release/rollback handoff: `docs/operations/deployment-rollback.md` documents compatible API/frontend order, provider assumptions, retained artifacts, and scoped shared-auth cleanup before returning to the old frontend. The real local stack is available for owner checks at `http://localhost:3001`.
- Full evidence: `docs/testing/session-management-verification.md`. Implementation, automated verification, and owner manual review are complete. The unrelated repository-wide baseline checks remain recorded release gates; no archive or deployment has been performed.
