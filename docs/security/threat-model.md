# Threat Model

## Scope and security goals

This model covers the Todone PWA, Cognito authentication, API Gateway, Lambda, the dedicated DynamoDB table, CloudWatch, static hosting, and the `family-paas` deployment boundary. It includes later household, account, Todo, label, history, and recurrence capabilities so their changes can inherit controls.

Security goals:

- Only an authenticated active member can access their household.
- Children and parents can perform only the role and ownership actions in `authorization-matrix.md`.
- No household can discover or access another household's identities or data.
- Credentials, setup secrets, tokens, recovery contacts, names, and Todo content do not leak through logs, caches, errors, URLs, or build artifacts.
- Mutations remain correct under retry, concurrency, stale clients, and partial dependency failure.
- Operators can deploy, roll back application artifacts, and restore DynamoDB deliberately without silent data loss or unauthorized production action.

## Assets

- Cognito passwords, refresh/access/ID tokens, verified recovery email, and setup secret.
- Stable Cognito `sub`, immutable username, household membership, and immutable role.
- Household name/timezone, member profiles, Todos, labels, recurrence templates, history, and restricted deletion audits.
- Production infrastructure credentials, Terraform state, deployment artifacts, CloudFront configuration, and AWS outputs.
- Availability and integrity of authentication, API, scheduled generation, and DynamoDB recovery.

## Trust boundaries

1. **Untrusted browser:** DOM, storage, service worker, routes, identifiers, device clock, timezone, and network responses can be manipulated.
2. **Internet edge:** CloudFront, Cognito, and API Gateway receive hostile traffic.
3. **Verified-token boundary:** API Gateway establishes token validity; it does not establish Membership or role.
4. **Household authorization boundary:** Lambda resolves active Membership and resource ownership for every operation.
5. **Persistence boundary:** DynamoDB and restricted audit data are reachable only through scoped roles and repositories.
6. **Operations boundary:** Human-controlled AWS/Terraform credentials can change or destroy production and are not available to the browser or runtime.
7. **Third-party software boundary:** npm packages, build actions, browser extensions, and CI dependencies may be compromised.

## Assumptions and exclusions

AWS managed-service security is relied upon for physical security, TLS endpoints, Cognito password storage, and DynamoDB encryption. Family members may know data they are legitimately shown; preventing a user from photographing their own screen is out of scope. A fully compromised user device or AWS administrator can defeat application controls, but least privilege, short sessions, no-secret logs, and operational review reduce impact.

## Threats and controls

