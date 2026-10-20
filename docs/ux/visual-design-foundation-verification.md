# Visual foundation verification

Status on 2026-10-19: 10/13 OpenSpec tasks complete. Completed verification tasks include 3.1 and 3.4; production-review correction 2.4 is also complete. Tasks 3.2, 3.3, and 3.5 remain incomplete; none are intentionally deferred. The product owner approved the visual changes and requested archive on 2026-10-19; the three unfinished verification items remain recorded below.

## Implementation and automated evidence

- Added role-specific shell navigation/current-route component coverage, plus presentation selection/cleanup tests for every canonical profile color.
- Browser checks cover authored profile text contrast, stable semantic action colors, public-route heading/keyboard focus, forced colors, reduced motion, 320px reflow, and 200% text enlargement. They retain child `/todos` landing and no-Todo-traffic/action assertions.
- Reflow tests exposed overflowing submit controls and family-grid intrinsic sizing. Shared controls now wrap within their container; the family grid can shrink and wrap long text.
- Screenshot review exposed profile-color labels overlapping adjacent options under enlargement. The shared picker now adapts column count to available space and wraps its contents. A text-range assertion checks that labels stay inside their options.
- Focus review found translucent rings too faint on paper. Input, action, and profile-option rings now use the solid authored focus color; a browser check enforces at least 3:1 ring contrast for sign-in fields/actions.
- `npx playwright test tests/e2e tests/a11y --workers=2 --reporter=line`: 145 passed across Chromium compact/medium/wide, Firefox wide, and WebKit wide. This includes 35 axe accessibility cases. The subsequently added focus-ring contrast check passed in all five configured projects, for 150 passing browser cases in total across the two runs. A preceding run had a WebKit family-heading timeout while sources were changing; the final unchanged-source rerun passed without retries or weakened assertions.
- Format, lint, typecheck, 243 unit tests, 28 integration tests, frontend production build, and build-only Lambda packaging passed. No production action was performed.
- The documented `npm run dev:cognito`, `npm run setup:local-cognito`, and `npm run dev:full` commands were exercised. `npm run test:e2e:local-auth` passed: parent onboarding, child creation, an explicitly unavailable local reset with no password change, sign-out, and child sign-in to `/todos`. Existing emulator security/parity limits in `docs/testing/strategy.md` still apply.

## Visual review

Real implementation screenshots are captured by the browser journeys under ignored `test-results/`. No reference-only Todo behavior was added. Compact family rows remain continuous, navigation has a visible current-route outline, profile options retain text/radio semantics, and the pre-Todo child page remains explicitly work in progress.

Reviewed screenshots include compact family/child, medium profile setup, enlarged 320px profile/family, and the wide/320px auth/bootstrap captures. No visible clipping or overlapping profile labels remains after the reflow fixes. Text enlargement is supplementary evidence; it does not certify actual browser zoom. Ordinary route/status regions retain their reserved space; no dedicated layout-shift trace was captured.

## Motion and accessible semantics

A local browser probe exercised color selection, field focus, keyboard input, and scrolling on `/profile` at 390px and 1440px in all three browser engines. There were zero running ambient animations at rest. Over approximately 0.8 seconds per sample, focus remained on the display-name input; measured frame intervals were:

| Engine | Compact p95 / maximum | Laptop p95 / maximum | Long-task observation |
| --- | --- | --- | --- |
| Chromium | 16.7 / 16.8 ms | 16.8 / 16.8 ms | No long tasks reported |
| Firefox | 17.28 / 17.38 ms | 17.28 / 17.32 ms | API unsupported |
| WebKit | 17 / 17 ms | 17 / 17 ms | API unsupported |

Reduced motion resolves the profile-preview transition duration to 0.000001 seconds in all three engines. These are headless local browser measurements, not physical iPhone/iPad or battery benchmarks. No continuous ambient effect needs optimization in the delivered foundation. Completion-effect profiling remains owned by the first real Todo slice.

The profile accessibility tree was inspected through Playwright in each engine: the display-name field, named profile-color radio group/options, save action, and cancel link are exposed. Automated keyboard/focus, contrast, axe, and forced-colors checks passed. This does not replace screen-reader speech/announcement review.

## Production-owner feedback and corrections

