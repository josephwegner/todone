# Next-agent handoff: family account management

## Implemented scope

`manage-family-accounts` now implements pending-parent creation, real SDK password challenge,
native email-attribute verification and self activation, guarded resend/change/cancel, private
parent recovery email, and confirmed child removal. Existing child creation/reset, profiles,
directory, canonical routing and session boundaries remain part of this change. The baseline feature
was committed at `7e0a4a4`; subsequent PR activation corrections are recorded below. No deployment,
artifact publication, Terraform apply, or production smoke occurred.

Activation requires a server-verified ID token with verified email matching the current private
salted binding. Password setup alone grants no household access. Both Membership copies change
atomically. Pending activation/resend/email/cancel share a conditional owner with no TTL or lease
takeover; uncertain outcomes retain ownership for quiesced operator repair. No administrative
operation marks an email verified. Recovery stages only email, with native verification and
renewal owning promotion; the old verified address remains until then.

The owner approved a temporary hash-only deleted-identity revocation marker on 2026-10-20.
Removal atomically marks Membership inactive and creates non-expiring revocation ownership,
runs every `childRemovalSteps` cascade entry (Profile and child-creation replay references), deletes
both Membership copies, deletes Cognito by immutable `sub`, then sets marker expiry to confirmed
deletion plus one-hour ID-token validity and 60 seconds of tolerance. Resolution and bootstrap
both enforce it. Success retains no raw child identity/application record; completion replay uses
only the hashed target. Pending cancellation deletes by immutable `sub` and uses the same token-bound marker. Profile writes
condition on active Membership so an in-flight write cannot recreate a removed Profile. Every
future Todo/history/recurrence entity must extend the registry and its failure tests.

## Infrastructure and rollback

Five additional Lambda artifacts/routes implement creation, activation, pending actions, recovery
email and removal. Only administration handlers use the existing pool-scoped privileged role;
activation uses the ordinary DynamoDB role. The build registry and Terraform outputs include all
functions. Both app clients explicitly configure one-hour ID tokens. Native verification and the
static welcome template distinguish the setup code from an email-verification code. Cognito uses
the built-in sender (50 messages/day); no custom sender, SES configuration or auth trigger is added.

The pinned shared table module lacked a TTL input. `terraform/modules/todone-data-table` vendors
that exact `family-paas` revision (`beb37ef0e19d896984cb3c16165b2307e38fdf31`) with only numeric
`expiresAt` TTL enabled. Its existing `module.table.aws_dynamodb_table.this` address, keys, name,
encryption, PITR and deletion protection are preserved in source. Review a fresh state-backed
plan for zero table replacement before any release; source preservation is not live-plan evidence.
Other external modules remain pinned. The lockfile adds the Linux checksum without changing
provider version. See `deployment-rollback.md` for the guard/revocation-aware rollback boundary.

Terraform 1.9.8 was downloaded to `/tmp/todone-terraform-bin/terraform` and verified against the
published SHA256SUMS. Backend-free initialization, recursive format, and provider validation pass.
State-backed backend initialization fails with no valid AWS credentials (`/tmp/todone-family-terraform-backend.log`),
so no current live plan exists. Earlier `/private/tmp` plan/artifact claims from the prior handoff
are historical and must not be used for this working tree. Never apply a placeholder-input plan.

## Verification and handoff

Run the canonical commands in `docs/testing/strategy.md`. Detailed local startup, role/state/route
journeys, expected outcomes and the distinction between automated, local and human-only evidence
are in `docs/testing/family-account-management-verification.md`. The documented startup/setup and
real-emulator three-test smoke passed on 2026-10-20. Emulator activation/recovery/reset explicitly
refuse unsupported security parity before mutation; never manufacture verified claims.

Final verification evidence is recorded below after the final run. Logs and screenshots in `/tmp`
and `test-results/` are transient local evidence, not durable release artifacts. The production
SRP browser suite uses synthetic HTTP interception and does not send mail or contact real AWS.

Operator repair commands and orphan classifications are in `family-account-repair.md`. Quiesce
all delayed writers before conditionally releasing an uncertain owner. Preserve fail-closed
Membership/revocation behavior during repair. Never print private input files or raw records.

## Remaining release gates

The OpenSpec checklist remains the source of completion status. State-backed Terraform plan,
actual browser 200% zoom/screen-reader and owner UX approval, and real Cognito delivery/staged-email
checks remain outstanding. A required-check failure blocks release; no task is silently deferred.
The release owner must publish reviewed artifacts and create/review a fresh full plan using the
real protected inputs after authorization. This handoff grants no deploy/apply/smoke authority.

