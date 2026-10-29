## Why

After labels establish lightweight organization, families can reduce repeated Todo entry with daily routines. The core need is predictable current work without yesterday's missed work pressuring children to mark it complete merely to clear the list.

## What Changes

- Add parent-managed daily recurrence templates that generate ordinary dated Todo records at local day boundaries, beginning the day after template creation.
- Standardize template lifecycle on create, edit, and remove; editing/removing a template affects only future generation and preserves already-generated and historical Todos.
- Keep previous rounds out of active lists and record generated Todos with completed, missed, or skipped outcomes.
- Treat Archive on a rollover-bound active generated Todo as irreversible `SKIPPED`; allow parents to correct a historical missed Todo to completed and otherwise use ordinary Todo edit/delete rules where the generated Todo's lifecycle permits.
- Detach a generated Todo from automatic rollover when its due date is edited or any completed round is reopened, allowing it to remain ordinary active work in the default list until resolved.
- Show missed generated Todos chronologically in member history with explicit status text and a restrained red warning, without a separate trends surface.
- Generate and reconcile current work server-side without requiring a user login; do not backfill elapsed generation gaps.

## Capabilities

### New Capabilities
- `daily-recurring-rounds`: Daily routine templates, occurrence rollover, and non-intrusive historical rounds.

### Modified Capabilities

- None. Recurrence generates ordinary Todo records and adds its occurrence outcomes within the new capability without changing the prerequisite lifecycle contract.

## Impact

- Post-MVP; depends on date-only Todos, history, and labels.
- Adds scheduled idempotent server-side generation, current-round reconciliation, and household-timezone logic.
- Extends full child-account removal to delete recurrence templates, generated Todos, recurrence history, and associated restricted audit snapshots for that child.
- Excludes weekly/monthly schedules, ordered routine checklists, notifications, points, and rewards.

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
