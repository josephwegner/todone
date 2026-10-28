# Credential-free development and human-owned release

## Boundary

Todone development and automated verification require neither Terraform nor AWS credentials.
The app remains AWS-specific at its adapter boundaries, but development is independent of a
particular AWS account. `family-paas` owns account-specific infrastructure, resource bindings,
state, release targets, IAM and migration mechanics. The human operator runs the authenticated
plan, publication, apply and live checks on their own computer.

Keep AWS credentials, credential profiles, production state and sensitive variable files outside
agent-accessible machines. Agents do not need even read-only production access to implement
features. Non-secret configuration is sufficient for application builds and local emulators.

## What already works without Terraform

From the Todone checkout:

```sh
npm ci
npm run verify-local
npm run test:e2e
npm run test:a11y
npm run test:e2e:parent-activation
```

`verify-local` includes local unit/integration tests, frontend build, all Lambda ZIP builds and
OpenSpec validation. It invokes no Terraform command and publishes nothing. The browser suites
use local emulators or synthetic HTTP boundaries. The real-emulator startup/smoke commands are
in the verification guide. A local development configuration is not a release frontend build.

`npm run build:lambdas` separately produces 13 self-contained, reproducible ZIPs under
`.lambda-build/` and prints each artifact's hexadecimal SHA-256, base64 SHA-256 and size.
Those bytes can be transferred to the human release machine and verified there. No table name,
pool ID, account ID, deployment bucket or Terraform state is needed to bundle the Lambda code.
The current build helper prints conventional S3 key suggestions; the authenticated publication
helper still contains an account-specific bucket. Use build-only mode in agent workspaces.
Moving or generalizing publication helpers is a separate implementation change, not accomplished
by this documentation.

## The app/platform contract

| Todone supplies | `family-paas` and the human release owner supply |
| --- | --- |
| Reviewed source commit, Lambda ZIPs and hashes, frontend source/build instructions | Account/region/environment, artifact destinations and authenticated publication |
| API routes and verified-claim requirements | Gateway routes, issuer/audience, integrations and CORS |
| Table key/access-pattern and cascade contracts | Table binding, encryption, PITR, deletion protection, `expiresAt` TTL and no-replacement plan evidence |
| Required runtime operations and authorization tests | Pool/table-scoped IAM and Lambda execution roles |
| Non-secret configuration schema and local examples | Actual public pool/client IDs, region and application/API origins |
| Migration and rollback compatibility notes | Current/prior deployed versions, private release record and reviewed apply |

Existing backend bindings are environment variables: `TODONE_TABLE_NAME`,
`COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID`. The platform provides these to the Lambda runtime.
Runtime execution-role credentials come from AWS when deployed; they do not belong in a bundle.
The registration-gate hash stays sensitive operator-supplied configuration.

The frontend currently embeds non-secret Vite configuration at build time. The operator can
provide `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`,
`VITE_COGNITO_REGISTRATION_CLIENT_ID` and `VITE_COGNITO_REGION`, with
`VITE_COGNITO_LOCAL_ENDPOINT` empty, then run `npm run build` without AWS access. Account-specific
IDs are public browser configuration, not AWS credentials. Building one identical frontend
artifact for every account would require a separate runtime-configuration change. It is not
necessary for credential-free development and is not implemented here.

The existing `deploy:frontend` helper combines reading Terraform outputs, building and publishing.
It is an operator-side helper, not a dependency of `npm run build`. The platform owner may instead
export only the allowlisted public values and use its own documented publication process. Never
pass raw `terraform output -json` or state into an agent workspace; outputs may contain secrets.

## Human release workflow

1. Check out the reviewed source on the operator's own computer, install dependencies, and
   reproduce or verify the reviewed artifact hashes. Preserve the previous deployed artifacts.
2. In `family-paas`, bind the artifact references and application contract using that repository's
   documented commands. Keep credentials, state and sensitive inputs local to the operator.
3. Run its format, validation, policy tests and full state-backed plan. Review IAM, cost,
   compatibility and any destructive changes. Do not substitute a targeted, refresh-disabled,
   mock-state or placeholder-input plan for this review.
4. Review `module.table.aws_dynamodb_table.this` if retaining the Todone Terraform composition,
   or its documented state-preserving equivalent in the platform composition. Preserve table
   identity/name, keys, encryption, PITR and deletion protection; enable `ttl.enabled = true`
   with `ttl.attribute_name = "expiresAt"`. Any table replacement blocks release. Moving
   ownership between stacks requires an explicit state migration; never create a second copy
   of existing infrastructure by applying both compositions.
5. Confirm expected function/route, token-lifetime, email-template and pool-scoped permission
   changes, including `AdminGetUser`. Reject unexplained destructive changes or pool replacement.
6. Only after explicit release authorization, execute the platform-owned publication/apply
   sequence, bind non-secret frontend configuration, publish the frontend and perform live
   Cognito/email and application smoke checks. Record the exact artifacts, plan and results.

Todone does not invent `family-paas` paths or wrapper commands. See
[family-paas-handoff.md](../architecture/family-paas-handoff.md) for the platform contract and
[deployment-rollback.md](deployment-rollback.md) for release/rollback requirements.

If operator feedback is useful, return a sanitized summary: reviewed source commit, plan identifier
or hash, resource create/update/destroy counts, table action, TTL enabled/attribute, no-replacement
result, and unexpected changes. Do not return credentials, variable contents, state, family data,
contact values or verification codes. Agents need not receive the raw plan.

## Approved OpenSpec completion revision

The owner approved this development/release split on 2026-10-28 and confirmed manual
UI/zoom/screen-reader acceptance. Tasks 6.2 and 7.3 use the revised development criteria;
the authenticated plan and live-provider requirements remain mandatory before release.

- Proposal: make credential-free application development explicit and assign authenticated
  infrastructure evidence to the human platform/release owner.
- Design: preserve injected runtime bindings and all existing activation/removal safeguards.
  Separate development acceptance from account-specific release approval.
- Requirements: require the same state-preserving TTL/IAM/provider verification before release,
  without requiring agent access to credentials or a real backend to complete implementation.
- Tasks: task 6.2 completes on implemented/tested removal and the documented preservation/TTL
  handoff; task 7.3 completes on local quality checks, artifact review and the platform handoff.
  The actual plan, apply and live-provider evidence remain mandatory human release gates.

No security or data-preservation requirement is waived. A completed implementation means
ready for the operator's release process; it does not mean infrastructure was planned, applied,
artifacts were published, or real-provider behavior was verified.
