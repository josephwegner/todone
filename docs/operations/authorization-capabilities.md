# Authorization capability extension and rollback

The stable external registry is `shared/authorizationCapabilities.ts`. The pure server policy and
principal taxonomy are in `lambdas/authorization/policy.ts`; enforcement/metrics and projections
are in the adjacent modules. `docs/security/authorization-matrix.md` remains the eligibility source
of truth. The active change's `inventory.md` maps every migrated handler to its key and context.

## Add a protected operation

1. Name the operation once in `Capability` and state its principal/self/member/activation/receipt
   scope in `capabilityRegistry`. Add an explicit rule to the exhaustive policy mapping.
2. Define eligible current principals and complete trusted context: server-resolved household,
   self/target relation, target role/state, lifecycle and version/ownership conditions. A broad
   presentation hint never substitutes for target authorization. Unknown/missing context denies.
3. Authenticate and resolve current Membership/cutoff/revocation before protected reads. Use
   enforcement before external calls/writes. Lookup targets only under resolved household scope;
   preserve 404 non-disclosure and existing safe denial envelopes. Retain conditional persistence
   and guards so a race cannot invalidate an earlier decision silently.
4. Define broad capabilities and contextual `allowedActions` projections from the same policy.
   Only current returned keys select browser navigation/actions. Unknown additive keys are ignored;
   missing metadata grants nothing. Keep these hints and drafts in memory; never submit grants.
5. If retries return completed results, validate the server-owned caller/route/key/target/payload
   receipt first, then require `request.completed.replay`. This permits only returning a recorded
   result. It cannot repeat Cognito, create data or mutate an absent target. Partial/foreign/
   mismatched receipts cannot succeed. Current inactive/stale/inconsistent principals cannot replay.
6. Update the matrix, API and threat model and add table-driven policy cases plus real endpoint
   allow/denial, cross-household/forged input, lifecycle and denial-before-side-effect tests.
   Exercise stale browser presentation, refresh, safe draft retention, focus, announcements,
   loading/disabled/error/session-loss behavior, all viewport ranges, reflow and zoom.

Directory repository reads now supply scoped domain records, including inactive rows needed by
internal cleanup. Only the central policy projects caller-visible entries. Role/state comparisons
remaining in storage code protect record shape or conditional transitions. Removal's enumeration
of active parents identifies cleanup partitions; it does not authorize a caller. Role and state
labels in the browser describe represented members; they do not decide action visibility.

## Migrated boundaries

- Household creation and current Membership; bootstrap completed replay is explicitly authorized.
- Self-profile read/versioned update, including actions on a missing first-login Profile.
- Family directory visibility and self/child/pending-parent action projection.
- Child creation/password reset/removal and completed creation/removal replay.
- Parent creation, guarded self activation and guarded resend/email replacement/cancellation.
- Own recovery-email read/staging with native provider verification unchanged.

Public authentication, JWT/session verification, registration-gate trigger, IAM and operator repair
retain their separate boundaries. No Todo, label, history or scheduler operation is implemented
by this change. All five active downstream changes carry the central extension requirement;
future child-associated entities must also extend the existing removal cascade.

## Compatibility and rollback

No data migration, persisted grant, new dependency, infrastructure change, provider permission or
production deployment is required by this refactor. Broad `capabilities` and profile action fields
are additive. Directory `allowedActions` replaces the old pending-parent enum with namespaced
keys; deploy/rollback client and handlers as a coordinated pair and reload old browser clients.
Unknown actions must never acquire a fallback meaning. A retained old application pair can ignore
additive fields; do not combine old clients with newly renamed target actions and claim parity.
Retain all revocation-aware repository/bootstrap checks and guards. Browser capability metadata
remains memory-only and is cleared with private session state.

Observation records registry keys and coarse allow/deny counts; request observation continues for
success and failure. No identity, arrays, context, receipt contents, target or contact values enter
policy metrics. Local build/test results are evidence of implementation only. Human release owners
retain authenticated planning, artifact publication, apply and live-provider verification.
