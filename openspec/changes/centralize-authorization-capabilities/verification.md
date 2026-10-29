# Authorization capability verification

Local implementation evidence, 2026-10-28 (America/Chicago). No deployment, artifact publication,
authenticated Terraform plan/apply, AWS credential access or live-provider verification occurred.

## Implemented contract

The shared typed registry and pure central policy now control delivered household bootstrap/read,
self-profile read/update, directory visibility/actions, child creation/reset/removal, parent creation,
guarded pending-parent actions/self activation, and self recovery-email administration. Principals
come from verified identity and current matching Membership/cutoff/revocation state. Unknown keys,
incomplete/foreign context and invalid principals fail closed. Conditional writes and ownership
guards remain at persistence boundaries.

The owner-approved `request.completed.replay` decision preserves completed bootstrap, creation,
removal and pending-parent retries from server-owned caller/route/key/target/payload receipts.
It never repeats writes or Cognito calls. Tests cover successful replay after target deletion,
foreign/missing/mismatched receipts, and no repeated deletion.

Browser navigation and global controls use returned principal capabilities, including the
unattached bootstrap capability. Target controls use contextual namespaced `allowedActions`.
Unknown additions and missing metadata confer no presentation grants. Denial refreshes authoritative
context and affected resources, preserves safe profile drafts, clears secrets, announces recovery,
and focuses a useful heading. A failed refresh disables the denied action until Retry obtains
current state. No capability array enters a mutation body or persistent browser storage.

## Completed automated checks

| Check | Evidence |
| --- | --- |
| `npm run verify-local` | Passed format, lint, typecheck, 597 unit tests, 46 integration tests, production PWA build, 13 build-only Lambda artifacts and strict OpenSpec validation. |
| Final UI follow-up | `npm run build`, `npm run format:check`, `npm run lint:check` and the five cross-browser explicit-Retry focus checks passed after the final content-width layout/focus adjustment. |
| Chromium full e2e/a11y | 189 passed across compact, medium and wide using `CI=1 npx playwright test tests/e2e tests/a11y --project=chromium-compact --project=chromium-medium --project=chromium-wide --workers=4 --retries=0 --max-failures=1 --reporter=line`. |
| Firefox full e2e/a11y | 63 passed using the same scope with `--project=firefox-wide --workers=3`. |
| WebKit full e2e/a11y | 63 passed using the same scope with `--project=webkit-wide --workers=3`. |
| Bootstrap/capability follow-up | 30 passed across all five projects after carrying bootstrap hints through unattached state and adding failed-refresh recovery. |
| Final capability/layout matrix | 25 passed using `npx playwright test tests/e2e/capabilities.spec.ts --workers=4 --retries=0 --max-failures=1 --reporter=line --output=/tmp/todone-capability-zoom-verification`. Includes axe, current-route navigation, unknown-key handling, stale controls, safe drafts, refresh failure, reflow and enlargement. |
| Final Retry focus | 5 passed with `--grep 'denial followed' --workers=2 --output=/tmp/todone-capability-retry-focus`. |
| Native SDK activation adapter | 20 passed across all projects using `npx playwright test --config=playwright.parent-activation.config.ts --workers=1 --retries=0 --max-failures=1 --reporter=line --output=/tmp/todone-activation-verification-final`. |
| Secret scan | 75 built text/archive entries, 39,379,168 bytes scanned for test-secret canaries, AWS access-key shapes, private-key blocks and literal JWT shapes; no findings. Summary: `/tmp/todone-capability-secret-scan.json`. |
| OpenSpec | `openspec validate --all --strict --no-interactive`: 12 items passed. |
| Diff/scope | `git diff --check` passed. No infrastructure edits; Terraform validation is not applicable. |

Browser results above overlap intentionally: the final targeted runs verify the bootstrap,
failed-refresh, focus and enlargement changes after the full baseline suites. They are not additive
counts of unique tests. Playwright starts the documented local Vite webServer and uses synthetic
HTTP/service boundaries; it never targets production. Earlier combined runs were interrupted by
the environment and were replaced with completed bounded runs. One contended parallel activation
run failed onboarding; the unchanged assertions passed in isolation and in the complete serial
run, matching CI's single-worker execution. No assertions were removed or weakened.

## Screenshot and accessibility review

Manually inspected resolving, allowed, unavailable, stale-denied/refreshed, profile-draft and
session-loss captures at compact (390), medium (820), wide (1440), 320-pixel reflow and 200-percent
CSS enlargement. The screenshot helper captures every represented state at the principal viewport,
320px and 200% enlargement. Existing accessibility tests also cover portable text enlargement.
These are browser-rendered simulations, not physical-device or operating-system zoom evidence.

The expanded review found the viewport breakpoint keeping a family header/action row side by side
under enlargement. Family layout now uses a container query against actual available content
width. Re-reviewed enlarged allowed/refreshed/unavailable captures show readable stacked headings,
continuous compact lists, complete controls and no squeezed character columns. Normal compact,
medium and wide hierarchy remains unchanged. Focus assertions confirm heading recovery after an
action disappears and after Retry removes its banner. axe checks pass; response/status text never
exposes policy keys, denial internals or foreign target data. Sign-out clears navigation and drafts.

Final screenshots are untracked under `/tmp/todone-capability-zoom-verification/`; the committed
browser tests reproduce them. Earlier baseline captures remain under ignored `test-results/`.
No visual snapshots were accepted automatically.

## Extension and release handoff

See `docs/operations/authorization-capabilities.md` for the registry, extension checklist, migrated
endpoints, receipt boundary, compatibility and rollback. All five active downstream OpenSpec
changes require central-policy integration and policy plus endpoint security-negative tests.
Todo, label, history, recurrence and scheduler product behavior is not implemented early.

Capability fields are additive; the pending-parent action vocabulary is replaced by namespaced
keys and requires a coordinated client/server artifact pair and old-client reload. No persisted
grants or data migration exist. Retain revocation-aware repository/bootstrap checks during rollback.
Native provider delivery/verification and authenticated release actions remain the existing human
release-owner responsibilities; local service-boundary success does not claim those outcomes.