| Threat | Primary controls | Required verification |
| --- | --- | --- |
| Credential guessing or enumeration | Cognito password policy/throttling; generic sign-in and recovery messages; no public child registration; setup-gated first-parent registration. | Invalid username/password responses are indistinguishable; throttling path is handled; secrets do not appear in logs. |
| Duplicate or impersonating username | Cognito case-insensitive global uniqueness and immutability; display name is separate and non-unique. | Case variants conflict; ownership always uses `sub`. |
| Token theft from storage, URL, logs, or cache | HTTPS; bearer token only in header; narrowly scoped versioned SDK auth storage as defined below, never URL, logs, Cache API, service-worker cache, or application database; CSP and XSS controls; `no-store` protected responses. | Inspect storage/cache/logs; token redaction tests; protected cache headers; sign-out clears local session state. |
| Forged, expired, wrong-issuer, or wrong-audience JWT | API Gateway JWT authorizer with exact issuer/audience; handlers accept only authorizer claims. | Negative integration tests prove rejection before handler data access. |
| Cross-household IDOR | Resolve household from verified `sub`; build keys from resolved household; verify every target; cross-household response matches absence. | Tests for every resource type and list/filter endpoint using another household's IDs. |
| Role escalation or client-side bypass | Immutable server-owned role; shared membership middleware plus operation-specific checks; no authorization bypass in tests. | Parent/child negative matrix tests; forged role/body/route fields ignored or rejected. |
| Removed member uses stale JWT | Active Membership checked on every household route; deletion fails closed until complete. | Removed-session integration test. |
| Pre-reset child JWT remains valid at API Gateway | A single `credentialsValidAfter` value on the `sub`-keyed lookup rejects missing or older/equal token `iat` during every Membership resolution. | Boundary-second and missing-`iat` tests through real authorization middleware. |
| Pending parent gains household access | Ordinary routes require active lookup and household Membership; the activation endpoint resolves only the verified caller's matching pending parent and atomically activates both copies. | Pending-route denial, forged target-field rejection, mismatched-record failure, and repeat-activation tests. |
| Registration gate disclosure or misuse | Keep only its hash in the pre-signup Lambda environment; accept the phrase only as temporary Cognito validation data; compare hashes server-side without logging; remove the configured hash to close registration; it creates only unattached accounts. Cognito credentials remain the actual authentication control. | Invalid/valid/closed tests, log inspection, and proof that supplied household IDs cannot join. |
| Parent peer administration | Target role and ownership checks before Cognito calls; recovery email is self-only. | Another parent cannot read email, reset password, remove, demote, or edit profile. |
| Child password/recovery exposure | TLS; no persistence/logging; parent-only reset for same-household child; child has no email requirement. | Secret-redaction and target-role negative tests. |
| XSS or malicious static content | Vue escaping by default; prohibit unsafe HTML for family content; strict CSP; dependency review; hashed assets; no secrets in build-time client config. | CSP/header test, rendered hostile strings, dependency audit review, build artifact secret scan. |
| CSRF or cross-origin API use | Bearer token in explicit header rather than ambient auth cookie; restrictive CORS; state changes never use GET. | Unapproved origins fail CORS; mutation without bearer token fails. CORS is not counted as authorization. |
| Service-worker privacy leak | Cache public versioned assets only; never cache protected/auth requests or responses; controlled cache version cleanup. | Automated service-worker/cache inspection after authenticated flows and logout. |
| Injection and malformed input | Schema validation, unknown-field rejection, typed persistence, no dynamic expression/path construction from raw input, escaped output. | Unit/fuzz boundary cases and hostile strings; no raw AWS error disclosure. |
| Overposting ownership or lifecycle fields | Endpoint allowlists mutable fields; server supplies household, actor, status, timestamps, and protected role fields. | Requests with extra ownership/state fields fail or are ignored according to schema, never applied. |
| Replay, duplicate write, or race | Idempotency keys, deterministic recurrence keys, transactions, and conditional versions. | Concurrent bootstrap, completion, edit, delete, label uniqueness, and generation tests. |
| Cognito/DynamoDB split result | Generic request-ID failure, no automatic product repair, no username reuse after an uncertain create, fail-closed lifecycle state where available, and operator-only inspection/cleanup. | Induced boundary failures prove no false success, no secret output, and no automatic duplicate retry. |
| Welcome-email leakage or unexpected cost | Cognito built-in sender, static source-controlled invitation template, secret-free activation URL, no rendered-message logs, and 50-message daily account quota accepted for this private deployment. | Template placeholder/link tests, log canaries, reviewed Terraform plan, and quota documentation. |
| Query/filter leaks sibling data | Authorize base set before label/filter application; child ID comes from Membership. | Child sibling-list and sibling-only-label tests return no sibling records. |
| Sensitive observability data | Structured allowlist logs only; no raw body/header/claim logging; coarse metrics; restricted retention/access. | Induced failures and authentication errors are inspected for forbidden fields. |
| Dependency or CI supply-chain compromise | Lockfile with `npm ci`; minimal dependencies; review install scripts and updates; pinned CI actions where used; no production credentials in untrusted jobs. | Dependency audit is reviewed, not blindly auto-fixed; build provenance/artifact hash recorded. |
| Runtime IAM escalation or data exfiltration | Dedicated table and configured Todone user pool; least-privilege runtime role; deployment/runtime separation; no Terraform state access. | Review effective IAM and negative access to unrelated resources. |
| Accidental table deletion/corruption | Dedicated table, PITR, human-reviewed plan, separate-table restore drill. | PITR inspection and periodic restore drill with item/access-pattern verification. |
| Accidental Cognito replacement | Immediate pre-apply empty-user and consumer check; manual apply; no pool recreation after users without migration plan. | Recorded check and reviewed plan. |
| Malicious or accidental production deployment | No deploy credentials for agents/CI by default; explicit human authorization; reviewed plan and artifacts; retained rollback targets. | Release record identifies human owner, commands, plan, artifact hashes, smoke, and rollback target. |
| Denial of service or runaway recurrence | Cognito/API throttling, bounded validation/page sizes, on-demand table, idempotent current-only generation, no elapsed backfill. | Limit and retry tests; generator duplicate/outage tests; cost review. |
| Backup restores deleted child data | Restore is isolated; before cutover reconcile deletion obligations and verify authorization; no automatic table swap. | Restore drill checks removed/inactive identities and restricted audit policy before any cutover. |

