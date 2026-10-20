# Session management implementation evidence

Change: `rearchitect-session-management`. No deployment or production-infrastructure mutation is authorized or performed. Unchecked tasks remain required; this document is not a release or archive approval.

## Completed controller and navigation slice

Tasks 1.1, 1.2, and 2.1–2.3 are complete. The owner approved the reference and explicitly chose distinct caller-only membership API outcomes on 2026-10-19. The change artifacts and API conventions record that decision. The app composition root creates one controller/provider and injects the router and Vue consumers. The temporary guard handoff and independent page providers are removed.

Evidence before renewal work: lint/typecheck, 271 unit/component tests, frontend production build, 14 membership integration tests, and build-only Lambda packaging passed. The unit count reflects replacement of the obsolete handoff tests with controller/route/injection coverage, not waived behavior. The full bootstrap browser file passed 80 cases across Chromium compact/medium/wide, Firefox wide, and WebKit wide. Parent and child ready navigation adds zero Cognito/current-membership/self-profile prerequisites; Back/Forward and deep-link initialization retain destination focus. Parent profile input survives ordinary navigation; registration, confirmation, recovery, onboarding, profile/child mutations, and protected sign-out/history/reload remain covered.

A subsequent targeted run passed 15 cases across the same five projects: pending/inactive outcome axe scans and keyboard sign-out, plus cancellation during a pending startup Retry with a late context response. Compact and wide pending-retry screenshots were visually inspected. Retry is disabled while pending and Sign out remains available. Automated checks do not certify screen-reader speech or actual browser zoom.

`npm run verify-local` currently stops at formatting warnings in 12 pre-existing `.agents/skills/*/SKILL.md` files. Those unrelated, read-only files were preserved; separate checks above ran without weakening their assertions. Strict validation of this change passes. Network/process sandbox restrictions on local listeners, browser IPC, and tsx require approved execution outside the sandbox; successful final runs are reported separately from those environment failures.

## Renewal provider contract

The installed `amazon-cognito-identity-js` 6.3.20 source (`CognitoUser.getSession` and `refreshSession`) restores cached sessions, renews expired credentials via `InitiateAuth` with `REFRESH_TOKEN_AUTH`, writes refreshed credentials before invoking its callback, and retains the existing refresh token when the response omits a replacement. The adapter calls explicit renewal near expiry and bounds provider waits to ten seconds. Callback cancellation is not supplied by this SDK; generation checks must discard old results and the shared-storage slice must bind late SDK writes to their captured namespace.

Local setup already enables `ALLOW_REFRESH_TOKEN_AUTH`. The local adapter now retains the emulator refresh credential and calls its real `REFRESH_TOKEN_AUTH` path. Production still uses SRP for initial sign-in; local initial sign-in uses `USER_PASSWORD_AUTH` because the emulator lacks SRP. No app-client lifetime, rotation, or infrastructure setting is changed. Repository SDK/setup inspection establishes this protocol contract; it is not inspection of deployed Cognito configuration. A deployment owner must retain the compatible provider configuration. Cross-tab coordination evidence is recorded below; the documented real emulator smoke passed on 2026-10-20.

The controller uses a named 60-second expiry margin, one pending renewal, and at most one automatic retry after a 30-second backoff. Foreground reconciliation compares actual elapsed time after sleep. Transport, timeout, and throttling preserve permitted content with safe retry guidance; terminal provider invalidity clears identity/private state. Tokens stay outside presentation state and error diagnostics. Routine renewal never changes the ready lifecycle state.

## Earlier slice checkpoint

Tasks 3.1–3.3 are complete. Request-bound credentials, one safe-read retry, no automatic write replay, target-denial versus session-loss handling, cancellation, and coalesced foreground freshness have deterministic coverage. A stable-source targeted browser run passed 25 cases across all five projects for child/parent draft retention, creation, background refresh preserving a draft's original version, transient background retry, and authoritative removal. Silent scheduled renewal separately passed all five projects without input/focus/layout changes. A broader 130-case run reported two failures while sources were changing; the affected stable-source cases passed, but a final full-suite result remains required and is not inferred from that targeted run. The latest full unit run before storage work passed 300 tests.

## Shared storage and coordination slice

Tasks 4.1–4.4 have complete implementation evidence. The shared-storage file passed 40 cases across all five configured projects: new/open peer adoption, reload/protected history, shared sign-out with draft cleanup, account replacement, BroadcastChannel-disabled storage-event fallback, conflicting legacy tabs, corrupt/denied auth storage, unrelated-key preservation, separate-profile isolation, and reopening a persistent browser profile. A subsequent 15-case run across those projects passed simultaneous competing sign-ins, duplicate/reordered hints without auth reads, and missed sign-out on a simulated suspended page with presentation gated on resume. Storage tests disable trace/screenshot/video; returning synthetic profiles are deleted by the test that creates them.