## Local build configuration

The frontend build is a local production-mode compilation after emulator setup, so ignored
`.env.local` supplies development-only Cognito endpoints/IDs. It is verification evidence,
not an authorized frontend release artifact. A release owner must rebuild with the reviewed
release configuration; never publish this local-emulator frontend build. Lambda ZIPs contain
runtime configuration placeholders and are identified below without uploading them.

## Final verification evidence (2026-10-20)

- Format, lint and static typecheck passed. All 368 unit tests (48 files), 39 HTTP/integration
  tests (six files), frontend production-mode compilation and all 13 Lambda builds passed.
- `npm run verify-local` exits unsuccessfully at its final strict OpenSpec validation step:
  five items pass and seven fail on warning-level long requirements and placeholder Purpose
  text. These baseline documentation warnings remain a release gate; ordinary validation of
  `manage-family-accounts` is valid with nine long-requirement warnings. No validator was weakened.
- All 45 accessibility tests and all five real-SDK synthetic SRP/native-verification browser
  tests passed. The three real-emulator smoke tests passed after the activation privacy fix.
- Artifact canary scan includes browser files, Lambda bundles/catalogs and decompressed ZIP
  entries; no seeded private values, passwords or setup codes were found. Diff whitespace
  check passed, and changed files were reviewed for unrelated edits. No dependency was added.
- Terraform recursive format and provider validation pass. Backend initialization cannot find
  AWS credentials, so the current state-backed no-replacement plan is unavailable.
- Actual browser zoom, screen-reader/owner review and live Cognito delivery/staging remain
  human release evidence. Automated enlarged-text checks do not prove actual browser zoom.

Logs: `/tmp/todone-family-final-verify.log`, `/tmp/todone-family-final-e2e.log`,
`/tmp/todone-family-final-a11y.log`, `/tmp/todone-family-final-native.log`, and
`/tmp/todone-family-emulator-smoke.log`. The final ordinary browser suite passed all 250 tests across all five configured projects.
Representative synthetic screenshots under `/tmp/todone-family-browser-artifacts/` were reviewed
at compact, medium and wide widths; these transient files are not owner UX approval.
The real development stack started for verification was stopped after its smoke.

## Local Lambda artifact identifiers

These are unpublished ZIPs under `.lambda-build/`. Refresh hashes after any source edit and
use the build script's `sourceCodeHash` values when preparing separately authorized release
inputs; no existing tfvars or historical plan is current evidence for these builds.

| ZIP | SHA-256 |
| --- | --- |
| `activate-parent.zip` | `5f2853de406a342c59f2e40d894ad318ec6eb1cde958d6a3836b71c65e58e7e1` |
| `create-child.zip` | `1319d129d07f7d4b4edbc746c772284fd9d0f22560d66018ce1339fdf611481d` |
| `create-household.zip` | `3369b76b039930efdd5c25dce810f0f51003886254f78ba58d9e62cdd6a2f5f4` |
| `create-parent.zip` | `9b7d3c68a37556599859ed3a27ebe7955c55b581a152db1b7b77a89bd447c464` |
| `current-membership.zip` | `5d88048ba93e8fe128d8d83f907b982ed7354b724921e5199b1c29287f55c902` |
| `family-directory.zip` | `adf271c9ef23274bd0e7eb85a6a2cef6a5278db599084047d384a6d022a231d1` |
| `pending-parent-actions.zip` | `762f409b33266c9f2d3bc174f1a6b5587cf372ee4bdcccbd6cfeb770528fff46` |
| `pre-signup.zip` | `c1ab187db1498df46aabd4bf8d216b5c7d97da80f0b76d2e94f38febba2dca5d` |
| `profile.zip` | `8fa0c29e7241be4e7599d66e72a4da86f53c8162053c56deaea3e0f1c9439180` |
| `recovery-email.zip` | `f71edaf305d42ae5d192c2527992315780690eea29ace72d5803b1380d15c4a3` |
| `remove-child.zip` | `f1b98679efd257f6b0bb5bf9c32e8911db2fefcc208bea7a006a3e5bc30f6fd9` |
| `reset-child-password.zip` | `7848734b4db3905e426b503b62e6eaa5728dcc13507bb51af390c34eb9c0a51b` |
| `session.zip` | `a77ec3343c889ff9baddbf8463e717d327a21087a491583c0a2969d5d0d93509` |

## Checklist reconciliation

