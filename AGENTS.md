# Application Development Instructions

## Product source of truth

- Product requirements: `docs/product/`
- User flows: `docs/ux/`
- Architecture: `docs/architecture/`
- ADRs: `docs/adr/`
- Security: `docs/security/`
- Test strategy: `docs/testing/`

## Engineering principles

- Prefer boring, reversible architecture.
- Implement vertical slices.
- Do not introduce dependencies without justification.
- Do not weaken tests to make implementation pass.
- Do not change approved requirements silently.
- Never commit secrets or production data.

## Review feedback conventions

- When the project owner leaves comments on a changeset, look for recurring feedback themes rather than treating each comment in isolation. Confirm any inferred trend with the project owner before acting on it, then add the confirmed convention as a stylistic guideline in this `AGENTS.md` file.

## Code conventions

- Name stable cross-boundary values (API paths, header names, error codes, record kinds, field limits, and storage key formats) with constants or factories. Keep truly local literals local.
- Prefer explicit control flow over conditional return expressions when the condition carries authorization or state meaning.
- Put user-facing frontend copy, generic API domain messages, and stable external error identifiers in `src/i18n/en.yml` or another centralized external contract catalog. Keep internal diagnostics as named local constants or stable internal error codes; never return or log them raw to users.
- Reuse shared HTTP status/response and authenticated-request helpers rather than defining endpoint-specific response plumbing.
- When a constant serves one small code region, define it as near to that region as practical without recreating it repeatedly.
- Reuse shared request, response, repository, and validation utilities when they preserve an established contract. Record request IDs and outcomes for successful as well as failed API requests.
- Prefer descriptive helper names over terse persistence or serialization abbreviations.
- Treat sign-out as a fail-safe local privacy boundary: clear local credentials and private UI state even if an SDK cleanup call throws. Add server sign-out only when a server-side sign-out contract exists.
- Pass session and storage dependencies explicitly through every SDK and authenticated-request entry point, including retries. Test the real adapter boundary when mocks could hide persistence or lifecycle behavior.

## OpenSpec implementation workflow

- At the beginning and end of each implementation slice, reconcile the active OpenSpec checklist. Report completed, remaining, blocked, and intentionally deferred tasks explicitly.
- Do not describe a change as ready for review while unfinished tasks remain unless those tasks are clearly identified as externally blocked or deferred with the project owner's approval.
- When implementation reveals missing product behavior, update the proposal, design, requirements, and task list before implementing the new behavior.

## Manual testing handoff

- Before asking the project owner to perform hands-on testing, run the same documented startup commands and exercise the critical flow with an automated browser smoke where possible.
- Local emulators must enforce security-sensitive behavior or clearly identify unsupported parity. Never silently allow a local security gate to be bypassed.
- Testing instructions must state expected outcomes and distinguish automated, locally verified, and human-only checks.

## Browser navigation

- Page-level application surfaces require canonical URLs and must preserve browser Back, Forward, reload, and safe deep-link behavior.
- Credentials, codes, tokens, emails, usernames, and mutation payloads must not enter URLs or persisted history state.

## External-service boundaries

- Add concise function-level comments where Cognito, API Gateway, Lambda triggers, or another external service supplies an event and expects a particular response or ordering contract.

## Approved local command families

- The project owner authorizes Codex to run every current `npm run test*`, `npm run dev*`, and `npm run build*` script, `npm run verify-local`, and every `npx playwright` command without asking again.
- This section documents owner intent. `.codex/rules/default.rules` is the executable permission policy and deliberately enumerates npm scripts so deployment commands are not allowed accidentally.

## Required workflow

1. Read the relevant specification and ADRs.
2. Identify ambiguities before editing.
3. Produce a file-level plan.
4. Add or update tests.
5. Implement the smallest complete slice.
6. Run the local verification command.
7. Review the diff for unrelated changes.
8. Update documentation when behavior changes.

## Required verification

- Format check
- Lint
- Static typecheck
- Unit tests
- Integration tests
- Production build
- Relevant Playwright tests
- Accessibility checks for changed UI

## UI expectations

- Keyboard accessible
- Screen-reader labels where applicable
- Responsive at documented breakpoints
- Loading, empty, error, success, and disabled states
- No layout shift for ordinary loading
- Consistent design tokens
- Visual screenshots reviewed for meaningful UI changes

## Confirmed UI review conventions

- On compact layouts, prefer continuous full-width page and list surfaces over nested rounded cards; reserve bounded cards for focused forms, dialogs, and exceptional secondary detail.
- Use links for navigation, including row-level and compact navigation. Reserve buttons for mutations, submission, confirmation, or another action that changes state.
- Make the current route visually unambiguous in persistent navigation. Group primary submit and cancel/navigation controls with deliberate spacing rather than relying on incidental form rhythm.
- When a compact form does not need the containment of a dialog or focused secondary detail, use a continuous full-width surface rather than a mobile card.

## Prohibited actions

- Do not deploy.
- Do not alter production infrastructure.
- Do not remove migrations.
- Do not accept visual snapshot changes blindly.
- Do not bypass authorization checks in test helpers.

## Repository notes

- This is a Vue 3, Vite, TypeScript, Tailwind, and Playwright PWA with Lambda handlers and Terraform configuration.
- `package.json` provides the canonical local and CI commands documented in `docs/testing/strategy.md`.
- Local full-stack development uses `npm run dev:full`; initialize the development-only Cognito emulator with `npm run setup:local-cognito` as documented in the testing strategy.
- Playwright starts the local Vite application through its configured `webServer`; browser tests must not target production by default.

## Test workflow

- Run the aggregate non-browser verification suite with `npm run verify-local`.
- Run the required checks with `npm run format:check`, `npm run lint:check`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run build`, `npm run test:e2e`, and `npm run test:a11y`.
- Run one Playwright file with `npx playwright test tests/e2e/<file>.spec.ts`; target a configured project with `--project=<project-name>` from `playwright.config.ts`.
- End-to-end and accessibility suites run against the local application in Chromium, Firefox, and WebKit at the configured compact, medium, and wide viewports. CI rejects `test.only`.
- The local Cognito end-to-end workflow is separate: start the development stack, initialize the emulator as documented, then run `npm run test:e2e:local-auth`.
- Playwright output is intentionally untracked: `test-results/`, `playwright-report/`, `blob-report/`, and Playwright caches/auth state.
