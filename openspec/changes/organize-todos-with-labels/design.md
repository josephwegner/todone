## Context

Todos already support parent editing and role-scoped views. Labels introduce household-local organization without changing lifecycle or assignment semantics.

## Goals / Non-Goals

**Goals:** one optional label per Todo, local suggestion, explicit duplicate handling, and safe filters.

**Non-Goals:** nested labels, multiple labels, multiple simultaneous label filters, label colors, label administration pages, label rename/deletion, labels as routine state, or cross-household reuse.

## Decisions

- Store a label record per household with a trimmed display name preserving entered case and a case-folded comparison key. Store only label ID on each Todo; do not snapshot label names.
- Create labels only through parent Todo create/edit to avoid a separate management surface.
- Reject creation when the case-folded key already exists, with an informative error and an explicit path to select the existing label instead of silently reusing it.
- Query label suggestions by case-insensitive normalized prefix from the caller's household.
- Permit label mutation on active and completed Todos because labels are organizational metadata; reject every mutation on archived Todos.
- Return all household labels as child filter options, compute labels used on that child's Todos so the client can feature them, and apply the selected single filter only after role-scoped Todo authorization.
- Render text label names as the primary indicator; optional styling is supplementary.

## Visual and UX Direction

- Reuse the form, Todo-row, metadata, and filter patterns from `visual-design-foundation`. Explore label suggestion, explicit creation, duplicate resolution, selection, clearing, filtered results, and filtered-empty states before implementation.
- Keep a Todo's label as compact secondary text rather than a dominant colored chip. Label names remain the primary cue; any tonal treatment is quiet, semantic-token-based, and never competes with due or completion state.
- Use one clearly labelled single-select filter with a visible clear action. Feature labels used by the current child through order and text, not through oversized or uniquely colored controls.
- Keep create-versus-select wording unmistakable in the suggestion surface and preserve keyboard focus as results change. A no-match state should invite explicit creation only for authorized parents.
- Review long label names, duplicate/case variants, no matches, filtered empty, loading/failure/retry, and all responsive targets on the implemented UI before completion.

## Risks / Trade-offs

- One label avoids multi-label query complexity but may be insufficient later; the model retains a label entity to allow a future expansion.
- Case-insensitive comparison prevents capitalization-only duplicates while preserving parent-entered display case.

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