The current change is 33/37 tasks complete. This implementation completed 5.0a–5.5,
6.1, 6.3–6.4 and 7.4. Remaining: 6.2 (implemented removal/TTL source, missing live
no-replacement plan), 7.1–7.2 (actual zoom, screen-reader and owner UX review), and
7.3 (strict OpenSpec warnings and unavailable AWS plan). None is intentionally deferred
or approved as an exception. Real provider release checks remain explicitly human-owned.
The code is not described as release-ready, and the change has not been archived.

## Verification follow-up

Strict OpenSpec validation now passes all 12 items with zero warnings. Seven spec files were
restructured: long requirement introductions became concise introductions plus named acceptance
scenarios, preserving all 88 moved normative sentences verbatim; three placeholder Purpose
sections now describe their existing capabilities. No application requirement or runtime behavior
changed. The earlier strict-validation failure above is historical evidence, not a current blocker.
A fresh backend-initialization check still reports no valid AWS credential sources, and there is
no configured outbound AWS identity manifest in this workspace. The current plan gate remains
open; a connected AWS session/profile must provide backend-state and infrastructure-read access.
Never share credential values in chat. No plan was applied and no resource was deployed.

The owner review document now begins with six prioritized, executable checks and expected
outcomes. It distinguishes local unsupported operations from separately authorized real-provider
verification. Checklist tasks 6.2 and 7.1–7.3 remain open until their entire acceptance criteria,
including the AWS plan and human review, are satisfied. None is silently deferred.

The follow-up `npm run verify-local` passed completely: format, lint, static typecheck, 368 unit
tests, 39 integration tests, frontend build, 13 Lambda builds and all 12 strict spec validations.
The documented real local stack was restarted and its three-test browser smoke passed again.
It is intentionally left running on workspace port 3001 for the owner's review; local API and
Cognito run on ports 3002 and 9229. Its private log is `/tmp/todone-family-human-review-stack.log`;
smoke evidence is `/tmp/todone-family-human-review-smoke.log`. This supersedes the earlier
stopped-stack note for the current handoff. No deployment or infrastructure apply occurred.

## Local two-parent review seed

The owner-approved task 8.1 adds `npm run db:reset:local`. It wipes only ignored emulator data and
publishes an identity-bound local fixture manifest for two active parents and one child. See
`docs/testing/local-database.md` for exact credentials, clean reset/startup commands, expected
outcomes, SSH/listener refusal, and the separate persistence behavior of emulator identities and
in-memory application data. The normal native-verification gate remains unsupported and closed.
No fixture or development password enters frontend/Lambda builds; all 13 Lambda hashes remain
unchanged. The existing non-destructive `setup:local-cognito` interface is retained through a shared
loopback-only setup adapter. No dependency was added and no production resource was touched.

Verification passed: 385 unit tests (49 files), 39 integration tests, format/lint/typecheck, frontend
and 13 Lambda builds, and all 12 strict OpenSpec validations. The real-emulator seeded browser suite
passed for both parents and the child, including self-only profile writes, peer reset/removal denial
and unsupported recovery staging. All three existing local-auth browser tests also passed. Actual
reset runs proved a fresh pool and three-identity manifest, preservation of unrelated environment
entries, private manifest permissions and cleanup of temporary reset state. Reset correctly refused
an occupied development port before deletion. A final reset removed additional smoke identities;
all development ports (3001, 3002, 9229) were confirmed closed on IPv4 and IPv6.

Logs: `/tmp/todone-seed-final-verify.log`, `/tmp/todone-seed-browser.log`,
`/tmp/todone-seed-existing-smoke.log`, `/tmp/todone-seed-final-reset.log` and
`/tmp/todone-seed-busy-reset.log`. The local stack is intentionally stopped for the owner's SSH
bridge. The change is now 34/38 tasks complete; tasks 6.2 and 7.1–7.3 retain their existing AWS-plan
and human-review gates. No task was silently deferred, and no deploy/apply/archive was performed.

## Owner review corrections: invitation and child actions

Tasks 9.1–9.2 implement the owner's feedback. New-parent invitations collect exactly username/email;
the API rejects peer-supplied displayName/color and writes no Profile. A pending or newly active
parent without a Profile appears by username/state without a fabricated hue. Missing child Profiles
still fail closed. Cancellation supports missing and legacy-present Profiles. After native activation,
existing session guards require self-only `/profile/setup` before Family, including Back/reload/deep
links. The local `localparent2` fixture is active but unconfigured, so its first login exercises this
screen without provider email; API restart repeats its setup because application data is in memory.
First-parent/child fixtures remain configured, and ordinary pending verification gates stay closed.

