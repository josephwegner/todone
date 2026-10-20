# API Conventions

## Scope and base path

The public application API is JSON over HTTPS under `/api/v1`. Breaking contract changes require a new versioned base path or a coordinated migration. Browser code uses one typed API client configured with an explicit API origin; feature code does not construct arbitrary production URLs.

The foundation protected probe is:

```http
GET /api/v1/session
Authorization: Bearer <Cognito-ID-token>
```

A successful response has exactly these application fields:

```json
{
  "sub": "stable-cognito-sub",
  "username": "immutable-username",
  "expiresAt": "2026-08-05T18:30:00Z"
}
```

No household or profile data is returned by the foundation probe.

## Household bootstrap contracts

First-parent identity creation uses Cognito's public client directly rather than an application credential endpoint:

- `SignUp` receives `username`, `password`, `email`, and the registration gate password as temporary validation data for the pre-signup trigger. The gate password is not a Cognito user attribute and is never copied into application data or logs.
- `ConfirmSignUp` receives `username` and Cognito's email confirmation code. A successful confirmation activates the account and marks its email verified.
- `ResendConfirmationCode` supports an unconfirmed account whose original code expired or was lost.
- `ForgotPassword` receives `username`; `ConfirmForgotPassword` receives `username`, Cognito's recovery code, and the new password. User-facing initiation responses remain generic and do not disclose whether an account exists.

After Cognito authentication, the application resolves bootstrap state through:

```http
GET /api/v1/memberships/current
Authorization: Bearer <Cognito-ID-token>
```

An authenticated account without Membership receives exactly:

```json
{
  "membership": null
}
```

An active member receives exactly:

```json
{
  "membership": {
    "memberId": "opaque-member-id",
    "username": "river-parent",
    "role": "parent",
    "household": {
      "householdId": "opaque-household-id",
      "name": "Wegner Family",
      "timezone": "America/Chicago"
    }
  }
}
```

`{"membership": null}` means only that no user-membership lookup exists. It is not used for a
pending, inactive, credential-cutoff-rejected, or inconsistent record. On this authenticated
self-read, pending membership receives `403 MEMBERSHIP_PENDING_ACTIVATION`, inactive membership
receives `403 MEMBERSHIP_INACTIVE`, and inconsistent records receive `500 MEMBERSHIP_INCONSISTENT`.
A token without an `iat` later than the server-owned credential cutoff receives
`401 SESSION_REAUTHENTICATION_REQUIRED`. Each uses a safe message and request ID and exposes
no household, target, or stored identity values. These typed codes are a deliberate caller-only
extension approved for `rearchitect-session-management` on 2026-10-19. Ordinary protected
operations retain generic `403 MEMBER_ACCESS_UNAVAILABLE` and `500 INTERNAL_ERROR` denials.
Unknown service failures remain recoverable errors, never inferred membership outcomes.
The client routes an unattached identity to
household setup, a pending additional parent through activation, and inactive/stale access to a
generic sign-in or unavailable surface rather than treating either as a new household owner.

An unattached account creates its one household through:

```http
POST /api/v1/households
Authorization: Bearer <Cognito-ID-token>
Idempotency-Key: <opaque-client-generated-key>
Content-Type: application/json

{
  "name": "Wegner Family",
  "timezone": "America/Chicago"
}
```

The name is trimmed, must contain 1–80 Unicode characters, and must not contain control characters. The timezone must be an IANA name recognized by the server runtime. Unknown properties are rejected. Success returns `201 Created` with the same non-null `membership` representation as `GET /api/v1/memberships/current`. Reusing the same idempotency key with the same normalized input returns the original successful representation; reusing it with different input returns `409 Conflict`. An existing member's create attempt returns `409 Conflict`, invalid fields return `422 Unprocessable Content`, and missing or invalid authentication returns `401 Unauthorized`.

Neither bootstrap request accepts a household ID, member ID, role, username, email, or Cognito `sub` from the client. Household and membership identifiers are generated server-side, the caller comes from verified authorizer claims, and the initial role is always `parent`.

## Profile and family-directory contracts