Native secure-context Web Locks were exercised in Chromium, Firefox, and WebKit. They serialize short marker publication/cleanup sections; provider waits remain outside the lock. Missing/denied locks are an explicit recoverable storage error, with no isolated-tab fallback. BroadcastChannel is optional and was disabled in fallback/resume tests. The provider rereads shared credentials before renewal; simultaneous non-rotating refresh remains valid under the installed SDK's `REFRESH_TOKEN_AUTH` contract. No provider rotation/lifetime configuration change or production configuration inspection is claimed.

Deterministic SDK/storage interleavings passed for sign-in completing after peer logout, renewal completing after logout despite SDK cleanup failure, and an old terminal result after a peer published a newer account. Raw storage tests cover captured-generation publication, obsolete SDK writes/cleanup, competing publications, SDK-only key allowlisting (excluding userData), durable tombstones, and safe corruption/denial. Controller/request tests discard late successful reads and mutations. Cached page instances belong to the current app identity; changing that identity destroys private page caches and drafts, while ordinary parent/child navigation preserves safe drafts. These are application-state boundaries, not a claim of physical memory erasure.

An initial Chromium storage run found the one-time upgrade copy being cleared during page startup; that implementation defect now has a passing component regression. Its other failures were fixture issues: Back from the first entry reached about:blank, and replacing the entire localStorage getter prevented Vite's development entry from loading. The corrected history test leaves an actual protected entry behind sign-in. The denial browser test denies all owned auth-store reads/writes while allowing Vite's unrelated tooling keys; direct storage-getter denial is separately covered by the storage unit seam. The corrected full 40-case run passed without skipped assertions.

At this slice checkpoint, final browser/accessibility suites, security-negative aggregate evidence, actual browser zoom, screen-reader speech review, emulator smoke, diagnostics, and handoff remained tracked. Their subsequent results are recorded below.

## Real emulator smoke — 2026-10-20

Ran `npm run dev:cognito`, `npm run setup:local-cognito`, stopped the bootstrap emulator,
then ran `npm run dev:full` and `npm run test:e2e:local-auth`: **2 passed**. The smoke used
real local Cognito/API responses without HTTP mocks and disabled trace, screenshot, and video.
It covered parent registration/household/profile, child provisioning, child reload/new-tab return,
shared sign-out, and a real REFRESH_TOKEN_AUTH call triggered by expired cached expiry metadata
without changing JWT claims. Unsupported reset/freshness behavior remains an explicit refusal.

Expected owner journeys: signed-out visits show Sign in; an unattached parent reaches household
then profile setup; an active parent returns to Family; an active child returns to My Todos;
new tabs restore that same account; sign-out clears peers and protected Back/reload remains
signed out. No real credentials or local generated data are included in tracked evidence.

## Safe diagnostics

The development console emits only `[todone-session]` with allowlisted operation, outcome, and
rounded nonnegative duration. Startup, renewal, freshness, and invalidation never forward raw
provider errors, identity, tokens, or private context. Diagnostic sink failure cannot prevent
sign-out. Production has no session telemetry destination. Privacy canaries exercise both
successful and failed controller paths.

## Final verification checkpoint — 2026-10-20

The final application unit suite passed **324 tests**. The full integration suite passed
**33 tests**, including actual RSA signature, issuer, audience, and expiry enforcement through
the local HTTP boundary (only JWKS transport is substituted), credential-cutoff rejection,
parent/child and cross-household denial, safe typed membership errors, no-store, and idempotency.
Lint, typecheck, frontend build, and all eight Lambda build-only artifacts passed.
The complete accessibility suite passed **45 cases** across all configured projects.

An initial full browser run passed 204/205. Repeats established that the suspension fixture
sometimes resumed before shared logout had published: local UI clears immediately, while Web
Lock publication is asynchronous. The corrected fixture waits for the authoritative signed-out
marker before resuming its deliberately notification-blind peer. Its unchanged no-private-flash
assertion passed **15 repeated runs**. A speculative DOM-flush change did not resolve that fixture
race and was removed; no product workaround or weakened privacy assertion remains.

`npm run verify-local` was run and stopped at formatting in the same 12 pre-existing protected
`.agents/skills/*/SKILL.md` files. Required application checks were run separately without changing
the formatter or those files. Strict validation of this change passes. Repository-wide strict
validation reports existing warnings as failures in seven unrelated items: daily recurrence,
deployable PWA foundation, household membership, family accounts, Todo lifecycle/history,
registration-password clarity, and visual foundation. These baseline issues remain release gates;
they are not waived or counted as passing.

The new client privacy browser check passed all five projects: synthetic credentials, private
context, and drafts were absent from navigation URLs, persisted history state, console messages,
BroadcastChannel hints, IndexedDB, and protected Cache API entries. Allowlisted SDK auth storage
remains the explicit persistence exception. Trace/video/screenshots were disabled. The first
version of this new test incorrectly sought Sign out on the profile form; it now navigates to
Family and waits for shared publication before checking hints.

The subsequent full run also exposed a real late-directory-response navigation race. An existing Family
read now discards its result when the user leaves that route; it cannot replace their Back
destination. The first onboarding directory read still completes through its intentional landing
transition. A deterministic delayed-response browser regression verifies
that the profile URL, heading focus, and safe draft survive. Final rerun results follow below.

