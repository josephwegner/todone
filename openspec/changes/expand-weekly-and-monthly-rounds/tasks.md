## 1. Schedule Model and Generation

- [ ] 1.1 Verify and record that daily recurrence is implemented, all required local checks pass, its approved deployment smoke process is complete, and the model is accepted; completion: no weekly/monthly implementation starts before the gate is satisfied.
- [ ] 1.2 Extend template validation and migration for `frequency`, weekly due weekday, and monthly due day, defaulting existing records to daily; completion: invalid combinations are rejected and existing daily templates remain unchanged.
- [ ] 1.3 Implement Sunday-start weekly generation keyed by template plus local Sunday date and monthly generation keyed by template plus local year-month; completion: repeated/concurrent runs create exactly one Todo per cadence period.
- [ ] 1.4 Implement Sunday/first-of-month generation, selected/clamped due dates, and independent monthly clamp recalculation; completion: new templates wait for the next boundary and March does not inherit February's clamp.
- [ ] 1.5 Implement future-only title/assignee/label/schedule/frequency edits and template removal plus current-period-only reconciliation; completion: existing generated Todos remain unchanged and elapsed periods are not backfilled.

## 2. Parent and Child Experience

- [ ] 2.1 Produce and review compact-first cadence reference states extending the accepted daily routine patterns, including frequency selection, weekday/month-day controls, clamping and boundary explanations, future-only edits, retirement, generation failure, and history context; completion: accepted hierarchy uses plain-language summaries and materially different wide composition without cadence-specific themes or colors.
- [ ] 2.2 Add accessible weekly/monthly/frequency controls to routine management; completion: controls explain first-of-period generation, selected due dates, clamping, next-boundary activation, and future-only cadence changes by keyboard.
- [ ] 2.3 Extend current and chronological history presentation with weekly/monthly context and all daily loading, empty, failure, retry, reduced-motion, Archive-as-skip, due/reopen detachment, missed warning, correction, deletion, and tenant protections; completion: rollover-bound old rounds remain historical while detached reopened rounds return to the default active list.

## 3. Verification

- [ ] 3.1 Add unit and integration coverage for Sunday-start weeks, Sunday/year-month keys, mid-period creation, frequency changes, removal, current-only reconciliation, month lengths, clamp reset, leap years, DST boundaries, idempotency, isolation, Archive-as-skip, due/reopen detachment, correction, child-removal cascade for non-daily templates, and history access; completion: schedule edge cases are deterministic.
- [ ] 3.2 Add Playwright and accessibility coverage for cadence creation/edit/removal, next-boundary messaging, generation failures, and historical views; completion: configured browsers and all responsive targets pass.
- [ ] 3.3 Document and verify staged migration and rollback with existing daily templates; completion: rollback preserves daily behavior and generated Todo history.
- [ ] 3.4 Capture and manually review cadence creation/edit/removal, clamping, boundary, current/history, and failure states at compact, medium, wide, 320-pixel reflow, and 200-percent zoom; completion: schedule complexity remains progressively disclosed, text carries cadence meaning, and no calendar dashboard or decorative cadence treatment appears.
- [ ] 3.5 Run format, lint, typecheck, unit tests, integration tests, build, Playwright, and accessibility checks; completion: all required checks pass.

## Central authorization integration

- [ ] Register each delivered protected operation in the shared capability registry and central policy with explicit principal, trusted context and lifecycle rules; update the authorization matrix, response capabilities/actions and policy plus endpoint-negative tests, including denial before side effects and completed-replay boundaries. Completion: no feature-local role/state authorization or client-supplied grant is introduced.
