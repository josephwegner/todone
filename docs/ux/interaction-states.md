# Interaction States

## State model

Every data-backed surface distinguishes the state of its read and mutation. A generic spinner over stale or unknown content is not sufficient.

| State | Required behavior |
| --- | --- |
| Initial | Show the page structure and stable loading region without presenting stale private data as current. |
| Loading | Name what is loading, reserve ordinary layout space, and keep unrelated navigation usable. |
| Loaded | Render confirmed authorized data and its last requested filter/context. |
| Empty | Explain that the authorized set contains no items and show only actions available to this actor. |
| Filtered empty | State that no authorized items match and provide a clear-filter action. Do not imply no household data exists. |
| Refreshing | Keep confirmed data visible, identify refresh progress non-intrusively, and prevent duplicate refresh requests. |
| Submitting | Keep entered values and context visible, label progress, disable duplicate submission, and keep safe cancel/navigation behavior explicit. |
| Success | Update only from server-confirmed state, announce the outcome, and place focus where the next task remains clear. |
| Validation error | Preserve allowed values, show field errors and a focused summary, and make correction possible without re-entry of unrelated data. |
| Recoverable error | Keep last confirmed data or form values, give safe plain-language guidance, include a retry action, and expose a request ID when support correlation is useful. |
| Conflict/already changed | Present current authorized state, explain that another action changed it, and offer refresh or an action valid for the new state. |
| Forbidden/not found | Do not disclose cross-household existence. Remove inaccessible private state and provide a safe route back. |
| Session expired | Stop protected activity, clear private state, announce the sign-in requirement, and do not auto-replay secrets or mutations. |
| Disabled | Make unavailability perceivable in appearance and semantics and explain prerequisite context in persistent text when needed. |

## Read surfaces

Initial loading uses skeletons only when their geometry matches final content; otherwise use a labelled progress region. Skeletons are hidden from assistive technology and paired with loading text. A normal load does not shift the page's primary controls.

An empty state is based on a successful response, never on a failed or pending request. Permission failures do not masquerade as empty household lists. Refresh failures retain last confirmed content with stale/retry language unless the session or authorization can no longer be trusted.

## Forms

- A form begins `idle`, may become `validating`, then `submitting`, and resolves to `success`, `validationError`, `conflict`, or `recoverableError`.
- Only one submission is in flight. Pressing Enter and activating the submit button cannot create duplicate operations.
- Client validation improves feedback; the server repeats all security and domain validation.
- Recoverable failures preserve non-secret values. Passwords and setup secrets remain only in the current in-memory control when a direct retry is appropriate and are cleared on success, cancellation, navigation, or session loss.
- Success does not rely on a disappearing toast. The destination state or persistent status confirms the result.
- Cancellation while idle or after a recoverable failure returns to the invoking surface without a write. If confirmed server state changed, cancel does not pretend to undo it.

## Mutations and optimistic behavior

Todone does not display a Todo, member, label, or lifecycle transition as successfully changed until the server confirms it. The UI may show immediate pressed/busy feedback, but the prior confirmed state remains semantically true.

Every versioned mutation sends the version last read. On conflict, the server's current safe state replaces stale state only after the client identifies the change to the user. Last-write-wins and silent form reset are prohibited.

Idempotent retries reuse the original idempotency key. A retry with materially different non-secret
input uses a new key. The UI never generates multiple keys for duplicate activation of one
in-flight operation. Password reset does not persist an idempotency value derived from the password
and is not automatically replayed after an uncertain response; the user makes a new explicit
submission. A Cognito/application split result is not presented as recoverable by ordinary retry.

## Focus after list changes

- Completion success: focus moves to the next actionable Todo; if none remains, focus moves to the list heading or empty-state heading. A live region announces completion.
- Failed completion: focus remains on or returns to the Todo action, and the Todo remains active.
- Archive/delete success: focus moves to the next item or list heading. Delete confirmation returns focus to the invoking control on cancellation.
- Filter change: focus stays on the filter unless the user explicitly chose a result-navigation action; the result count/status is announced.
- Route-level error: focus moves to the error heading or summary.

## Authentication states

The foundation form implements signed out, submitting, invalid credentials, network failure, retry, and signed in. The production flow additionally supports registering, duplicate username, invalid setup secret, registration closed, email verification pending, recovery initiated, password reset, restoring session, membership required, and signed out.

Credential errors do not identify whether username or password was correct. Setup-secret failure does not echo the submitted secret. Session restoration reserves shell space and does not flash private or signed-out content before resolution.

## Destructive and security-sensitive actions

- Child removal and Todo deletion require a modal confirmation with target name/title, irreversible consequence text, and explicit confirm/cancel labels.
- Child password reset clearly identifies the child and never displays the submitted password after success.
- Parent peers never receive reset/removal controls; a forged call still receives server denial.
- A partial identity/application-data operation reports a generic failure and request ID. It does
  not offer an ordinary retry or invite repeated username reuse until operator repair completes.