## Browser session policy

The browser uses Cognito's supported session flow with one current account shared by same-origin tabs in one browser profile, persistent across browser restarts while provider refresh credentials remain valid. This deliberately replaces the former sessionStorage-only policy under `rearchitect-session-management` and [ADR 0007](../adr/0007-app-owned-shared-browser-session.md). Verification of the complete change remains required before release.

Only SDK authentication credentials, required account-locator/device-auth metadata, and non-sensitive coordination metadata may persist in the client-scoped `todone.auth.v1.<clientId>.` localStorage namespace. Passwords, Entry Codes, confirmation/recovery codes, household/profile records, API responses, and drafts remain outside that storage. The SDK userData cache is explicitly excluded because it can contain private recovery attributes. Credentials MUST NOT enter IndexedDB, URLs/history, service-worker caches, product data, logs, or application-produced cross-tab messages. The application observes only marker-key storage events and ignores credential-key event values; browsers themselves can emit native storage events for localStorage writes. Other same-origin JavaScript can read auth storage. CSP, dependency control, escaping, and no-unsafe-HTML controls remain necessary; persistent auth storage is not a secure vault.

An opaque generation marker selects readable credentials. Short native Web Locks serialize publication/sign-out, while provider waits remain outside the lock. SDK clients bind to one namespace; late writes cannot publish a current account. Explicit sign-out clears local private state immediately, publishes a durable tombstone before credential cleanup, and clears only owned credentials. Provider cleanup exceptions do not retain private UI. Storage/coordination denial is an explicit recoverable failure; incomplete shared cleanup is reported without claiming other tabs are signed out. Active peers reconcile on metadata hints and suspended pages gate presentation until the marker is checked on resume. Other origins and browser/private profiles remain isolated.

No provider token lifetime or infrastructure setting is extended or changed. Known-expired credentials block new API sends pending renewal; a safe read retries at most once after authentication rejection, while sent mutations retain their endpoint-specific uncertain-result/idempotency contract. Protected responses remain `Cache-Control: no-store`; every API still independently checks JWTs, active Membership, role, tenant, and credential cutoff. Upgrade removes each upgraded tab's owned legacy credentials without promoting an account; compatible rollback must clear the new owned namespaces/marker and require fresh sign-in. Old-build tabs require reload before the new guarantees apply.

## Shared-browser threats and controls

This section tracks the replacement policy's required verification. It does not claim every implementation task is complete.

The current-membership self-read now reports the verified caller's pending, inactive, or inconsistent outcome with distinct safe codes, as explicitly approved on 2026-10-19. It discloses no household, target, or stored identity values and grants no authority. Other protected operations preserve their generic denial envelopes. Integration tests cover these caller-only outcomes and the unchanged profile denial; no authorization bypass or new infrastructure is involved.

