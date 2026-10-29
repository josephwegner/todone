# Data Model and Access Patterns

## Principles

- Amazon Cognito owns credentials and authentication attributes. DynamoDB MUST NOT store passwords, setup secrets, token values, or child recovery contact data.
- Cognito `sub` is the stable authenticated user identity. Username is immutable and globally unique but MUST NOT be an ownership key. Display name and profile color are mutable application data.
- Every application entity is owned by exactly one household unless it is a user-to-membership lookup required to find that household.
- Household IDs and all resource IDs are opaque identifiers. Possession of an identifier grants no authority.
- The server derives the caller's `sub` from a verified JWT, resolves active membership, and then uses the resolved household ID for all data access.
- All normal request paths use keyed `GetItem`, `Query`, transactional writes, or conditional writes. A table scan is prohibited for user-facing requests and authorization.
- Dates and recurrence round keys follow `docs/adr/0006-household-local-date-semantics.md`.

## Dedicated table

Todone uses one dedicated, on-demand DynamoDB table with string partition key `pk`, string sort key `sk`, encryption at rest, and point-in-time recovery enabled. Secondary indexes are added only for documented access patterns. The runtime role is scoped to this table and its indexes.

The following key families are canonical logical prefixes. An implementation may encapsulate serialization behind a typed persistence boundary, but it MUST preserve their ownership and query behavior.

| Item | Primary key family | Required attributes and invariants |
| --- | --- | --- |
| Household | `pk=HOUSEHOLD#<householdId>`, `sk=HOUSEHOLD` | Name, valid IANA timezone, created timestamp, version. |
| User membership lookup | `pk=USER#<sub>`, `sk=MEMBERSHIP` | Household ID, member ID, immutable canonical username and role, activation state, optional `credentialsValidAfter`, and creation timestamp. At most one household identity per `sub`. The cutoff has no duplicate copy. New writes include `createdAt`; the first-parent bootstrap lookup shape that predates it remains read-compatible. |
| Membership | `pk=HOUSEHOLD#<householdId>`, `sk=MEMBER#<memberId>` | Cognito `sub`, immutable canonical username and `parent` or `child` role, activation state, and creation timestamp. Username, role, and activation are deliberate directory/authorization copies and must match the lookup; credential cutoff is not duplicated here. |
| Profile | `pk=HOUSEHOLD#<householdId>`, `sk=PROFILE#<memberId>` | Mutable non-unique display name and palette color. No credential or recovery email. |
| Todo | `pk=HOUSEHOLD#<householdId>`, `sk=TODO#<todoId>` | Title, scalar assignee member ID, optional date-only due value, lifecycle, version, creation and completion metadata, optional label ID, and optional recurrence provenance. |
| Label | `pk=HOUSEHOLD#<householdId>`, `sk=LABEL#<labelId>` | Trimmed display name and case-folded comparison key, unique within the household. |
| Recurrence template | `pk=HOUSEHOLD#<householdId>`, `sk=TEMPLATE#<templateId>` | Future generation values, assignee, cadence, activation boundary, and retirement state. |
| Restricted deletion audit | Restricted key family not returned by product repositories | Full deleted Todo snapshot and metadata. Accessible only to an explicitly separate operator path and purged by applicable child-removal cascades. |

The logical prefixes do not permit direct string concatenation from unvalidated client values. Repository code validates identifier syntax and resolves ownership before building keys.

## Required access patterns