- `membership: null` is shown only as first-parent household setup. Pending, inactive,
  credential-stale, and inconsistent states use activation, sign-in, or generic unavailable/error
  treatment and never imply that the user can create another household.
- Sign-out is available to every signed-in user and clears private screen state immediately after local session termination.

## Motion and timing

Completion feedback may animate only after confirmation. Reduced-motion mode presents the same outcome without non-essential movement. Status messages remain long enough to perceive or persist near content; no critical action depends on reacting before a timeout. Authentication and destructive confirmation do not auto-dismiss.

## Error language

Messages say what failed, whether a write was confirmed, and what the user can do next. They do not expose stack traces, AWS details, token claims, raw identifiers, another household's existence, or secret values. Examples:

- "We could not save this Todo. Nothing changed. Try again."
- "This Todo changed on another device. Review the current version before trying again."
- "Your session ended. Sign in to continue."
- "That item is unavailable. Return to your list."

## Verification checklist

For every new remote interaction, tests and review cover initial, loading, loaded, empty where applicable, submitting, disabled, success, validation, recoverable failure, retry, conflict where applicable, authorization loss, session expiry, keyboard focus, live-region behavior, reduced motion, and all three responsive ranges.

## Pending parent email verification

`/activate-parent` distinguishes password setup from email-attribute verification. Reserve a stable
status/error region for code delivery, invalid/expired codes, resend, disabled submission,
verification pending, stale destination, guard conflict, and uncertain request-ID outcomes.
Password setup success retains pending status. Activation success requires confirmed server
Membership. Guard conflicts refresh state before an explicit attempt; uncertain outcomes block
ordinary mutation retry and provide operator guidance. Never announce/display another member's
email or restore codes from history/storage. Preserve heading/error focus and clear secret inputs
on submission, navigation, sign-out, and generation changes. Test keyboard and screen-reader
behavior across compact/medium/wide, 320px reflow, zoom, and reduced motion.

## Invited-parent first-login Profile

Parent invitations accept username/email only and create no Profile. A pending or newly active
parent without a Profile is represented by username and state, omitting displayName/color; the
family directory remains available. Missing child Profiles still fail closed. After native email
verification and activation, `/profile/setup` requires that parent to choose their own name/color
through the existing self-only version-zero Profile API before family management. Cancellation
handles absent and legacy-present Profiles without granting peers profile-write authority.

## PR activation recovery correction

Welcome resend and change-email-and-resend privately read provider invitation eligibility under
the pending owner before mutation. Only enabled accounts awaiting password setup qualify.
After password setup, return safe WELCOME_SETUP_UNAVAILABLE conflict feedback without changing
email or retaining ownership; the invited parent finishes native verification themselves. A
read-only failure releases ownership. Definitive pure-resend invalid-state/throttling releases
ownership; unknown send outcomes and any email-update/resend split retain it for quiesced repair.
The status read never authorizes activation and provider fields do not enter directory responses.

Pending activation entry/restoration renews credentials and attempts the self endpoint without a
code. EMAIL_VERIFICATION_REQUIRED alone returns to code entry. Successful native verification
may consume a code before renewal/activation fails: explicit Retry activation renews and retries
self activation without replaying the code. Conflict refreshes authorized state without tearing
down the pending page or automatically looping mutations. Generation checks discard late results.

## Capability-driven shell and controls

| Capability state | Existing component anatomy and recovery |
| --- | --- |
| Resolving | SessionRoot/ProductionBootstrap reserve the existing loading region; no guessed navigation or target controls. |
| Allowed | App route links use broad capabilities; profile and directory controls use current represented actions. Keep parent family/create grouping and child My Todos priority. |
| Unavailable | Hide actions with no useful prerequisite explanation. Keep a disabled action only when persistent context explains a temporary prerequisite. |
| Stale after render | Never replay a mutation. Refresh current Membership plus affected resource after safe denial; clear unavailable target controls. |
| Denied/refreshed | Announce safe outcome in the existing status region; retain safe profile draft, clear passwords/codes, and focus the refreshed section heading when the invoking action disappears. |
| Refresh failure | Preserve permitted non-secret input with retry/error feedback; do not present old actions as current. |
| Session loss | SessionRoot clears private content and drafts; sign-in receives focus and a safe session-ended announcement. |

The shell stays continuous at compact width and uses existing design tokens and breakpoints. Role
and activation labels may describe members but never select controls. Profile setup receives
contextual actions even before a Profile exists. Capability strings and denial internals are not
user copy. Capability arrays remain memory-only, with no URL/history/storage authority.

Family header and member-row layout responds to the available content container width, so
enlargement retains stacked readable controls instead of activating an unsuitable viewport layout.