An active member reads and version-writes only their own profile through `GET` and `PUT /api/v1/profiles/me`. The write body accepts exactly `displayName`, canonical `color`, and `version`; it never accepts a household ID, member ID, role, username, or Cognito `sub`. A missing profile reads as `{"profile": null}` so first-parent setup can create version `0`; a successful create returns `201 Created` and subsequent writes return `200 OK`. A stale or skipped version returns `409 Conflict` without overwriting the saved profile.

Any active household member may read the safe family directory through:

```http
GET /api/v1/family-members
Authorization: Bearer <Cognito-ID-token>
```

The caller's verified `sub` resolves the household; the request accepts no target or household identifier. The response contains only `memberId`, immutable `username`, immutable `role`, activation state, current `displayName`/canonical `color`, and stable `allowedActions`. It is deterministically ordered by activation state, username, then member ID. Active members have no directory actions. An active parent sees a pending parent with exactly `RESEND_WELCOME`, `CHANGE_EMAIL_AND_RESEND`, and `CANCEL_PENDING_ACCOUNT`; a child receives active members only. Inactive records, recovery email, Cognito status/details, raw `sub`, household details, and cross-household records are never represented.

## Family-account management contracts

Every endpoint in this section authenticates first and resolves the caller's active Membership
before reading a target or invoking Cognito. The only exception is self activation, which resolves
the verified caller's matching pending Membership under its narrower contract. Route `memberId`
values identify targets only after the caller's household has been resolved; bodies never accept
`householdId`, `memberId`, `sub`, role, activation state, username ownership, or credential cutoff.

| Operation | Contract | Success | Retry and error rules |
| --- | --- | --- | --- |
| Create child | `POST /api/v1/family-members/children`; `Idempotency-Key`; body exactly `username`, `displayName`, `color`, `password` | `201` with the safe directory member; completed replay is `200` with the same member | Normalized global username conflict is `409 USERNAME_CONFLICT` with a username field error. A split Cognito/application result is generic `500` and requires operator cleanup before username retry. |
| Create additional parent | `POST /api/v1/family-members/parents`; `Idempotency-Key`; body exactly `username`, `displayName`, `color`, `email` | `201` with the safe pending directory member; completed replay is `200` | Same conflict and split-result rules as child creation. Email is accepted for delivery but omitted from the returned member and peer reads. |
| Activate additional parent | `POST /api/v1/parent-activations`; no body or target ID; caller has a new token after Cognito `NEW_PASSWORD_REQUIRED` | `200` with the ordinary active current-Membership representation | The adapter marks the already-configured Cognito email verified only after setup-code possession, then matching pending lookup and household Membership become active in one DynamoDB transaction. Repeating after success returns the same active representation. Unattached, child, inactive, mismatched, or corrupt records cannot activate. |
| Reset child password | `PUT /api/v1/family-members/{memberId}/password`; body exactly `password` | `204` after permanent password replacement, global sign-out, and cutoff advancement | Password resets are not automatically replayed after an uncertain response and do not use an idempotency record containing or derived from the password. The UI requires a new explicit submission. Parent/pending/inactive targets are `403 TARGET_NOT_MANAGEABLE`; absent/cross-household targets are `404`. |
| Resend pending-parent welcome | `POST /api/v1/family-members/{memberId}/welcome-email-resends`; `Idempotency-Key`; no body | `204`; a completed replay is also `204` | Only the same-household pending parent state is valid. Cognito resend throttling is `429`; an uncertain send reports a generic request-ID failure and the UI does not claim delivery. |
| Change pending email and resend | `PUT /api/v1/family-members/{memberId}/pending-email`; `Idempotency-Key`; body exactly `email` | `204` after Cognito accepts the replacement and resend | The email and rendered message are never returned, logged, or stored in application records. Same target-state, throttling, and uncertain-send rules as resend. |
| Cancel pending parent | `DELETE /api/v1/family-members/{memberId}/pending-account`; `Idempotency-Key`; body exactly `{"confirmation": true}` | `204`; completed replay is `204` | Only a pending parent is targetable. Active parents and children are `403`; absence/cross-household is `404`. A split deletion requires operator cleanup. |
| Remove child | `DELETE /api/v1/family-members/{memberId}`; `Idempotency-Key`; body exactly `{"confirmation": true}` | `204` only after the complete deployed cascade and Cognito deletion | Missing/false confirmation is `422`. Parent or non-active-child targets are `403`; absence/cross-household is `404`. A partial cascade returns generic `500`, remains fail closed, and requires operator cleanup before username reuse. |
| Read own recovery email | `GET /api/v1/security/recovery-email` | `200 {"email":"…"}` to the owning active parent only | Children receive `403`. The value is `no-store`, private, and absent from logs and peer APIs. |
| Start own recovery-email replacement | `PUT /api/v1/security/recovery-email`; body exactly `email` | `202` after Cognito stages the new value and sends its verification code | Active-parent self only. The old verified value remains current. The browser completes Cognito `VerifyUserAttribute` with its access token; only then does Cognito promote the new value. The app client cannot directly write `email`, preventing a child from bypassing the parent-only API. |

