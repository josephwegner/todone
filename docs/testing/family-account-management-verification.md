# Family-account verification journeys

Use disposable local identities. The commands below run locally and authorize no deployment,
Terraform apply, artifact publication, or production smoke. See `strategy.md` for prerequisites.

## Start the real local application

For the owner-approved two-parent fixture, use `npm run db:reset:local` with all services stopped,
then `npm run dev:full`. Sign in as `localdev` or `localparent2` using the disposable credentials
in [local-database.md](local-database.md). Run `npm run test:e2e:local-seed` for real sign-in and
peer-authorization checks. This is an already-active local fixture, not email-verification evidence.
The setup sequence below is the original non-destructive alternative.


1. Run `npm run dev:cognito`.
2. In another terminal run `npm run setup:local-cognito` to initialize the development emulator.
3. Stop the standalone emulator, then run `npm run dev:full`.
4. Open `http://localhost:3001/sign-in`. Use the development-only account initialized by the
   setup command, or register a disposable parent with the configured local Entry Code.
5. Run `npm run test:e2e:local-auth`. Expected: all three tests pass. They exercise real local
   authentication, renewal, shared sign-out, child creation, explicit unsupported reset, pending
   parent creation/cancellation, and confirmed child removal. API household data is in memory;
   emulator identities persist in ignored `.cognito/db/`. Use unique disposable usernames.

These startup commands and the three-test smoke were run successfully on 2026-10-20.
The emulator cannot enforce native email-attribute verification or global sign-out. Activation,
recovery-email replacement, and child reset explicitly refuse unsupported behavior before the
security-sensitive mutation. Do not treat these refusals as successful AWS parity.

## Owner review: do these checks first

Use the running local app at `http://localhost:3001` and disposable accounts. The aim is to judge
clarity and usability and report surprising behavior; the automated suites already cover API
race schedules and record cleanup. Use a separate private window/browser profile for the child:
ordinary tabs intentionally share one account, so signing in as the child there replaces the parent.

1. **First-parent setup and profile.** Create a disposable household if needed, then choose a
   display name and color. Expected: profile setup is required before Family opens; the name and
   color are clear together. Change the name/color through My profile and return to Family.
   Expected: the current profile appears and the navigation marks the current section.
2. **Add a parent and cancel it.** From Family, use Add a parent. Try an empty form and a duplicate
   username before creating a uniquely named pending parent with a disposable email. Expected:
   errors identify the right fields; success returns to Family with a pending row and no email.
   Open Cancel pending account and dismiss it; the row must remain. Confirm cancellation on the
   second attempt; the row must disappear. No email delivery is proved by this local journey.
3. **Create and remove a child.** Create a disposable child; sign in as that child in the separate
   private window/profile. Expected: an honest Todo work-in-progress page, no parent settings.
   As the parent, open Remove child account. Expected: the right child, clear permanent-deletion
   wording, and initial focus on Cancel. Cancel first; the child must remain usable. Confirm on
   the second attempt; the row disappears. Refresh the child's private window: household access
   must be denied and a new household must not be creatable with that removed session.
4. **Navigation and privacy.** Fill an email/password/setup-code form, then Cancel, use Back and
   Forward, and reload. Expected: navigation does not repeat a write or restore sensitive inputs;
   no email, username, code or password appears in the address bar. With two parent tabs open,
   sign out in one; both must lose private content, including after Back or reload.
5. **Keyboard and actual zoom.** Repeat the parent form and child-removal dialog using only
   Tab, Shift+Tab, Enter and Escape. Expected: visible logical focus, focus stays in an open
   modal and returns on dismissal, Cancel changes nothing, and Escape cannot dismiss a running
   confirmed removal. Set the browser's own zoom to **200%** and inspect phone-sized, tablet
   and desktop layouts. Expected: every control and error remains reachable without clipped or
   overlapping text. This differs from the automated enlarged-text/viewport tests.
6. **Screen reader and visual judgement.** On the parent form, trigger validation, submit a valid
   form, and open/dismiss the removal dialog with VoiceOver, NVDA or your available reader.
   Expected: labels, errors, pending status, success and dialog purpose are understandable;
   identity/status never relies on color alone. Judge whether the text, spacing, profile colors
   and destructive wording are comfortable and unambiguous. Record the reader/browser used.

Local activation, recovery-email replacement and child password reset deliberately refuse unsupported
security operations. An explicit unavailable message is expected, and no password, verified email or
household authority should change. These are **not** tasks for you to troubleshoot locally.

For each finding, report the checklist number, browser/device, zoom, steps, expected result and
actual result. A screenshot helps for layout issues; keep passwords, codes and real contact data out
of reports. A concise “1–6 pass, except …” is enough; mark any untested reader/device explicitly.

## Executable local UX journeys

