# Testing Strategy

## Goals

Testing proves product behavior, household isolation, accessible interaction, recoverable operations, and deployable artifacts. Tests are independent evidence; they do not weaken requirements, bypass authorization, call production by default, or accept visual changes blindly.

## Canonical local commands

The application-foundation implementation MUST add package scripts so these commands are the stable local and CI interface:

```sh
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
npm run test:a11y
```

Until that baseline is implemented, the repository contains only the legacy external Playwright sample and `npx playwright test` is the only existing suite command. Documentation completion does not claim the target commands currently pass.

Useful targeted interfaces after the baseline exists:

```sh
npm run test:unit -- <test-file-or-pattern>
npm run test:integration -- <test-file-or-pattern>
npx playwright test <spec-file> --project=chromium
npx playwright test <spec-file> --project=firefox
npx playwright test <spec-file> --project=webkit
```

`test:e2e` runs the configured critical Playwright suite in Chromium, Firefox, and WebKit. `test:a11y` runs automated accessibility checks at representative compact, medium, and wide viewports. CI uses a clean install and the same script names; hidden alternate pass paths are not allowed.

Application build/test commands require no Terraform installation, authenticated state or AWS credentials. Authenticated infrastructure validation executes on the human operator's computer using the separate `family-paas` repository. That owner MUST report its exact format, validation, policy-test, and Terraform-plan commands in the handoff evidence; Todone does not invent or prescribe that repository's internal command paths. No verification command may apply, deploy, invalidate production, create production users, restore, or smoke-test production without explicit human authorization.

## Offline development

For a clean review household with **two active parents and one child**, stop all local services,
run `npm run db:reset:local`, then run `npm run dev:full`. This explicitly wipes all emulator
identities and generated fixture state. See [local-database.md](local-database.md) for credentials,
SSH/listener guards, restart behavior and `npm run test:e2e:local-seed`. Seeded active parents are
local fixtures; ordinary native email verification remains unsupported and is never bypassed.
The original non-destructive Cognito bootstrap below remains available when a full wipe is unwanted.


Todone supports an entirely local authentication workflow through the development-only `cognito-local` emulator. It is not an AWS account, does not require internet access after dependencies are installed, and its pool/client/user database is ignored in `.cognito/db/`.

Bootstrap it once from the repository root:

```sh
npm run dev:cognito
npm run setup:local-cognito
```

The setup script creates or reuses a local username-based user pool, a normal PWA client, and a registration-only client; it creates a local-only verification account and writes non-secret endpoint/pool/client values to ignored `.env.local`. The default account is `localdev` with password `LocalDevPass123!`; this is a disposable local-only credential and MUST NOT be used for a real Cognito pool.

After setup finishes, stop the bootstrap-only `dev:cognito` process with Ctrl+C.
Then start the app and local API; `dev:full` owns its own emulator process on the same port:

```sh
npm run dev:full
```

Open `http://localhost:3001`, enter the local development account, and confirm the production sign-in flow reaches household creation or the existing household landing. `npm run dev:full` serves the frontend on port 3001, moves its paired local API to port 3002, and proxies `/api` requests to that process. It also proxies browser-only local Cognito traffic through `/cognito`, avoiding the emulator's missing CORS headers while the local API continues to reach Cognito directly on port 9229. `cognito-local` supports `USER_PASSWORD_AUTH`, not SRP, so `AuthClient` uses that flow only when `VITE_COGNITO_LOCAL_ENDPOINT` is explicitly present. The ordinary deployed configuration continues to use Cognito SRP. Local JWT verification fetches the local emulator JWKS and caches it; production verification continues to validate the real Cognito issuer, audience, token use, and JWKS.

`cognito-local` does not execute Todone's deployed pre-signup Lambda. Its browser registration path therefore cannot prove Entry Code enforcement and MUST NOT be treated as that security test; the pure pre-signup unit tests and an explicitly authorized production smoke own that evidence. The emulator does write confirmation and recovery codes to its console once local pool setup enables email verification. Local confirmation, resend, and recovery flows use the emulator's raw Cognito API endpoint rather than the browser SDK's production endpoint.

`cognito-local` also does not provide evidence that AWS Cognito persists or enforces the production app-client `WriteAttributes` restrictions. The local two-client arrangement exercises correct application routing only; the reviewed AWS disposable probe and the pre-apply Terraform plan own enforcement evidence for the immutable browser-write guard and registration-only client.