Creation and lifecycle idempotency records bind the key to caller `sub`, route template, target
where present, and a one-way normalized-input digest that excludes passwords. They contain no
email, username, display name, profile value, or raw body. An idempotency key reused with different
non-secret input returns `409 IDEMPOTENCY_CONFLICT`. A request may replay only a confirmed complete
result; it never guesses that an identity-only or data-only partial result succeeded.

Known dependency unavailability before any external or persistence side effect may return `503`
with safe retry guidance. Once an operation might have changed Cognito or DynamoDB but cannot prove
the complete outcome, it returns generic `500 INTERNAL_ERROR` with the request ID. Todone provides
no automatic repair state machine or household repair UI; an authorized operator inspects and
cleans the orphan before the product retries the username or destructive transition.

The reset form lives at `/family/children/:memberId/password`; only the opaque member ID enters the URL. Its target is resolved from the parent's household directory. Parent/child route guards, missing-target fallback, cancel, Back/Forward, and reload never restore the password or replay a write. A successful reset response is empty and `no-store`. Cutoff writes require an existing lookup and cannot move the timestamp backwards; a concurrent equal/newer cutoff is confirmed with a strong read. Tokens issued in the same second as the cutoff are deliberately stale; a replacement sign-in token must be issued in a later second.

The local simulator returns `503 PASSWORD_RESET_UNAVAILABLE` before any credential mutation because its Cognito emulator lacks global sign-out. This is a known local capability limit, not a successful production reset.

## Authentication and authorization

- Protected requests use `Authorization: Bearer <Cognito ID token>` over HTTPS. Tokens MUST NOT appear in URLs, logs, error text, analytics, or persistent application data.
- API Gateway verifies configured issuer, audience, signature, and expiry before a protected handler runs.
- Handlers use API Gateway's verified authorizer claims, including `sub`, as caller identity. They do not re-verify the raw bearer token. Username, display name, body fields, route household IDs, and query parameters never establish ownership.
- Every household route resolves active Membership and applies the server-side authorization matrix in `docs/security/authorization-matrix.md`.
- A token may be cryptographically valid while Membership is absent, pending, inactive, inconsistent, or rejected by its credential cutoff. Only the specifically documented unattached bootstrap and pending-parent activation paths bypass the ordinary active-Membership requirement.
- CORS permits only explicitly configured local origins and the production PWA origin. CORS is not treated as authentication.

## Representation conventions

- Requests and responses use UTF-8 JSON with `Content-Type: application/json` unless a response has no body.
- Property names use `camelCase`. Enum wire values use stable uppercase names such as `ACTIVE` and `COMPLETE`.
- IDs are opaque strings. Clients MUST NOT infer type, ownership, ordering, or authorization from an ID.
- Calendar dates use `YYYY-MM-DD` and are interpreted in the Household IANA timezone.
- Monthly recurrence keys use `YYYY-MM`; weekly and daily keys use `YYYY-MM-DD` as defined in the date ADR.
- Instants use UTC RFC 3339 with `Z`, such as `2026-08-05T18:30:00Z`.
- Optional values are omitted or explicitly `null` only when the endpoint schema defines that choice. Empty strings do not stand in for missing values.
- Unknown request fields are rejected for mutation requests so misspelled or obsolete security-relevant fields do not pass silently.

## Resource and method conventions

