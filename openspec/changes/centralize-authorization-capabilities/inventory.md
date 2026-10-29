# Authorization migration inventory

Scope: all delivered application household operations as of 2026-10-28. Migration owner:
`centralize-authorization-capabilities` for every row. Public Cognito authentication, session
verification, registration-gate triggers, IAM and operator repair remain their existing boundaries;
they do not become household capabilities. Future Todo/label/recurrence keys are registered only
with their implementing changes.

| Handler / operation | Stable key | Eligible principal | Trusted context / conditional boundary | Existing denial | Side effects |
| --- | --- | --- | --- | --- | --- |
| create / first household | `household.bootstrap` | Unattached | Verified sub, revocation marker, absence of lookup; conditional unique lookup | 401, 409 | Atomic Household, Membership copies, replay |
| create / completed retry | `request.completed.replay` | Active parent | Caller-bound idempotency receipt and matching payload; no new creation | 409 for other input | None |
| current / own membership | `household.read` | Active child/parent | Matching lookup/household/member and credential cutoff | Existing typed self outcome; 401/403/500 | None |
| profile / read self | `profile.read` | Active child/parent | Server-derived member/household | 401/403/500 | None |
| profile / save self | `profile.update` | Active child/parent | Same member and household; current version, active Membership condition | 401/403/409/500 | Conditional Profile write |
| directory / read | `family.directory.read` | Active child/parent | Resolved household query | 401/403/500 | None |
| directory / visible member | `family.member.read` | Active child/parent | Active same-household member; parents additionally see pending parents | Hidden entries omitted | None |
| children / provision | `family.child.create` | Active parent | Resolved household, fixed child role, caller-bound replay | 401/403/409 | Cognito create/password, atomic Membership/Profile/replay |
| parentHandlers / provision | `family.parent.create` | Active parent | Resolved household, fixed pending-parent role, caller-bound replay | 401/403/409 | Cognito create/welcome, Membership/binding/replay |
| resetChildPassword | `family.child.password.reset` | Active parent | Same-household active child; scoped target lookup | Missing 404; unmanageable 403 | Cognito password/sign-out, monotonic credential cutoff |
| removeChild | `family.child.remove` | Active parent | Same-household active child, explicit confirmation; conditional removal ownership | Missing 404; unmanageable 403 | Deactivate/revoke, purge, Cognito delete, bounded revocation/replay |
| pendingParentAction / resend | `family.pending-parent.resend-welcome` | Active parent | Same-household pending parent; exclusive guard; provider invitation eligibility | Missing 404; unavailable 403; lifecycle 409 | Cognito welcome, guarded final write/replay |
| pendingParentAction / replace email | `family.pending-parent.change-email-and-resend` | Active parent | Same target/guard/eligibility; valid replacement email | Same as resend | Cognito update/welcome, binding/replay |
| pendingParentAction / cancel | `family.pending-parent.cancel` | Active parent | Same-household pending parent; confirmation; exclusive guard | Missing 404; unavailable 403; lifecycle 409 | Cognito delete, application purge/revocation/replay |
| activateParent / pending self | `family.parent.self.activate` | Pending parent | Verified caller only, current exclusive pending binding, native email proof | Generic 403; guard 409; local unsupported 503 | Conditional activation of both Membership copies |
| activateParent / active retry | `family.parent.self.activate` | Active parent | Caller-only, no target/body/query | Child 403 | None |
| recoveryEmail / read or stage | `security.recovery-email.manage` | Active parent | Caller-only identity; native verified-attribute promotion | 401/403; unsupported 503 | GET none; PUT Cognito staged email |

Broad presentation keys additionally include `profile.self.update` and `family.child.manage`;
they do not authorize a target mutation. Target actions use `profile.update`, child actions and
pending-parent keys. All arrays are sorted and unique. Directory display of role and activation
labels remains domain presentation; visibility/action decisions move to policy. Child/parent home
composition follows broad family-management availability without registering future Todo authority.

Authorization branches audited: `authorization.ts` parent/child/household helpers;
`directory.ts` visibility/action mapping; parent handlers and recovery-email caller-role branches;
remove-child caller/target checks; reset-child caller/target helpers; profile self-derived keys;
bootstrap revocation/idempotency/lookup checks; current Membership outcome mapping;
repository matching/cutoff/state resolution and directory filters; App, router and
ProductionBootstrap navigation/target controls; PendingParentControls action vocabulary.
Repository conditional state/ownership/version checks remain concurrency invariants. Removal's
active-parent enumeration identifies cleanup partitions, not caller authorization. Missing child
Profile rejection is a storage invariant, not a grant.

## Approved replay boundary

The delivered bootstrap contract returns the identical successful response when the same request
is repeated after its caller becomes an active parent. Completed child-removal and pending-parent
cancellation retries also succeed after their target has been deleted. The proposed policy says
bootstrap is available to unattached callers and contextual actions deny without current target
context. Applying those statements to every endpoint invocation would reject existing successful
retries. Allowing the current handlers to bypass policy on replay would leave a feature-local
exception to the proposed single policy boundary.

Approved resolution: register explicit replay decisions using trusted, caller-bound completed
receipts. A replay decision authorizes only returning a recorded result and never re-executing a
write or external call. Keep target mutation capabilities fail-closed when the target is absent.
The proposal, design, normative requirements and tasks now include this distinction.

Existing regression evidence for the replay boundary:

- `src/test/integration/households.test.ts`: identical bootstrap response on repeated creation.
- `src/test/lambdas/parentHandlers.test.ts`: cancellation returns 204 again after target deletion,
  with exactly one Cognito delete.
- `src/test/lambdas/childRemoval.test.ts`: completed removal returns 204 again after application
  purge and Cognito deletion, with exactly one external delete.

No application authorization behavior has changed in this inventory slice. Task 1.1 is complete; the active checklist is authoritative for progress. The owner approved explicit receipt-based replay decisions; registry definition and migration can proceed. No tasks are intentionally deferred.

The implemented registry additionally distinguishes broad `profile.self.read` and
`security.recovery-email.self.manage` from their contextual read/manage decisions. The generic
`request.completed.replay` key covers validated completed receipts for the replayable operations
above; it is never returned as broad client authority.
