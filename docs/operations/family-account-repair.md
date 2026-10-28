# Family-account partial-outcome repair

These are operator procedures, not automatic recovery or application UI. Do not execute them
without separately authorized access to the specific pool/table and approval for the selected
repair. Agent verification does not authorize production writes. First stop affected endpoints and
wait for every Lambda invocation, retry, and delayed Cognito request to settle. Keep guards and
non-expiring revocation markers until that is established; a timeout or expired lease proves
nothing about an external operation's completion.

## Private inputs and evidence

Use an operator-owned directory outside the checkout with mode `0700`; input/evidence files must
be `0600`. Disable shell tracing and terminal recording. Construct JSON inputs in a private editor,
not command arguments/history. Never print credentials, codes, email, username, `sub`, household
identifiers, names, profile values, raw DynamoDB records, or raw AWS errors. Do not upload these
files to tickets, repository artifacts, or shared logs. Remove private evidence after the approved
repair according to the operator's data-handling policy.

Select the exact configured AWS profile/region explicitly. `UserPoolId`, `TableName`, and immutable
identity `sub` come from the authorized private case; a reused username is never the deletion or
password-reset target. The `Username` parameter for existing-user read/update/delete/password
operations uses that immutable `sub`. Do not select an account by display name, email, or a
public username conflict alone.

The examples below show input filenames only. Prepare their JSON contents privately with the
AWS CLI schema for each command. Redirect stderr to private `aws-error.json`; report only a
reviewed generic failure category and the application's safe request ID, never `cat` that file.
Do not use `--debug`, SDK request logging, or CLI pager output containing records.

```sh
aws cognito-idp admin-get-user --cli-input-json file://identity-read.json \
  --query '{status:UserStatus,enabled:Enabled}' --output json --no-cli-pager 2>aws-error.json
aws dynamodb get-item --cli-input-json file://lookup-read.json \
  --query '{present:Item!=`null`,role:Item.role.S,state:Item.activationState.S}' \
  --output json --no-cli-pager 2>aws-error.json
aws dynamodb get-item --cli-input-json file://member-read.json \
  --query '{present:Item!=`null`,role:Item.role.S,state:Item.activationState.S}' \
  --output json --no-cli-pager 2>aws-error.json
aws dynamodb get-item --cli-input-json file://profile-read.json \
  --query '{present:Item!=`null`}' --output json --no-cli-pager 2>aws-error.json
```

All DynamoDB read inputs use `ConsistentRead: true`. Treat absence separately from an unavailable
service or denied read; an AWS error is not proof of absence. To compare identity/ownership,
versions, binding digests, and guard owners, capture the full JSON directly into private files
and inspect them in the private editor. Publish only coarse consistency/state outcomes. Query
partitions with pagination, not table scans; suppress private items in terminal output. Cognito
list/describe operations are operator-only and are not added to a Lambda's IAM policy.

## Detection and disposition