The local API simulator also exposes `POST /api/v1/family-members/children` and directs its administrative Cognito calls to `cognito-local` only when setup writes both `TODONE_LOCAL_DEVELOPMENT=true` and a loopback `COGNITO_LOCAL_ENDPOINT`. After creating a local parent household and profile, developers can use `/family/children/new` to exercise the child form. This confirms local request wiring only; the emulator does not prove AWS Cognito's production authorization, app-client permissions, or partial-failure behavior.

`cognito-local` does **not** implement `AdminUserGlobalSignOut`. The local password-reset route authenticates the parent and target, then returns `503 PASSWORD_RESET_UNAVAILABLE` before changing the password. The UI reports that no password changed. Do not bypass sign-out to simulate a successful reset. Handler/repository and HTTP integration tests prove operation ordering, conditional cutoff advancement, and old/equal/missing-`iat` rejection with deterministic service boundaries; successful AWS password replacement/sign-out remains a release-owner smoke check.

After the setup and `npm run dev:full` commands above, run `npm run test:e2e:local-auth`. Its separate local Playwright configuration targets port 3001, uses real emulator authentication and local API requests, and disables credential-bearing trace/screenshot/video artifacts. The smoke creates a disposable local child, observes the unavailable reset, then signs in with that child's original password. The in-memory household data resets whenever the API process restarts; local Cognito identities persist in the ignored emulator database.

To wipe and restore the review dataset, stop the full local stack and run `npm run db:reset:local`. This removes all ignored emulator identities and replaces the generated seed manifest while preserving unrelated `.env.local` entries and tracked configuration. Restart with `npm run dev:full`; see `local-database.md`.

## Test layers

### Static checks

- Formatter check fails on drift and does not rewrite files in CI.
- Lint covers TypeScript, Vue, test, server, and configuration sources with no ignored errors added merely to pass.
- Typecheck uses strict application and server configurations and checks generated/typed API boundaries.
- Production build proves PWA/static and Lambda artifacts compile from a clean install and performs a client-artifact secret scan.

### Unit tests

Unit tests cover pure validation, date/time calculations, state transitions, error mapping, redaction, and repository key/projection construction. They include invalid and boundary values, not only happy paths.

Required areas include case-insensitive usernames/labels, IANA timezone validation, date-only parsing, DST and calendar boundaries, immutable roles, Todo transition tables, version conflicts, recurrence keys, monthly clamping, and log allowlisting.

### Integration tests

Integration tests exercise API handlers through realistic JWT verification and a disposable DynamoDB-compatible data boundary. Test helpers may create principals and seed data, but requests still pass through production authorization middleware. There is no "authorized test mode."

Required suites include:

- Valid, missing, malformed, expired, wrong-issuer, and wrong-audience JWTs.
- Exact `GET /api/v1/session` response and `no-store` behavior.
- Membership bootstrap idempotency and one-household-per-user concurrency.
- Typed Membership resolution for unattached, active, pending, inactive, credential-stale, and
  inconsistent lookup/Household/member records, including missing and boundary-second token `iat`.
- Every authorization-matrix allow/deny boundary, including inactive membership and cross-household opaque IDs.
- Cognito administration adapters with secret-safe failures and pool-scoped calls.
- Pending-parent self activation, atomic activation-copy transition, repeated activation, and proof
  that an active peer cannot supply a target identity to activate another parent.
- Family-account endpoint status/error/idempotency contracts, including confirmed replay only,
  non-replayed password reset, and manual-operator ownership after induced Cognito/DynamoDB splits.
- Conditional Todo lifecycle races and no false duplicate outcomes.
- Query projection maintenance and no active/history overlap.
- Full child-removal cascade for every deployed child-associated entity and restricted audit record.
- Recurrence generation idempotency, current-only reconciliation, and no elapsed backfill.
- Error envelopes and structured logs free of forbidden values.

Local dependencies use isolated tables/pools or deterministic fakes that preserve conditional-write, transaction, pagination, and JWT semantics. A mock that always returns success is insufficient security evidence.

### Component tests

Components cover form labels, keyboard behavior, focus movement, live-region announcements, state rendering, retry, conflict, disabled controls, reduced motion, and role-dependent action visibility. Component tests do not substitute for server authorization tests.

### Playwright end-to-end tests

Critical flows run through the browser against a local application and local API/auth test environment. They cover:

- Production registration gate including closed registration, Cognito email confirmation/resend, sign-in, shared browser-account restoration from versioned, scoped auth storage, Forgot Password, sign-out, household creation, and onboarding. The sole persistence exception is allowlisted SDK authentication material in the owned localStorage namespace (ADR 0007). Browser and unit tests reject private profile/directory persistence, credential-bearing URLs/history/channel messages/logs, IndexedDB, and service-worker caches. Shared-storage tests use synthetic credentials with trace/video/screenshots disabled.
- Parent member creation/reset/removal and self-profile editing.
- Pending-parent setup-code activation, built-in Cognito invitation resend/change/cancel, and
  parent-only recovery-email replacement while the previous verified value remains active.
- Canonical route guards, Back/Forward, reload/deep links, secret-free history, and the pre-Todo child `/todos` landing. The placeholder test proves that it makes no Todo API request and exposes no Todo action.
- Parent Todo assignment, child completion, parent history, undo/reopen, archive/restore, and delete confirmation/cancellation.
- Label selection/creation/filtering and recurrence current/history behavior as those capabilities ship.
- Silent renewal, expiry, access removal, network failure, stale conflict, and safe retry without mutation replay. Shared-account tests cover simultaneous sign-ins, late SDK writes, peer sign-out/replacement, suspended pages, notification fallback, persistent-profile return, and separate-profile isolation.
- Real local-auth smoke covers parent onboarding, child creation/return visits, REFRESH_TOKEN_AUTH, and multi-tab sign-out. The emulator explicitly refuses unsupported password-reset freshness parity; no security gate is bypassed to make that flow pass.
- Automated axe/keyboard/reduced-motion checks and screenshot review supplement actual browser zoom and named screen-reader speech testing. Record human-only evidence separately; viewport resizing or CSS text enlargement does not establish 200% browser zoom.
- Development controller diagnostics contain only allowlisted operation/outcome/duration fields. Unit privacy canaries verify that raw provider errors, tokens, identity, and private context cannot reach the diagnostic sink. Production introduces no telemetry.

At minimum, critical specs run at 390 x 844, 820 x 1180, and 1440 x 900 CSS pixels. Responsive/a11y suites additionally verify 320 CSS-pixel reflow and 200 percent zoom. Browser projects include Chromium, Firefox, and WebKit. Tests use stable role/name locators instead of CSS implementation details.

### Accessibility verification

Automated checks scan each changed route and interaction state with no confirmed violations accepted. Tool false positives require a recorded manual review and rationale. Manual review covers keyboard-only operation, logical/visible focus, screen-reader labels and announcements, zoom/reflow, contrast, touch targets, reduced motion, destructive dialogs, and focus after dynamic list changes.

The reviewer records browser, viewport, screen reader where used, flow, and result. Automated snapshots and accessibility trees are reviewed for meaningful changes, never bulk-accepted.

Before product-owner review of a changed UI slice, the implementing engineer supplies concise UX journeys naming the starting role/state, canonical route, actions, and expected visible, focus, and navigation results. These journeys exercise the real local application after automated browser smoke; a second post-implementation mockup is not required.

### Security-negative testing

Each protected operation has tests for missing authentication, wrong role, another member where relevant, another household, inactive/removed membership, malformed/extra ownership fields, stale versions, and forbidden lifecycle states. Security tests assert both denial and absence of side effects/data disclosure.

Membership-resolution tests must use a seam that can independently model lookup, Household, and
household Membership records. An in-memory repository that always returns an active simplified
membership is insufficient evidence for activation, cutoff, mismatch, corruption, or removal.

Log-capture tests seed recognizable canary secrets and private values, induce failures, and assert those values are absent from logs, metrics, errors, URLs, caches, and built browser assets.

### Recovery and infrastructure tests

The `family-paas` owner proves the reviewed plan, least-privilege IAM, Cognito issuer/audience, dedicated table, on-demand billing, encryption, PITR, and rollback outputs. The Todone operator periodically follows the separate-table PITR restore drill in `docs/operations/backup-restore.md` and records item counts, sample access-pattern queries, authorization invariants, and disposal.

The Cognito administration adapter is unit-tested with a command-recording client and a typed
deterministic fake. Tests assert the exact child/parent delivery flags and attributes, permanent
password and lifecycle commands, stable safe error taxonomy, and absence of raw dependency
messages, metadata, private inputs, or logging. Terraform validation and a reviewed plan must show
the five approved actions scoped to the Todone pool ARN on the separate family-account role, with
no Cognito administration policy attached to ordinary Lambda handlers.

## Test data and isolation

- Automated tests never use production endpoints, credentials, tables, pools, or family data.
- Fixtures use synthetic household names, users, and Todos and generate unique IDs per test/worker.
- Tests clean their isolated resources without deleting shared developer or production resources.
- Time-dependent tests inject/freeze server time and specify Household timezone. They do not depend on the machine timezone or wall clock.
- Concurrency tests coordinate actual competing writes rather than sequentially simulating them.
- Secrets use test-only canaries and are not committed.