| Role and starting state | Route and action | Expected outcome and evidence |
| --- | --- | --- |
| New first parent, no household/profile | Sign in, create household, choose display name/color | Required profile setup precedes family management. No invented Todo actions. Automated ordinary browser coverage; local smoke creates missing household/profile. |
| Active parent | `/family`, follow Add a parent; submit unique username and disposable email only | `/family/parents/new` has labelled fields and inline validation. Success returns to `/family` with one pending row and no email. Back/Forward/reload never replay creation or restore email. Real local smoke plus synthetic browser coverage. |
| Active parent, pending row | Open Resend welcome email; Cancel, then reopen and Confirm | Cancel sends no write. Confirm shows success or an actionable safe error; concurrent/unknown operations cannot grant access. Automated browser and handler coverage. Real delivery is provider-only. |
| Active parent, pending row | Change email and resend; submit replacement | Both pending copies remain pending; only new-address proof can activate after completion. Uncertain outcomes block ordinary retry and require repair. Deterministic concurrent handler tests; provider delivery/retained claims need AWS evidence. |
| Active parent, pending row | Cancel pending account; Cancel, then Confirm | Cancel changes nothing. Confirm removes the pending identity and row only on confirmed success; active peers cannot be targeted. Real local smoke and browser/handler tests. |
| Pending parent | `/activate-parent`; enter username, one-time setup code, chosen password, then a separately labelled email-verification code | Password setup alone grants no household authority. Invalid code is actionable. Native verification plus renewed matching signed proof activates only the current self, then required `/profile/setup` collects that parent's own name/color before Family. Local emulator explicitly refuses verification. `npm run test:e2e:parent-activation` exercises the real SRP SDK with synthetic HTTP responses on port 3003; it does not contact Cognito or send email. |
| Active parent | `/security`; read own email and stage replacement | Old verified email remains displayed until native verification and token renewal complete. No peer/directory email access. Real local staging explicitly refuses without mutation; automated synthetic browser/HTTP/adapter coverage proves UI and command contracts. AWS retention/delivery is provider-only. |
| Active parent, active child | Child password route; submit replacement | Password guidance and field errors are accessible; unknown failure clears password and blocks ordinary retry. Local emulator refuses before changing password because global sign-out is unsupported. Successful provider cutoff sequence has deterministic tests. |
| Active parent, disposable child | `/family`; Remove child account; Cancel, then Confirm | Dialog identifies child and permanent deletion. Cancel receives initial focus and performs no write. Confirm removes application records and Cognito identity; stale JWTs cannot read or bootstrap a household. Three real local smoke flows, browser tests and failure-boundary tests cover this. |
| Active child | Sign in, open `/todos`, attempt `/family/parents/new` and `/security` | Honest work-in-progress Todo page; no parent controls or peer mutation; server denies child authority independently of router. Automated browser/HTTP coverage. |
| Any signed-in member | Edit own profile; navigate Back/Forward, reload, sign out from another tab | Safe profile drafts survive allowed navigation; sensitive forms clear on navigation/account loss. No private values enter URL/history. Automated multi-browser/session tests. |

## Human-only review still required

At compact (390px), medium (820px), and wide (1440px), review the canonical palette, long names,
current-route navigation, pending actions, focused forms, and destructive dialog against
`docs/ux/references/family-account-management.html`. Representative synthetic screenshots are
captured under ignored `test-results/` by the browser suites. Automated Axe checks and 320px
reflow/reduced-motion coverage are separate from manual accessibility approval.

Use the browser's actual 200% zoom, keyboard only (Tab/Shift+Tab/Enter/Escape), and a screen reader
on the same journeys. Expected: no lost controls or overlapping text, visible focus, dialog focus
contained and restored, errors announced, no identity/status communicated only by color. Actual
browser zoom and screen-reader review have not been performed by the implementation agent.
Enlarged CSS text or a smaller viewport is not evidence of actual browser zoom.

A separately authorized AWS release owner must prove actual invitation initial/resend delivery,
setup-code expiry/reuse, wrong/expired native email codes, changed intended address versus retained
old provider email, renewed verified ID claims, staged recovery-email promotion, and the configured
built-in sender quota (50 messages/day). Record evidence privately without codes/contact data.
Do not run these provider checks against production without separate authorization.

## PR recovery regression coverage

Handler tests cover post-password-setup resend and email-change denial without mutation,
definitive pure-resend rejection, read-only failure, uncertain resend, and email-update/resend
split ownership. Adapter tests use actual AdminGetUser commands and fail closed on absent state.
Component tests exercise a real session controller for consumed-code conflicts, network failures,
renewal failure, restored pending sessions, current-binding rejection, and late sign-out results.
The native SDK browser suite covers successful activation plus conflict/network/reload recovery
without resubmitting a consumed code, across all configured browser/viewport projects with Axe.
Actual provider invitation eligibility, the password-setup race, and native delivery remain
provider release checks; synthetic HTTP responses do not demonstrate live AWS parity.
