# Session-state reference review

Status: owner approved on 2026-10-19 ("Yep, views look good to me"). OpenSpec task 1.2 is complete. This reference does not implement application session behavior.

Open [the standalone reference](references/session-management.html). It uses the accepted forest/paper palette, system fonts, semantic control colors, wrapping actions, and continuous compact surfaces. State links are reference navigation, not proposed product navigation. Buttons simulate presentation without authentication, persistence, or API requests. All identity content is synthetic.

## Existing surface mapping

| Existing surface                                    | Controller-owned behavior and accepted anatomy                                                                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in, registration, confirmation, recovery/reset | Keep focused form hierarchy, persistent labels, field errors, safe-value retention, and secret clearing. Canonical routes and navigation remain links.                                 |
| Household setup / profile setup                     | Keep continuous compact forms and profile name/color semantics. Advance from confirmed results without restarting authentication.                                                      |
| Parent Family / My profile                          | Keep current navigation and destination-heading focus. Page reads retain their reserved loading region; background auth never replaces the page or resets a draft.                     |
| Child Todos / My profile                            | Keep role-appropriate links and current work-in-progress Todos content. Introduce no Todo actions.                                                                                     |
| Initial membership outcomes                         | Only unattached context offers household setup. Pending activation, inactive, inconsistent, and credential-stale outcomes remain distinct; none imply missing membership.              |
| Cold startup / account replacement                  | Neutral brand and reserved labelled region without previous-account identity, navigation, or private content. No minimum-delay timer.                                                  |
| Initial network / storage failure                   | Persistent error heading, safe explanation, Retry and Sign out in a deliberate action group. No guessed role, storage contents, raw provider errors, or private data.                  |
| Background failure                                  | Keep permitted page and safe draft; persistent quiet guidance and Retry only when action is needed. Routine renewal has no banner, spinner, announcement, focus move, or layout shift. |
| Definitive session loss / peer sign-out             | Clear old private content and drafts. Focus canonical sign-in heading and show generic ended/signed-out guidance.                                                                      |
| Legacy upgrade                                      | Explain the one-time explicit-sign-in transition on sign-in; never repeat on ordinary navigation.                                                                                      |

## Reference behavior to review

Retry shows a labelled pending state and prevents duplicate retries. Sign out stays available to cancel pending work. Initial blocking failure focuses its heading. Background Retry retains the field value and focus on the initiating control; routine renewal remains unannounced. A single polite result may announce recovery; avoid duplicate heading/live-region announcements. Session loss focuses sign-in after removing private content. Storage denial must not claim that peers have cleared if persistence/notification failed.

Long failure guidance and a long synthetic name exercise wrapping. Controls have at least 44px targets and visible focus. Compact pages are continuous; wider layouts bound line length. No state relies on animation or color. Reduced motion has the same content and immediate transitions. Review compact (390px), medium (820px), wide (1440px), 320px, and actual 200% browser zoom; text enlargement is not a substitute for browser zoom.

## Evidence and outstanding review

- Owner acceptance: approved on 2026-10-19 without requested adjustments, covering startup, storage/network error, retry/sign-out, quiet background guidance, session-ended, and migration anatomy.
- Automated reference checks: 15 passed in Chromium, Firefox, and WebKit using the temporary local smoke harness (`npx playwright test --config=/tmp/todone-session-reference.config.cjs`). The harness is disposable verification tooling, not application regression coverage. Each engine checked all seven states at 320, 390, 820, and 1440px with reduced motion, focused headings, no horizontal overflow, no script errors, no fetch/XHR requests, and no axe violations (84 state/viewport/engine scans). Interaction checks covered duplicate-retry prevention, safe draft retention, retry focus, keyboard sign-out during pending retry, local field clearing, explicit storage-propagation warning, and no local/session storage writes. The first interaction run had an ambiguous test selector matching a hidden example field; the corrected full run passed all 15 cases.
- Reference screenshots are under ignored `test-results/session-reference/`. The narrow storage-error and wide background-error screenshots were visually inspected for wrapping, continuous compact surface, action spacing, and readable long content. These show the reference, not implemented session behavior.
- Implemented screenshot/keyboard and local-auth evidence is recorded below. The owner subsequently confirmed the requested manual checks and accepted the result in Firefox on macOS; see the manual review record below.

## Slice verification — 2026-10-19

