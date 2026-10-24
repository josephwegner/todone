# Reset and seed local review data

From the repository root, stop `dev:full`, `dev:api`, and `dev:cognito`, then run:

```sh
npm run db:reset:local
npm run dev:full
```

Open `http://localhost:3001/sign-in`, or use your SSH bridge to workspace port 3001.
The reset command starts its own temporary emulator and stops it before returning. It does not
leave a webserver running. If ports 3001, 3002 or 9229 have a listener, including an SSH forward,
the command refuses before deleting anything. Stop the appropriate listener yourself and retry;
the command never kills an existing process. Stop the review stack afterward to free your ports.

## Disposable accounts

All three accounts belong to **Local Test Household**, timezone **America/Chicago**.
They are synthetic local fixtures with permanent development-only passwords:

| Username | Password | Role | Display name | Color |
| --- | --- | --- | --- | --- |
| `localdev` | `LocalDevPass123!` | Active parent | Local Parent | Pine |
| `localparent2` | `LocalParent2Pass123!` | Active parent | Choose on first login | Choose on first login |
| `localchild` | `LocalChildPass123!` | Child | Local Child | Moss |

Use a separate private window or browser profile to keep the second account signed in alongside
the first. Ordinary tabs intentionally share one browser account, so signing in there replaces it.
Parents have synthetic verified recovery emails at `localdev@example.test` and
`localparent2@example.test`. These addresses receive no real messages. They are fixture state,
not evidence that an email was sent or verified. Never use these passwords against a real pool.

## What reset means

- The entire ignored `.cognito/db/` directory is deleted, including all local pools, clients,
  identities and emulator sessions. Existing disposable identities and passwords disappear.
- The ignored `.local-dev/seed.json` manifest is replaced only after all three identities have
  been created successfully. It contains the bound emulator pool ID and the three fixture
  usernames/subjects; no password, email, token or verification code is stored there.
- `.env.local` receives fresh local pool/client settings. Unrelated entries and the tracked
  `.cognito/config.json` are preserved. Symlinked data/configuration paths, production mode,
  remote endpoints and custom emulator network configuration are refused before deletion.
  Concurrent reset processes are serialized by an exclusive `.local-dev/reset.lock`. An unfinished
  lock or `seed.json.tmp` causes refusal before wiping; after confirming no reset process is running,
  remove only that stale generated file and retry.
- There is no local DynamoDB server. Household Memberships, Profiles and replay/revocation data
  are held in the local API's memory. On each API startup, the manifest reconstructs consistent
  active Membership copies for both parents and the child. The first parent and child have Profiles; the second parent has no Profile and must choose their own name/color at `/profile/setup` on first login. Because application data is in memory, the second parent repeats setup after an API restart. Local profile changes,
  removals, and additionally created household records disappear on API restart. Additional
  Cognito identity creation, deletion and password changes persist independently. Startup replays
  application metadata; it does not repair deleted Cognito identities or restore changed passwords.
  Use additional disposable children for destructive review, or run a full reset to restore fixture
  sign-in after changing/deleting a fixture identity. This deliberately resets review fixtures.
- The command cannot clear browser storage. Close old tabs, sign out, and reload after resetting.
  Use a fresh private window or clear this local site's data if an old session remains visible.
- A failed reset exits nonzero and publishes no usable partial seed manifest. Correct the local
  configuration and rerun. Data already wiped by a failed reset cannot be recovered by this tool.

API restart also discards in-memory credential cutoffs and revocation markers. Durable revocation
across an API restart is unsupported local parity; test removal/session denial without restarting
between those steps. A full reset creates a fresh pool/client configuration and invalidates the old
configuration. Production persists its cutoff/revocation records in DynamoDB.

The seed initializer supplies already-active fixture data before serving HTTP requests. Ordinary
requests still authenticate against the real local Cognito emulator and run unchanged Membership,
role, target and profile authorization. There is no seed/reset HTTP endpoint and no production
Lambda or frontend imports the fixture initializer or its passwords.

Native pending-parent activation and recovery-email replacement remain explicitly unsupported
locally; child password reset still refuses before mutation because global sign-out is unavailable.
Creating a new pending parent does not make it active just because seeded parents exist.
The seeded peer enables family-management UI/permission testing, not email-delivery verification.

## Automated and manual verification

After reset and startup:

```sh
npm run test:e2e:local-seed
npm run test:e2e:local-auth
```

The seed suite uses real emulator sign-in for both parents and the child, checks that both parents
resolve the same household, verifies self-only Profile updates and denial of peer reset/removal,
and confirms the unsupported email gate stays closed. The existing local-auth suite creates more
disposable users while testing child creation/removal, pending-parent cancellation, renewal and
shared sign-out. Traces, screenshots and videos are disabled for these real-credential suites.
Run `db:reset:local` again with services stopped to remove those extra test identities.

For manual review, sign in as `localparent2`: first choose your own display name and color on required Profile setup. Family then lists both parents and the child, My profile edits only your own choices, and Security settings shows only that parent's synthetic email. Repeat from a separate `localdev` session and confirm the first parent's profile
is unchanged. As `localchild`, expect the Todo work-in-progress page and no parent settings.
Follow `family-account-management-verification.md` for zoom, keyboard and screen-reader review.
Actual AWS email delivery, native verification and staged recovery-email promotion remain separate
human release checks after authorization; reset/seed never contacts AWS or deploys infrastructure.
