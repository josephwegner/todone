## Why

Todone proves its core value only when a parent can assign a clear responsibility and a child can independently complete it. This is the first end-to-end household coordination loop.

## What Changes

- Allow parents to create a Todo with title, optional date-only due value, and exactly one household assignee.
- Show children only their own active Todos and parents each household member's active list.
- Allow the assignee or any parent to complete an active Todo. Completed Todos leave the child's active list; reversal is added with lifecycle/history in the next change.
- Persist completion actor and time for the later lifecycle/history view, with accessible live profile identity signals on current Todo surfaces.

## Capabilities

### New Capabilities
- `family-todo-completion`: Single-assignee Todo creation, visibility, completion, due status, and parent oversight.

### Modified Capabilities

- None.

## Impact

- Depends on household membership and family accounts.
- Defines the crawl MVP assignment contract as exactly one active household assignee; unassigned work and multiple assignees remain deferred.
- Adds active Todo records and a parent/child workflow, but excludes archive/history, labels, recurrence, unassigned work, and multiple assignees.
- Extends the child-removal cascade to delete every active or completed Todo assigned to the removed child.
- Success: a parent assigns one Todo and the child independently sees and completes it with the result persisted. Parent inspection of completed work is delivered by `manage-todo-lifecycle-and-history`.

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
