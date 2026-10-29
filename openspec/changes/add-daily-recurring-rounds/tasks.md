## 1. Recurrence Domain and Generation

- [ ] 1.1 Add separate daily RecurrenceTemplate records and ordinary Todo records carrying template/local-date round metadata plus missed/skipped outcomes; completion: the existing one-off Todo test suites remain unchanged and passing.
- [ ] 1.2 Implement parent template create/edit/remove APIs; completion: creation starts next day, edits/removal leave current generated Todos unchanged, removal prevents future generation, and history retains template identity.
- [ ] 1.3 Implement idempotent server-side daily generation and timezone-aware rollover; completion: repeated runs create one Todo per template/local date without requiring a user login.
- [ ] 1.4 Implement current-round-only reconciliation with no elapsed backfill; completion: a multi-day gap produces only the current Todo when service resumes.
- [ ] 1.5 Implement ordinary active-generated-Todo edit/delete behavior, Archive-as-irreversible-skip, due-edit and completed-reopen rollover detachment, and parent missed-to-completed correction; completion: detached Todos stay in the default active list, skipped/missed metadata edits fail, and deleting one round does not change its template.
- [ ] 1.6 Extend full child removal to assigned templates, generated Todos, recurrence history, and associated audit snapshots; completion: no generation or stored recurrence data remains for a fully removed child.

## 2. Routine Experience and History

- [ ] 2.1 Produce and review compact-first daily-template and generated-Todo reference states using `visual-design-foundation`, including create/edit/retire, current work, recurrence metadata, missed/skipped/completed history, detachment, correction, loading/empty, and generation failure/retry; completion: accepted hierarchy uses progressive disclosure and materially different wide composition without a separate child routine theme.
- [ ] 2.2 Add parent daily template management and generated-Todo controls; completion: retired templates preserve existing Todos, Archive records irreversible skip, any completed round can reopen as detached active work, and missed correction records parent/time.
- [ ] 2.3 Extend child active and history views for recurrence state; completion: rollover-bound prior missed/skipped rounds remain historical, eligible completed rounds can be undone into detached default active work, and children cannot alter missed/skipped outcomes.
- [ ] 2.4 Add chronological member-history MISSED status text/restrained warning plus generation failure, retry, loading, empty, and accessible state feedback; completion: status does not rely on color and no standalone trends or aggregation UI exists.

## 3. Verification and Operations

- [ ] 3.1 Add unit and integration tests for next-day activation, timezone/DST boundaries, idempotency, current-only reconciliation, template retirement, generated-Todo edits/deletion, due/reopen detachment, missed correction, Archive-as-irreversible-skip, child-removal cascade, and cross-household authorization; completion: duplicates and unauthorized changes fail safely.
- [ ] 3.2 Add privacy-safe generation logs using existing metrics and document low-cost operator diagnosis; completion: current generation failures are diagnosable without provisioning paid monitoring resources.
- [ ] 3.3 Add Playwright and accessibility coverage for current versus historical routine views; completion: keyboard and screen-reader interactions pass.
- [ ] 3.4 Capture and manually review template, current, missed/skipped/completed, detached, empty, and failure states at compact, medium, wide, 320-pixel reflow, and 200-percent zoom; completion: generated work retains ordinary Todo hierarchy, history stays chronological and calm, and correction/retirement feedback does not use celebratory motion.
- [ ] 3.5 Run all required quality checks; completion: format, lint, typecheck, unit, integration, build, Playwright, and accessibility checks pass.

## Central authorization integration

- [ ] Register each delivered protected operation in the shared capability registry and central policy with explicit principal, trusted context and lifecycle rules; update the authorization matrix, response capabilities/actions and policy plus endpoint-negative tests, including denial before side effects and completed-replay boundaries. Completion: no feature-local role/state authorization or client-supplied grant is introduced.