Child password-reset navigation and removal mutation controls now share one responsive action group
with aligned centers and equal 44px target heights. Compact wrapping and semantics are preserved.
Representative compact/medium/wide screenshots were reviewed; automated desktop geometry asserts
center/height differences below one pixel. The reference and canonical API/data/UX contracts reflect
the revised first-login ownership. The two specific feedback items are implemented; prior manual
zoom/screen-reader and AWS release gates have not been assumed complete or waived.

Verification passed: `verify-local` (388 unit tests, 39 integration tests, builds and 12 strict spec
validations), 250 ordinary browser tests, 45 accessibility tests, five synthetic real-SDK activation/
first-profile browser flows, and both real-emulator suites (one seeded-household and three auth
smokes). The real seed smoke now completes the second parent's own Profile before testing peer
permissions. Artifacts were scanned for fixture passwords/email/setup-code canaries, and the Lambda
hash table above is refreshed for this contract change. Frontend builds still contain local verification
configuration and are not authorized release artifacts. No deploy/apply was performed.

Evidence: `/tmp/todone-review-verify.log`, `/tmp/todone-review-e2e.log`,
`/tmp/todone-review-a11y.log`, `/tmp/todone-review-activation.log`,
`/tmp/todone-review-local-seed.log`, `/tmp/todone-review-local-auth.log`,
`/tmp/todone-parent-review-browser/` and `/tmp/todone-parent-first-login/`.
The temporary development stack was stopped again for the owner's SSH bridge.
Current checklist: 36/40 complete; 6.2 and 7.1–7.3 remain open for the existing AWS-plan/human
acceptance gates. No unfinished task is intentionally deferred.

## PR #2 activation recovery corrections

Both new review findings at `7e0a4a4` are addressed. Pending welcome/email-and-resend now read
private provider invitation eligibility under the owner before mutation. Confirmed accounts
receive safe conflict feedback without a retained guard or email change. Definitive pure-resend
invalid-state/throttling and read-only failures release ownership; unknown mutations and
email-update/resend splits remain closed for quiesced repair. The existing privileged role adds
pool-scoped `AdminGetUser`; ordinary read/profile/self-activation roles do not gain this permission.
Provider references: [administrative creation](https://docs.aws.amazon.com/cognito/latest/developerguide/how-to-create-user-accounts.html)
and [AdminGetUser](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminGetUser.html).

A pending session renews and attempts self activation independently on entry/restoration. Only
server `EMAIL_VERIFICATION_REQUIRED` returns to native verification. After a consumed code and
renewal/conflict/network failure, explicit Retry activation avoids code replay; conflict refreshes
authority without rebuilding the pending page or automatically looping mutations. The server
current-email binding and captured session generation remain authoritative.

Verification for this correction:

- `npm run verify-local`: passed, including 406 unit tests (50 files), 39 integration tests,
  production frontend, all 13 Lambda builds, and 12 strict OpenSpec validations.
- `npm run test:e2e`: 250 passed across the configured browser/viewport projects.
- `npm run test:a11y`: 45 passed. Its pending-session fixture now supplies the entry proof check.
- `npm run test:e2e:parent-activation`: 20 passed, including real SDK/synthetic HTTP conflict,
  network and reload recovery, consumed-code no-replay assertions, and Axe on retry/profile states.
- Compact and wide activation-retry screenshots were inspected. Automated checks do not replace
  actual 200% zoom, screen-reader, owner UX, or live-provider release evidence.
- Terraform recursive format and provider validation passed. No state-backed plan, apply,
  deployment, production smoke, or live Cognito mutation was performed. The existing AWS-plan
  and provider-only gates remain open.
- Artifact canary scan covers browser/Lambda files and decompressed ZIP members. The hash table
  above reflects the rebuilt unpublished ZIPs.

Transient logs: `/tmp/todone-pr2-verify-current.log`, `/tmp/todone-pr2-e2e.log`,
`/tmp/todone-pr2-a11y-final.log`, `/tmp/todone-pr2-activation-current.log`.
Earlier failed/interrupted runs are superseded by these results. No real-emulator reset was
needed for this correction; local unsupported-verification behavior remains explicitly denied.

Checklist: 38/42 complete. Tasks 10.1 and 10.2 completed; 6.2, 7.1, 7.2 and 7.3 retain the
previous AWS-plan/manual/provider evidence gates. None is intentionally deferred. This correction
does not archive the change or claim release readiness.