## Ownership and gates

| Evidence | Owner | Release rule |
| --- | --- | --- |
| Format, lint, typecheck, unit, integration, build | Implementing engineer | All pass from a clean install. |
| Playwright across configured browsers/viewports | Implementing engineer | Critical changed flows pass with no `test.only` or local-only skip. |
| Automated and manual accessibility | Engineer plus feature reviewer | No blocking violation or inaccessible critical flow. |
| Authorization/threat-model coverage | Engineer plus security reviewer | Matrix allow/deny cases and log redaction pass. |
| `family-paas` validation and reviewed plan | Platform owner plus Todone reviewer | No unexplained destructive/IAM/cost change. |
| Production deploy and smoke | Human release owner | Only after explicit authorization; result and artifact IDs recorded. |
| PITR restore drill | Operator | Performed after table creation and periodically after material model changes. |

A failing required check blocks release. Flaky tests are failures to diagnose, not candidates for unconditional retries or removal. A requirement change is resolved in product/OpenSpec artifacts, never by weakening the assertion silently.

## Production smoke boundary

The bootstrap production smoke uses an explicitly authorized synthetic first-parent identity: exercise the configured registration gate, email confirmation, sign-in, household creation, current-tab restoration, sign-out, Forgot Password, invalid/closed registration, and privacy-safe log inspection. It happens only after explicit human deployment authorization. The release owner removes or clearly identifies the synthetic household according to the approved production-data procedure; agents do not run this smoke autonomously.

Agents do not run this smoke autonomously. If deployment is not authorized, record local and plan evidence and leave the production task incomplete.

## Pending activation race verification

Automated repository/handler tests must schedule activation against email replacement, resend,
and cancellation in both orders. Cover the conditional guard and state version, missing legacy
binding, old verified email retained by Cognito, signed-but-stale email claims, missing/false or
forged proof, repeated activation, uncertain partial outcomes, and suspended external calls.
Timeout/lease expiry must never allow overlapping external writers. Test real SDK storage and
session-generation behavior through password challenge, native attribute verification, renewal,
and retries; a mocked success callback cannot prove persistence or activation security.

Browser tests cover separately labelled setup/verification codes, invalid/expired code, resend,
conflict refresh, secret-free navigation/history and accessible feedback. Locally verify the same
documented startup commands. If cognito-local cannot enforce native verification, explicitly
refuse activation before any Membership transition and label the unsupported parity. Do not
manufacture verified claims in the emulator. Real Cognito delivery, code-to-current-email binding,
staged updates, renewed claims, and the built-in sender quota remain human release checks until
proved against that provider; deterministic service-boundary tests remain automated evidence.

## Deleted-identity token boundary

The approved deletion-retention exception is a temporary `REVOKED#SHA-256(sub)/REVOCATION`
record containing no raw identity, member ID, username, name, email, or history. Child removal
publishes it atomically with inactive Membership copies before cleanup can remove the lookup.
Membership resolution and household bootstrap check it before treating an identity as unattached.
An incomplete removal retains non-expiring ownership for operator repair. After confirmed Cognito
deletion, remove ownership and set numeric `expiresAt` to deletion time plus the configured
one-hour ID-token lifetime and 60-second tolerance. Pending-parent cancellation uses the same
bound. No raw child identity survives successful removal; completed replay references associated
with that child are purged. The marker logically expires independently of eventual DynamoDB TTL
cleanup. A reused username has a new unrelated `sub` and cannot recover old identity access.

Verify stale-token bootstrap during/after deletion, partial cleanup, completed replay, reference
purge, token-bound marker expiry, and username reuse. Terraform vendors the pinned table module
with only TTL added, preserving the existing table resource address, keys, PITR, encryption, and
deletion protection. Reject any replacement plan; no apply/deploy is authorized. Rollback must
retain revocation-aware Membership/bootstrap checks until all relevant old JWTs have expired.

The additional `npm run test:e2e:parent-activation` suite starts a local Vite build configured for
the normal production SRP adapter on port 3003. Its HTTP fixture intercepts every Cognito request
with synthetic responses and blocks other remote hosts. It covers real SDK password challenge,
native email verification, invalid-code recovery, token renewal, and activation UI success without
turning off the emulator's explicit unsupported-verification gate. It is automated adapter/UI
evidence, not real AWS email-delivery evidence. Run it alongside ordinary e2e/a11y suites.
