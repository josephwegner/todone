## Why

The initial completion loop needs controlled correction and durable history. Parents must be able to fix, archive, restore, and deliberately delete work without children completing old items merely to remove them from view.

## What Changes

- Add parent editing, archive, restore, and deletion for Todos.
- Add the first parent-visible completed/archived history and own-history for children, including child undo of their own completion and parent reopen through the same state transition.
- Preserve the state held immediately before archival so restore returns active work to active and completed work to completed; overdue remains derived from date.
- Keep completed and archived Todo metadata immutable, resolve concurrent edits and lifecycle actions safely, and retain live profile identity while a member exists.
- Remove explicitly deleted Todos from all product views and history while retaining a full internal audit snapshot. Full child-account removal separately purges the child's associated records and audit snapshots.

## Capabilities

### New Capabilities
- `todo-lifecycle-history`: Parent-controlled Todo lifecycle and role-scoped historical records.

### Modified Capabilities

- None. The lifecycle and history behavior is fully specified by the new capability without changing the prerequisite completion contract.

## Impact

- Depends on the first family Todo loop.
- Delivers the crawl MVP's correction, archive, history, reopen, and deletion behavior without broadening the single-assignee contract.
- Adds `ARCHIVED` and deletion behavior but keeps recurrence outcomes out of scope.
- Explicit parent deletion is irreversible in the product UI; archive is the normal reversible removal mechanism. Deleted data remains accessible only as a restricted internal audit snapshot until an account-removal policy requires its purge.

## Required central authorization integration

Delivered protected operations must extend `shared/authorizationCapabilities.ts` and the central
policy. Register a stable key, eligible principals, trusted household/self/target scope and
lifecycle restrictions before implementation; do not recreate role/state authorization in
handlers, repositories or UI. Update the authorization matrix and add policy tables plus endpoint
security-negative/side-effect-order tests. Broad capabilities and contextual `allowedActions` are
server-produced presentation hints only. Preserve conditional writes, scoped queries and
non-disclosing denials. Completed retries require caller-bound completed-receipt decisions, never
new side effects against missing targets. Service/scheduler principals need an explicit separate
policy boundary and must not inherit user grants.