| Observed case | Required action before product retry |
| --- | --- |
| Cognito identity exists, lookup absent after provisioning | Check whether the application transaction actually committed, including the household member, Profile, and creation replay. If no complete result exists, publish non-expiring hash-only revocation, delete that exact orphan Cognito `sub`, and remove any associated partial records/replay references conditionally. Bound revocation expiry only after confirmed Cognito deletion. |
| Application records exist but Cognito identity does not | Keep the identity denied. Inspect all copies and the cascade registry; remove the orphan records and references conditionally. Never fabricate credentials or mark the account active. |
| Lookup/member differ or activation is partial | Preserve denial and quiesce activation/pending actions. Do not infer email ownership from password setup or a cached success. Restore a consistent pending state only when the intended-email binding/version can be established privately; otherwise explicitly cancel/clean the incomplete identity and re-provision. Never manually grant an active peer from an unproven email. |
| Welcome resend returned an uncertain result | Inspect Cognito state and the current binding without printing its destination or message. Do not resend again until the prior request is quiescent and its outcome is understood. Once safe, clear only the inspected guard owner/version so an explicit product request can proceed. |
| Pending-email update or resend split | Compare the intended destination with the stored salted digest in private memory. A retained old verified address does not prove the replacement. Reconcile to a known pending binding/version without setting `email_verified=true`; require native verification. If the state cannot be established, clean/recreate the pending account. |
| Child reset partially changed password/sign-out/cutoff | Do not claim either password validity or revocation. Use immutable `sub`, explicitly complete global sign-out and monotonically advance the existing lookup's cutoff before releasing the case. Never create a missing lookup from a cutoff write or expose the replacement password. |
| Child removal stopped before lookup deletion | Keep both copies inactive and the revocation owner non-expiring. Complete every deployed `childRemovalSteps` deletion, including creation replay references. Delete the inactive lookup/member with exact ownership conditions, then delete Cognito by immutable `sub`. |
| Child removal stopped after lookup deletion | The non-expiring revocation marker must still deny all old-token Membership/bootstrap attempts. Confirm Cognito absence or delete the original `sub`; only then bound expiry and record a completed parent-owned replay. No username reuse claim precedes this confirmation. |
| Guard or binding is missing on a legacy pending parent | Do not invent proof, clear ownership blindly, or use the retired administrative verification helper. Repair/recreate the pending account under this procedure before product activation. |

## Conditional repair commands

Prepare `repair-transaction.json` privately as a DynamoDB `TransactWriteItems` request. Every
updated/deleted lookup requires the inspected member/household invariant, activation state,
version, and exact operation owner. Every household-member update checks its matching `sub`, role,
state, and version. A condition failure means stop and inspect again; never replace conditions
with unconditional writes. Keep `module.table.aws_dynamodb_table.this` and TTL configuration
unchanged while repairing data.

```sh
aws dynamodb transact-write-items --cli-input-json file://repair-transaction.json \
  --output json --no-cli-pager 2>aws-error.json
aws cognito-idp admin-delete-user --cli-input-json file://identity-delete-by-sub.json \
  --output json --no-cli-pager 2>aws-error.json
```

The identity-deletion input contains only the authorized pool and immutable `sub` as `Username`.
Run it only after the approved application's deletion order/guard has been enforced; do not use
it to administer active parent peers or unrelated username-reuse identities. Pending cancellation
keeps its guard until Cognito deletion and final application cleanup are confirmed. Child removal
publishes revocation before cleanup and deletes Cognito after the complete deployed cascade.
These commands are not a general-purpose cleanup script.

For a guard release, privately prepare `guard-release.json` for `UpdateItem` with a
`REMOVE pendingOperationOwner` expression conditioned on the exact inspected owner, pending
version, role, and activation state. Check the matching household Membership in the same
transaction if any invariant changed. Never release after an unconfirmed external outcome.

For completed deletion, the revocation key is `REVOKED#SHA-256(sub)/REVOCATION`. Final metadata
contains only that hash and numeric `expiresAt`; remove the random removal owner in the same
conditional transaction that completes the parent-owned deletion replay. Expiry is the current
confirmed-deletion time plus the configured 3,600-second ID-token lifetime and 60-second tolerance.
An incomplete marker has no expiry. DynamoDB TTL eventually deletes expired markers; requests
also enforce logical expiry and conditionally remove them. There is no raw-identity tombstone.

## Verify before reopening

Use service-boundary/authorized HTTP checks without printing bearer tokens: removed identities
must fail Membership and fresh-household bootstrap even while an old JWT remains valid. Pending
accounts cannot read household APIs. Activation requires native verified proof for the current
binding. Active parents remain protected against peer reset/removal/profile updates. Confirm
all registered removed-child data/replay references are absent; a reused username belongs only
to its new unrelated `sub`.

Record the request ID, coarse repaired case, conditional success, quiescence evidence, and
verification result. Keep raw inputs and provider data out of the public handoff. Reopen endpoints
only after consistency and denial have been established. No deploy, Terraform apply, paid
monitoring, automatic repair state machine, or parent-facing repair surface is part of this runbook.

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