| Access pattern | Authorization and query requirement |
| --- | --- |
| Resolve current membership by JWT `sub` | Strongly read `USER#<sub>/MEMBERSHIP`, then the referenced Household and household Membership. Return a typed `UNATTACHED`, `ACTIVE`, `PENDING_ACTIVATION`, `INACTIVE`, `CREDENTIALS_STALE`, or `INCONSISTENT` outcome. Validate matching keys, IDs, `sub`, username, role, activation, required attributes, and token `iat > credentialsValidAfter`. Do not accept a household ID from the client as a substitute. |
| Activate a pending parent | By verified caller `sub`, strongly read the pending lookup and referenced pending household Membership, validate that both describe the same parent, acquire exclusive pending-account ownership, validate signed verified-email claims against the current private binding, and conditionally transact both activation copies from `PENDING_ACTIVATION` to `ACTIVE`. No client household/member/role/email value participates. |
| Bootstrap one household for an unattached user | Condition that no user lookup exists, and atomically or idempotently create Household, initial parent Membership, and lookup. Concurrent retries produce one household. Profile data is introduced by the later family-account capability. |
| Read household and current member | Use household ID obtained from the active lookup, then keyed reads. |
| List active household members | Query the household member key range; exclude inactive or partially provisioned members. |
| Read or update one resource | Build the household partition from resolved membership and issue a keyed read or conditional write. Cross-household identifiers return no resource data. |
| List a child's active Todos | Query an assignee-and-lifecycle projection scoped by household and member. The API substitutes the child's own member ID regardless of client input. |
| List parent-visible active Todos | Query household active projections, optionally narrowed to an active household member. Do not scan all lifecycle records. |
| List history | Query chronological household history for a parent or chronological own-assignee history for a child. Restricted deletion audits are excluded. |
| Transition or edit a Todo | Use a conditional write on current version and allowed lifecycle. A stale caller receives current safe state or a conflict response; last-write-wins is prohibited. |
| Reassign a Todo | In one transaction or one atomic item update, validate the target active membership and move the assignee query projection. |
| Suggest labels | Query a household-scoped normalized-prefix projection. Case-folded uniqueness is enforced with a conditional uniqueness item or equivalent transactional condition. |
| Filter by label | Apply the label to an already role-scoped active/history query or a household/member/label projection. A filter MUST NOT broaden the authorized base set. |
| Generate a recurrence round | Query eligible templates server-side and conditionally create at most one Todo for `(templateId, cadenceRoundKey)`. Generation does not depend on a user login. |
| Remove a child | First make Membership inactive so all sessions fail closed. Query every registered child-associated entity and audit projection without a table scan, delete the full deployed cascade and application identity records, then delete the Cognito identity and release username reuse only after the application cascade succeeds. |

## Query projections

Todo query projections MUST support these dimensions without scanning:

- Household plus `ACTIVE`, ordered deterministically.
- Household plus assignee plus `ACTIVE`, ordered deterministically.
- Household history in reverse chronological order.
- Household plus assignee history in reverse chronological order.
- The same authorized sets narrowed by one label when the label capability is delivered.

Projection sort keys SHOULD begin with a lifecycle bucket followed by a canonical sortable date or UTC timestamp and Todo ID as a tie breaker. An item changes projections as part of the same successful lifecycle write. Active and historical results MUST be non-overlapping.

Recurrence storage MUST support discovery of templates eligible for a server-side generation window and conditional uniqueness by template and round key. It MUST NOT iterate every table item. Daily keys use local `YYYY-MM-DD`, weekly keys use the local Sunday `YYYY-MM-DD`, and monthly keys use local `YYYY-MM`.

## Entity rules

### Identity and membership

- `sub` never changes for an existing Cognito identity.
- Username is an immutable canonical lowercase (`a-z`, `0-9`, `-`, `_`; 3–24 character) Membership copy used for display only where the product requires it. Cognito remains the global uniqueness authority; username is not a partition key for owned data.
- A self-registered unattached identity can create exactly one household. Later household accounts are parent-provisioned.
- Role is set when Membership is created and is immutable. Parent removal/demotion and role mutation are not supported.
- An inactive or deleted Membership fails authorization even if a previously issued JWT remains cryptographically valid.
- `credentialsValidAfter` is a UTC RFC 3339 instant stored only on the user-membership lookup. It is the canonical Cognito-identity session gate because every household request begins with that `sub`-keyed read. When present, a verified token without numeric `iat`, or with `iat` at or before the cutoff, resolves as `CREDENTIALS_STALE`; household Membership does not duplicate the value.
- Lookup and household Membership deliberately duplicate immutable username, immutable role, and activation state to support identity resolution and household directory access. Resolution validates equality rather than trusting either copy independently. Pending-parent activation changes both activation copies in one transaction.

### Todo lifecycle

The initial states are `ACTIVE` and `COMPLETE`; lifecycle/history later adds `ARCHIVED`, `preArchiveStatus`, and restricted product-deletion snapshots. Overdue is always derived from due date and household timezone, never stored as a lifecycle state.

Completion, edit, archive, restore, undo/reopen, and deletion use versioned conditional writes. Completion actor and timestamp come from server identity and time. Current member name and color are resolved from Profile rather than copied onto Todos.

