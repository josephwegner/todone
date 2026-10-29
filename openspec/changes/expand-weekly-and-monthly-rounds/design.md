## Context

Daily recurrence has established template/generated-Todo, timezone, server generation, lifecycle, and history behavior. This change adds weekly and monthly cadence fields only after the daily model is implemented, verified, deployed through its approved process, and accepted.

## Goals / Non-Goals

**Goals:** Sunday-start weekly and calendar-month schedules with first-of-period generation, selected due dates, predictable short-month behavior, and cadence-specific idempotency.

**Non-Goals:** arbitrary intervals, multiple days per schedule, exception calendars, elapsed-period backfill, or editable missed/skipped history.

## Decisions

- Add `frequency`, `weekday`, and `dayOfMonth` schedule fields with frequency-specific validation.
- Calculate weekly periods as household-local Sunday through Saturday. Use the Sunday start date as the weekly round key, generate Sunday morning, and set the selected weekday as due date.
- Calculate monthly periods by household-local year/month. Generate on the first morning, set the configured day as due date, and clamp an unavailable day independently to that month's final day.
- Newly created templates wait for the next boundary. Edits, cadence changes, and removal affect future generation only and never rewrite an already-generated Todo.
- Reuse daily recurrence lifecycle, tenant isolation, current-only reconciliation, accessibility, failure, and history behavior. Do not backfill elapsed weekly/monthly periods.
- Inherit Archive-as-`SKIPPED`, due-date edit and completed-reopen rollover detachment, and chronological `MISSED` text/restrained warning behavior without adding a trends surface.
- Keep server generation independent of login and use conditional writes on template plus period key.

## Visual and UX Direction

- Extend the accepted daily-template and generated-Todo patterns from `visual-design-foundation`; cadence choice should add progressive schedule fields, not create separate daily, weekly, and monthly visual systems.
- Explore frequency selection, weekly weekday, monthly day/clamping explanation, next-boundary activation, future-only edits, retirement, generation failure, and history context before implementation.
- Show the schedule summary in plain language close to the affected controls and in compact secondary metadata on generated work. Explain short-month clamping and next-period activation when relevant without placing permanent instructional paragraphs on every template row.
- Keep cadence and missed/skipped outcomes readable through text and stable hierarchy. Do not add calendar dashboards, charts, trends, decorative day illustrations, or cadence-specific colors.
- Review month-length, leap-year, boundary, frequency-change, loading/error/retry, reduced-motion, long-content, 320-pixel reflow, 200-percent zoom, and compact/medium/wide compositions on the implemented UI before completion.

## Risks / Trade-offs

- Monthly clamping means a “31st” schedule occurs on different numerical days; it is more predictable than missing a month and is explicitly visible in the UI.
- Frequency-specific edge cases increase test surface, especially around timezone and calendar boundaries.

## Migration Plan

- Treat existing templates without a frequency field as `daily` before introducing weekly/monthly creation or cadence editing.
- Deploy read/write compatibility for frequency and cadence fields first, then enable the new scheduler paths, then enable UI controls.
- Rollback disables weekly/monthly creation and scheduling while preserving existing generated Todos and daily behavior. Templates already using a non-daily cadence remain readable and may be removed, but no new rounds are generated until the feature is restored.

## Child-removal extension contract

Register every child-associated record/history/audit type introduced here in
`lambdas/households/childRemoval.ts` (`childRemovalSteps`) and add deletion and partial-failure
coverage before this capability is complete. Keep profile/lifecycle writes conditional on active
Membership so late writers cannot recreate purged data. The approved hash-only revocation marker
blocks stale-token bootstrap after lookup deletion and expires after confirmed Cognito deletion
plus configured token lifetime/tolerance; never retain raw removed-child identity or snapshots.

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