## Final results and release handoff

After the navigation fix, `npm run test:e2e -- --workers=2 --reporter=line` passed
**215/215** across compact/medium/wide Chromium, Firefox, and WebKit. The sequential final
`npm run test:a11y -- --workers=2 --reporter=line --output=test-results/a11y-final` passed
**45/45**. `npm run test:e2e:local-auth -- --output=test-results/local-auth-final` passed
**2/2** against the real running stack after the final fix. The focused delayed-directory,
ready-navigation, and onboarding run passed **15/15**; the final component run passed **20/20**.
Lint, typecheck, final frontend build, targeted formatting, strict change validation, and tracked
diff whitespace checks passed. The full unit run passed 324; all 33 integration tests and eight
Lambda build-only artifacts passed. No authorization helper, security assertion, or check was
bypassed. The unrelated workflow/archive edits already in the working tree were preserved.

Implemented screenshots at 390, 820, 1440, and 320px were visually reviewed for readable wrapping,
continuous compact surfaces, action spacing, pending Retry, and available Sign out. Automated
keyboard, long-content, reduced-motion, contrast/axe, focus, draft, and silent-renewal checks pass.
**Task 5.2 is complete**: the owner reported performing the requested actual 200% browser zoom
and screen-reader checks, identified Firefox on macOS, and accepted the result without reporting
issues. Manual evidence is owner-reported and is recorded separately from automated axe/text
enlargement results in `docs/ux/session-state-review.md`.

Completed: implementation, security/privacy regressions, documented startup/emulator smoke,
application verification, documentation, release/rollback preparation, and owner manual review.
Remaining implementation tasks: none. Blocked aggregate gates: 12 unrelated protected skill-format files and seven
repository-wide strict-spec items listed above. Intentionally deferred: none; no exception or
waiver was approved. Do not treat implementation/test completion as archive or release approval.

The development stack remains available at `http://localhost:3001` for local owner testing.
Release/rollback stays manual: follow `docs/operations/deployment-rollback.md`, deploy the
compatible caller-only API before the frontend, verify the provider contract separately, retain
prior artifacts, and use a compatible scoped-auth cleanup shell for rollback. Never restore the
old frontend alone while leaving shared credentials behind. No deployment, production identity,
provider configuration, infrastructure mutation, or application-data migration was performed.

## PR #1 review follow-up — 2026-10-20

Both owner review findings are addressed locally against PR head `697be3d`:

- The production AuthClient passes its bound Storage explicitly to each CognitoUser constructed
  for SRP sign-in, recovery, and confirmation. The SDK does not inherit a pool's storage. A real-SDK
  regression keeps constructors, token caching, getCurrentUser/getSession, and sign-out intact,
  replacing only authentication transport. It proves scoped publication and fresh-provider
  restoration, no unscoped SDK credentials, unrelated-key preservation, and no publication or
  escaped credentials when authentication completes after logout. Recovery/confirmation users
  also retain the injected memory scope. This is SDK-boundary evidence, not live Cognito/SRP
  network verification or a production-authentication claim.
- Family Retry now passes the renewable generation-bound request context rather than a raw
  token. Component regressions exercise the real family request helper with an expired token,
  both immediate renewal success and a transient renewal failure followed by successful retry.
  They prove renewal occurs before sending, no expired request is sent, the renewed bearer is
  used, and recoverable failure never signs the account out. A browser regression advances wall
  time past expiry without firing scheduled renewal, then retries the failed directory and checks
  restoration without password entry. All five configured browser projects pass that case.

The real-SDK storage regression failed against the previous implementation. Both corrected
expired-token retry component cases also failed with the original raw-token call and pass with
the request-context fix. No authorization check or assertion was weakened. The owner confirmed
an explicit-dependency/real-adapter testing convention, now recorded in `AGENTS.md`.

Fresh verification: 329 unit tests, 33 integration tests, and 220 end-to-end browser cases passed.
Lint, typecheck, frontend build, all eight Lambda build-only artifacts, and formatting passed.
The initial sandboxed aggregate run could not open integration HTTP listeners (EPERM); it was
rerun outside that process sandbox. The sequential accessibility suite passed all 45 cases. The approved aggregate rerun completed
format, lint, typecheck, 329 unit tests, 33 integration tests, and both builds, then failed only at
repository-wide strict OpenSpec validation: the same seven baseline items listed earlier. Unlike
the earlier implementation checkpoint, formatting warnings no longer reproduce at this PR head.

These corrections restore the already-approved session contracts. The archived implementation
checklist remains 19/19 complete; no new product behavior, dependency, infrastructure change,
production operation, or deployment was introduced. Review fixes and verification are tracked
here rather than reopening or altering the archived plan. GitHub threads have not been replied
to or resolved.

Review-follow-up status: both findings and the confirmed convention are implemented and verified;
remaining implementation work: none; intentionally deferred: none. The seven existing strict-spec
validation items remain the only aggregate blocker. Diff review contains only the two production
fixes, focused regression coverage, the approved guideline, and this evidence update. The archived
19/19 checklist and its approved behavior contracts are unchanged.