- Paths use plural nouns for resources and no action verbs when an HTTP method expresses the operation.
- `GET` is read-only and safe to retry.
- `POST` creates a resource or represents a named transition that is not a simple replacement.
- `PATCH` updates only explicitly mutable fields and carries the current record version.
- `DELETE` is used only for specified deletion behavior and may require an explicit confirmation field or one-time confirmation token.
- List endpoints use bounded page sizes and opaque continuation tokens. A continuation token is validated against the caller, household, route, and filters before use.
- Sorting is deterministic and includes an opaque ID tie breaker.

Non-idempotent creates that may be retried require an `Idempotency-Key` header. The server binds a key to the authenticated caller, route, and normalized request and rejects reuse with a different payload. Lifecycle writes use record versions and conditional persistence. Repeated completion or generation requests return the one current outcome rather than creating duplicates.

## Status codes

| Status | Meaning |
| --- | --- |
| `200 OK` | Successful read or mutation returning a representation. |
| `201 Created` | Resource created; response contains the created representation and may include `Location`. |
| `204 No Content` | Successful operation with intentionally no representation. |
| `400 Bad Request` | Malformed JSON, unsupported field, or request-level validation failure. |
| `401 Unauthorized` | Missing, malformed, expired, or invalid authentication. No session or resource data is returned. |
| `403 Forbidden` | Authenticated caller lacks role or state permission for a resource already safely known in their household. |
| `404 Not Found` | Resource is absent or is not visible in the caller's household. Cross-household requests use the same response as absence. |
| `409 Conflict` | Duplicate normalized value, stale version, already-changed lifecycle, idempotency mismatch, or invariant conflict. |
| `422 Unprocessable Content` | Well-formed payload has field validation errors. |
| `429 Too Many Requests` | Cognito, API, or application throttling. |
| `500 Internal Server Error` | Unexpected failure with a safe request ID and no internals. |
| `503 Service Unavailable` | Known temporary dependency unavailability where retry may succeed. |

Authentication and cross-household responses MUST NOT reveal whether a username, household, member, Todo, label, or template exists, except where the approved product flow explicitly requires a same-household conflict such as label selection.

Within a safely resolved household, a known target with a prohibited role/state returns `403`.
An absent or cross-household target returns the same `404`. Persistence inconsistency is not
reported as expected absence or authorization denial: it returns generic `500` externally and a
coarse, non-identifying consistency outcome internally.

## Error contract

All application errors use one envelope:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Check the highlighted fields and try again.",
    "requestId": "01J...",
    "fieldErrors": [
      {
        "field": "timezone",
        "code": "INVALID_TIMEZONE",
        "message": "Select a supported IANA timezone."
      }
    ]
  }
}
```

`code` is a stable machine-readable value. `message` is safe, user-oriented text. `requestId` correlates with privacy-safe logs. `fieldErrors` is present only when useful and preserves no secret input. Stack traces, AWS identifiers, table keys, raw dependency messages, token claims, and request bodies are never returned.

## Conflict responses

A `409` caused by a stale version or already-completed operation returns the current safe resource representation when the caller remains authorized to read it. Otherwise it returns only the error envelope. The client presents refresh/retry guidance and never applies a false optimistic success.

## Caching and service workers

- Protected API responses send `Cache-Control: no-store` and are never stored by the service worker, Cache API, or shared browser caches.
- Authentication endpoints and responses also use `no-store`.
- Hashed public static assets may be immutable and cached. The application shell uses a revalidation strategy that permits a reviewed release and rollback to take effect.
- Logout clears application session material and protected in-memory state. It does not claim to revoke an already expired or separately stolen token.

## Observability

Each request accepts or receives a server-generated request ID. Responses expose that safe request ID. Structured logs contain timestamp, request ID, route template, method, status, latency, authenticated/denied outcome, and coarse error code only.

Metrics cover API error count, API latency, and authorization denials. Product usage, names, Todo titles, labels, credentials, JWTs, setup secrets, emails, and raw identifiers are excluded.

## Contract verification

Integration tests MUST prove:

- Missing, malformed, wrong-issuer, wrong-audience, and expired tokens fail before data access.
- The current-session success body has exactly `sub`, `username`, and `expiresAt`.
- Cross-household identifiers behave like absent resources and do not disclose data.
- Parent/child role rules and inactive membership are enforced server-side.
- Protected responses are not cacheable.
- Validation, conflicts, throttling, and unexpected errors conform to the envelope without sensitive values.