The owner reviewed the real app and reported that the aesthetics otherwise look good. Two requested corrections are now implemented:

- The child `/todos` work-in-progress page has a keyboard-accessible Sign out button using shared secondary-control styling. Local credentials, profile tone, membership presentation, and any pending route handoff are cleared through the shared fail-safe sign-out helper, including SDK-cleanup failure. The route is replaced with sign-in. Guarded history/reload cannot restore private content without authentication.
- The router previously restored the session and fetched membership/profile, then a newly mounted bootstrap component repeated the same work and displayed “Restoring your private session…”. The component now consumes the successful guard result once, in memory. Every new navigation still checks current authorization. A resolution version discards stale in-flight results after a newer navigation or sign-out. Page-specific directory loading and recoverable errors retain their existing behavior.

The latest full browser/accessibility run passed all 150 cases. The child regression observes DOM changes to exclude restoration flashes, asserts one profile read per navigation, verifies heading focus, and exercises sign-out, Back, and reload. The final child journey passed again in all five browser projects after the cancellation refinement. Compact and wide screenshots of the new control were reviewed. Aggregate verification passed 246 unit tests, 28 integration tests, frontend build, and build-only Lambda packaging before the unchanged OpenSpec executable failure. The final cancellation refinement passed 27 targeted unit tests plus repeated format, lint, typecheck, and frontend build. Your own development stack was left running; browser tests used their separate configured port.

No screen-reader speech or actual browser-zoom pass was inferred from the owner's general visual acceptance.

## Remaining gates

- Task 3.2: actual 200% browser zoom and final human visual acceptance remain outstanding. Review signed-out, onboarding, parent, and child routes using the journeys below.
- Task 3.3: screen-reader speech and live announcements need a named assistive-technology/browser review. Automated semantics and keyboard evidence are complete; no manual speech pass is claimed.
- Task 3.5: `npm run verify-local` passes through Lambda packaging, then fails at `npx openspec` with “could not determine executable to run.” OpenSpec is not a project dependency or globally installed; the CLI used for artifact work is the cached `@fission-ai/openspec` 1.14.3 executable. Invoking that CLI directly with `validate --all --strict --no-interactive` yields 4 passing and 7 failing changes/specs, solely from existing long requirement text and placeholder Purpose warnings. Approved requirements and unrelated changes were not rewritten to silence these warnings. The current change has five requirement-length warnings. Resolve the repository's CLI provisioning and baseline strict-validation warnings before claiming the aggregate command passes.

## Real-app journeys for product-owner review

Local startup and critical-flow browser smoke are verified as described above. Use the disposable local account from `docs/testing/strategy.md`; never use production credentials or treat emulator behavior as production enforcement evidence. The local stack serves the app at `http://localhost:3001` while it is running.

| Starting state | Route and actions | Expected result |
| --- | --- | --- |
| Signed out | Open `/sign-in`, follow registration and recovery navigation, then use Back/Forward. Tab through controls and submit invalid input. | One app heading, focused route heading, persistent labels, distinct Entry Code/account-password guidance, visible field error/focus, no secrets in URLs or history. |
| Local parent without a household/profile | Sign in; complete `/household/setup`, choose a profile name/color on `/profile/setup`, continue. | Heading focus follows each canonical route; household timezone remains explicit; profile choices pair names and radio semantics; successful setup reaches `/family`. |
| Active local parent | Open `/family`, inspect long names and pending-member text, visit My profile, change color, return and sign out. | Family/My profile remain navigation links with a clear current route. No unavailable Todo creation/history links appear. Profile atmosphere changes without changing action/error meaning; sign-out clears private presentation. |
| Active local child created by the parent | Sign in, open My profile, return with Back, reload `/todos`, and activate Sign out. | Landing is `/todos`, visibly work in progress, without fabricated Todos or completion controls. My Todos/My profile links remain available, with useful heading focus and no repeated restoration page. Sign out returns to sign-in and clears private presentation; Back/reload cannot recover a private page while signed out. |

Repeat the journeys at compact, medium, wide, 320px, and actual 200% browser zoom. Check visible focus, screen-reader labels/status, forced-colors where supported, and reduced motion. Record browser/device, assistive technology, outcome, and any limitations before marking tasks complete.