The replacement allows only SDK authentication material, required account-locator metadata, and non-sensitive coordination metadata in versioned, app-owned localStorage. One account is shared by same-origin tabs in one browser profile and can survive browser restart while Cognito credentials remain renewable. Provider lifetimes remain unchanged. Other profiles, origins, and private contexts remain isolated. Household/profile data, API responses, drafts, passwords, Entry Codes, and verification/recovery codes never enter persistent auth storage. URLs/history, logs, coordination messages, IndexedDB, and service-worker caches remain credential-free.

| Threat introduced or extended | Required replacement control | Required evidence |
| --- | --- | --- |
| Longer credential residence and XSS theft | Treat localStorage as JavaScript-readable; retain CSP, escaping, no unsafe HTML, dependency review, and no-store responses. Persist only scoped SDK authentication material. | Storage allowlist/secret canaries, cache/log/URL inspection, unchanged XSS controls. |
| Shared-device account surprise or mixed private content | One current browser account; clear old private memory before adopting another identity; events convey only change/sign-out and opaque generations. | Two-tab account replacement, profile isolation, credential-free message tests. |
| Late renewal resurrects sign-out | Bind SDK writes to captured generation namespaces; active marker/tombstone controls reads; reject old API and provider results. SDK cleanup failure cannot retain private UI. | Cross-document sign-out/write interleavings and cleanup-failure tests. |
| Suspended tab misses invalidation | BroadcastChannel plus storage-event fallback; reread current generation before private presentation on resume. | Duplicate/reordered/missed-event, fallback, and resume tests. |
| Storage blocked or corrupt | Explicit recoverable state, Retry and Sign out; no silent per-tab fallback or corrupt-credential use. Local cleanup remains fail-safe even if propagation fails. | Storage exception/corruption tests; accessible recovery; no claim of successful peer cleanup when unavailable. |
| Stale context or expired credentials | Acquire credentials at send time, coalesce renewal, bound foreground context freshness, preserve server authorization, and never blindly replay mutations. | Expiry/sleep tests, target-denial distinction, existing server-negative and idempotency tests. |
| Upgrade chooses a legacy tab's account | Clear only owned legacy tab credentials; explicit sign-in unless valid new-format shared state exists. Never promote or merge independent accounts. | Conflicting legacy-tab migration and once-only explanation tests. |
| Rollback leaves shared credentials | Compatible rollback clears implemented auth namespaces/marker and private state, requires fresh sign-in, and preserves unrelated keys. Old-build tabs require reload. | Scoped cleanup tests and manual release/rollback handoff; old bundle alone is insufficient. |

Sign-out is browser-local across upgraded same-origin tabs, not server revocation or other-device logout. The initiating app clears private state immediately; active peers clear on invalidation and suspended peers reconcile before presentation. No infrastructure, Cognito lifetime/configuration, server session, or deployment change is authorized by this proposal.

## Privacy-safe logging allowlist

Allowed fields: UTC timestamp, request ID, route template, method, status, latency, deployment version, coarse outcome/error code, and aggregate authorization-denial count.

Forbidden fields: authorization headers, JWTs or claims beyond an ephemeral in-process authorization use, passwords, setup secrets, recovery email/phone, username where avoidable, `sub`, household/member/resource IDs, household names, display names, profile colors, Todo titles/content, label names, request/response bodies, and raw Cognito/AWS errors. If diagnosis needs a resource correlation, add a separately reviewed non-reversible diagnostic token rather than logging the identifier by default.

## Security ownership and cadence

The implementing engineer owns threat-linked tests and safe defaults. The reviewer owns authorization-matrix and data-flow review. The `family-paas` owner owns infrastructure IAM, public exposure, outputs, and plan evidence. The human release owner owns production authorization and smoke evidence. The operator owns setup-secret rotation, identity repair, restore drills, and incident response.

Review this model for every new entity, endpoint, dependency, token storage change, public route, Cognito permission, service-worker strategy, log field, deployment path, or child-removal cascade extension. A discovered cross-household access, secret exposure, authorization bypass, or unrecoverable destructive plan blocks release.
