## Why

As household work accumulates, parents need a lightweight way to group and narrow lists without prematurely introducing complex routine structures. Labels provide organization while preserving the established Todo lifecycle.

## What Changes

- Add household-scoped labels and allow one optional label per Todo.
- Allow parents to add, change, or clear labels on active and completed Todos while keeping archived Todos fully immutable.
- Suggest existing labels during Todo editing and allow parents to create a new trimmed, maximum-40-character label through the same flow; case-insensitive duplicates are rejected.
- Add accessible active-list and history filtering by label.
- Expose household labels as child filter options while featuring labels already used on that child's Todos; filtering never expands Todo visibility.

## Capabilities

### New Capabilities
- `todo-label-organization`: Household label assignment, suggestion, and filtering.

### Modified Capabilities

- None. Labels add a new organizational capability without changing the prerequisite lifecycle contract.

## Impact

- Depends on Todo editing and history.
- Delivers the crawl MVP's single-label organization and filtering without adding multiple labels or broader assignment modes.
- Labels are organizational metadata, not a recurrence, checklist, reward, or completion-state model.
- Success: a parent can label a Todo and meaningfully filter active and historical views without losing role boundaries.

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