Recurrence may add `MISSED` and `SKIPPED` outcomes only to generated Todos. Template identity and round provenance remain after a generated Todo is detached from rollover. One-off Todos do not acquire recurrence outcomes.

### Labels

A Todo stores zero or one label ID, never a label-name snapshot. A Label stores display case and a separate trimmed, case-folded uniqueness key. Label records are household-local even when another household uses the same text.

## Write safety

- Server timestamps are UTC RFC 3339 instants. Date-only fields are validated separately and are never converted from a client timestamp.
- Creation operations that can be retried after an uncertain response use an idempotency key or a deterministic uniqueness condition.
- DynamoDB-only multi-item invariants use `TransactWriteItems` or an equivalent conditional design. Cognito/DynamoDB split outcomes are not automatically repaired: they fail generically and remain operator-owned until manual cleanup.
- A client-supplied version is required for mutable versioned records. Conditional failure does not silently overwrite newer state.
- Repository return types distinguish not found, unauthorized, conflict, invalid state, and dependency failure without exposing cross-household existence.

## Deletion and recovery

Archive is reversible product behavior. Product deletion is irreversible in product APIs but may retain a restricted Todo audit snapshot. Full child-account removal is different: it first makes Membership inactive so stale sessions fail closed, then purges the child's identity-linked records, Todos, history, recurrence data, and restricted snapshots before the Cognito identity is deleted and the username is released.

Point-in-time recovery protects the table from accidental writes and deletion. A restore always creates a separate table and follows `docs/operations/backup-restore.md`; it does not bypass authorization or child-removal obligations.

## Change checklist

Every change that introduces an entity or query MUST document:

- Owning household and identity references.
- Primary key and every secondary projection it writes.
- Each read path and why it does not scan.
- Conditional, transaction, retry, and idempotency behavior.
- Cross-household and role-negative tests.
- Backup/restore implications.
- Whether the entity is child-associated and how full child removal deletes it and its audit data.

## Pending-account binding and operation ownership

The user lookup owns pending-only `emailBindingSalt`, `emailBindingDigest`, `pendingVersion`, and
optional `pendingOperationOwner`. Hash the length-delimited salt and exact intended Cognito email;
this private derived contact data is not anonymized and must never enter projections or telemetry.
Do not persist raw email. Creation writes matching pending Membership copies and binding version 1.
Email replacement updates the digest and increments that version only after confirmed Cognito
update/resend. Activation and cancellation remove binding metadata.

Guard acquisition transacts the pending parent/version checks on both copies and an absent-owner
check with ownership publication. All final writes/releases require that owner and version;
re-read target invariants before external calls. Ownership does not expire and has no TTL. A
failed/uncertain external call retains it until a quiesced operator repair. An old handler or
rollback must not bypass it. Missing binding/version denies legacy pending transitions. No
additional service, workflow engine, contact snapshot, or automatic repair is introduced.

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

The deployed child-removal registry is `childRemovalSteps` in
`lambdas/households/childRemoval.ts`. Every new child-associated storage type extends that registry
and its failure tests before release. Profile writes transactionally require an active household
Membership so a delayed write cannot recreate a removed child's profile. Reset/deletion targets
use immutable Cognito `sub` at the administration boundary to avoid mutating an unrelated new
identity when a deleted username is reused. Operator procedures must use the same identity rule.

## Invited-parent first-login Profile

Parent invitations accept username/email only and create no Profile. A pending or newly active
parent without a Profile is represented by username and state, omitting displayName/color; the
family directory remains available. Missing child Profiles still fail closed. After native email
verification and activation, `/profile/setup` requires that parent to choose their own name/color
through the existing self-only version-zero Profile API before family management. Cancellation
handles absent and legacy-present Profiles without granting peers profile-write authority.

## Capability derivation and scoped reads

No capability table, Membership grant attribute or data migration is introduced. Strong Membership
resolution supplies request-local principal scope and credential validity. Repositories supply
scoped domain records, not caller-specific visibility or action enums. The central policy projects
visible directory entries/actions and self-profile actions. Storage state/version/ownership checks
remain atomic concurrency invariants. Administrative replay lookup is caller/route/key-bound and
validates payload/target; only a completed matching result can feed a replay decision, without
re-running writes. Missing or foreign receipts never grant target access.