The documented `npm run dev` command was run with `--host 127.0.0.1 --port 3098 --strictPort` and the browser smoke exercised the served reference. While that server is running, open [the local preview](http://127.0.0.1:3098/docs/ux/references/session-management.html#storage). The HTML can also be opened directly without a server. Use the state links to inspect each example; Retry disables repeated activation until the explicitly labelled reference control finishes it, and Sign out clears the synthetic fields and focuses Sign in. These controls simulate outcomes and do not test a provider or cross-tab propagation.

`npm run verify-local` stopped at `format:check`, reporting 12 pre-existing `.agents/skills/*/SKILL.md` formatting warnings. Those files were not edited. Separate `npm run lint:check`, `npm run typecheck`, `npm run test:unit` (247 passed), `npm run test:integration` (28 passed), `npm run build`, and `npm run build:lambdas` passed. Local HTTP/browser/tsx IPC operations required running outside the process sandbox after EPERM failures; the final integration/browser/build-only runs passed. `openspec validate rearchitect-session-management --strict --no-interactive` passed. Explicit Prettier checks of the new ADR, review document, and reference passed; `git diff --check` passed for the tracked slice edits. Existing unrelated workflow and visual-foundation archive changes were preserved.

Full application end-to-end/accessibility suites, emulator/local-auth smoke, actual browser zoom, and screen-reader speech have not been rerun for this documentation/reference slice. They remain required implementation tasks. No new application behavior, provider configuration, production infrastructure, or deployment was introduced.

Review decision: owner accepted the startup, recoverable storage/network error, quiet background guidance, and session-ended anatomy on 2026-10-19. See the current implementation evidence below; the later manual review is recorded separately below.

## Implemented UI review — 2026-10-20

Actual application error/retry screenshots were visually inspected at compact, medium, wide,
and 320px. The narrow inactive-access surface wraps its full explanation, retains continuous
page treatment, and keeps Retry and Sign out visible without overflow. The medium surface
bounds line length. The wide pending-Retry surface retains its error heading/guidance, disables
Retry with a clear label, and keeps Sign out enabled. Screenshots are generated in the ignored
`test-results/e2e-bootstrap-*` directories; they contain synthetic data only.

Browser regressions check destination-heading focus, keyboard recovery, reduced motion,
320px reflow, long directory/form content, no focus/input/layout change during silent renewal,
and clearing private drafts after identity loss. Axe checks pass for pending/inactive recovery.
The real emulator smoke covers parent onboarding, child return visits, renewal, and shared logout.
Detailed test results and limits are in `docs/testing/session-management-verification.md`.

### Manual review procedure and owner result

Use the implemented app at `http://localhost:3001` while `npm run dev:full` runs. Startup and
real-emulator smoke have already been exercised before this handoff. Use synthetic local accounts;
do not record passwords, codes, tokens, or private identity values in evidence.

1. Set actual browser zoom to **200%** using the browser's zoom control. Check sign-in, the
   parent profile form, Family, and session recovery with keyboard-only navigation. Expected:
   readable wrapping, no horizontal page scroll, visible focus and reachable action controls.
   CSS text enlargement and a 320px viewport are separate automated checks, not this result.
2. With a screen reader, check actual spoken results.
   Check canonical destination headings after navigation, one understandable startup/error
   explanation, labelled pending Retry, and Sign out while Retry is pending. Expected: no old
   identity after logout, no focus trap, and no duplicate routine-renewal announcement.
   A valid existing session plus developer-tools request blocking for
   `/api/v1/memberships/current` can exercise startup recovery on reload without changing auth
   policy. Remove the block after checking recovery. Use network throttling to inspect pending
   startup; do not paste tokens or alter authorization checks.
3. Confirm return visits and peer logout with two tabs. Expected: the same account restores;
   explicit logout removes private content in both tabs, and protected Back/reload stays signed
   out. To inspect routine renewal during assistive-technology review, the real local-auth test's
   renewal step expires only cached expiry metadata and calls the actual emulator refresh path;
   it does not forge or relax JWT validation. Automated silent-renewal evidence is recorded separately from the owner’s manual review.

Owner result: the owner reported performing the requested actual 200% zoom and screen-reader
checks, identified Firefox on macOS, and accepted the result without reporting issues. This is
owner-reported manual evidence, separate from automated checks. Task 5.2 is complete; no manual
check was deferred.
