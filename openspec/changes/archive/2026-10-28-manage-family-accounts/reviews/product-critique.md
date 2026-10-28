# Product Critique: `manage-family-accounts`

> **This document is a Point in Time critique - it does not reflect updates to the plan nor implementation.**

Reviewer: independent product/architecture review
Scope: pre-implementation review of `proposal.md`, `design.md`, `specs/family-account-management/spec.md`, `tasks.md`, cross-referenced against `docs/product/brief.md` and sibling OpenSpec changes (`bootstrap-household-membership`, `complete-first-family-todo`). No implementation exists yet; no code was reviewed.

## Verdict

**NOT READY**

The change has a clear, well-scoped intent and the individual requirements that exist are mostly well written. However, it has one structural OpenSpec defect (an undeclared spec delta for a capability the proposal says it modifies) and several requirements gaps that would force an implementation agent to invent product behavior — including a proposal-committed feature (partial-provisioning recovery) with zero corresponding spec coverage, and an internally contradictory requirement (peer-parent protection prohibiting actions that this same change declares out of scope / nonexistent). These need to be resolved before implementation begins.

---

## Blocking findings

### B1. `household-membership` is declared "Modified" but has no spec delta
**Accepted by Product Owner**

- **Location:** `proposal.md` line 19 (`### Modified Capabilities` → `household-membership: Adds member roles and lifecycle behavior.`) vs. `specs/` directory contents.
- **Evidence:** The only spec delta present is `specs/family-account-management/spec.md`. There is no `specs/household-membership/spec.md` with `MODIFIED Requirements`. The existing `household-membership` capability (from `bootstrap-household-membership`) defines `Tenant Isolation` and membership-gated access but says nothing about roles, immutability, or lifecycle (creation/removal) — exactly the behavior this proposal says it is adding to that capability.
- **Impact:** An implementer has no authoritative, reviewable statement of how `household-membership`'s existing requirements (e.g., `Tenant Isolation`) change to account for roles and removed-member lifecycle. This is exactly the kind of undocumented architecture/requirement change the workflow is designed to prevent, and it breaks proposal→spec traceability for a capability the proposal explicitly claims to touch.
- **Recommendation:** Add a `specs/household-membership/spec.md` delta with `MODIFIED Requirements` (or `ADDED Requirements`) capturing role attachment to Membership, immutability, and how removal interacts with `Tenant Isolation`'s active-membership check. Alternatively, if no change to `household-membership`'s actual requirements is needed (only new data fields), correct `proposal.md` to remove the "Modified Capabilities" claim.
- **Verification needed:** Confirm which requirements in `household-membership` actually change and produce the missing delta, or amend the proposal.

### B2. Proposal-committed "recovery from partial account provisioning" has no spec requirement or scenario
**Accepted by Product Owner**
> PO Notes: This is such a small edge case that I don't need built-in recovery or monitoring. Just write some operations documentation on how to fix orphaned users via AWS or the CLI, and I'll run that as needed.

- **Location:** `proposal.md` line 10 (`Add child-account removal behavior and recovery from partial account provisioning.`); `design.md` line 14 (provisioning operation record decision); `specs/family-account-management/spec.md` (entire file).
- **Evidence:** The proposal explicitly commits to a recovery capability. `design.md` describes an implementation mechanism ("store a provisioning operation record so retries either finish safely or report a recoverable state"). `spec.md` contains no `Requirement` or `Scenario` describing what a parent sees, does, or is told when provisioning partially fails, nor what "recoverable state" means from the user's perspective (retry button? warning banner? manual repair flow?). `tasks.md` 2.3 only restates the design-level goal ("failed provisioning can be safely retried or repaired") without defining acceptance criteria.
- **Impact:** This is a real, user-visible failure mode (Cognito succeeds, Todone persistence fails, or vice versa) that will occur in production. Without a defined requirement/scenario, the implementer must invent the recovery UX and API contract, and reviewers cannot verify the feature against any approved acceptance criteria — violating "requirements to scenarios" traceability and item #5 (failure/recovery states must be defined).
- **Recommendation:** Add a `Requirement: Provisioning Recovery` (or fold into `Parent-Provisioned Members`) with explicit scenarios: partial-failure detection, what the parent is shown, whether retry reuses the same username/operation record, and what happens if Cognito already created the identity before Todone persistence failed (does retry silently reuse the existing Cognito user, or does it also need a "repair" path distinct from "retry"?).
- **Verification needed:** Confirm with the product owner what "recoverable state" should look like to a parent before writing the scenario.

### B3. `Peer Parent Protection` requirement prohibits actions this same change declares nonexistent
**Accepted by Product Owner**
> PO Notes: Maintain that peer parents can not remove or demote each other. If that needs to happen, I can do it manually via console.

- **Location:** `specs/family-account-management/spec.md` lines 10–11 (`A parent SHALL NOT reset, remove, demote, or otherwise administer another existing parent.`) vs. `proposal.md` line 25 (`Does not add ... parent removal/demotion, role changes ...`) and `design.md` line 9 (`Non-Goals: ... parent removal/demotion, role mutation ...`).
- **Evidence:** The requirement text bans "remove" and "demote" of a parent, but the same change's own Non-Goals state that parent removal and demotion do not exist as features at all in this system. The only scenario provided (`Parent attempts peer password reset`) tests password reset denial, not removal or demotion.
- **Impact:** A requirement that forbids an action which has no implementation surface is untestable and internally contradictory. Worse, it creates risk that an implementer, trying to satisfy the letter of the requirement, builds a generic "remove/demote member" capability (that also happens to work on parents) just so there is something to deny — which would silently expand scope beyond the approved Non-Goals. Alternatively the implementer ignores the untestable clause, leaving the requirement partially unimplemented and unverifiable.
- **Recommendation:** Narrow the requirement text to the two actions that actually exist and are testable in this change (password reset, and — if in scope — denial of the child-removal endpoint against a parent target). Remove "demote" and "remove" language unless a corresponding feature and scenario exist, or explicitly scope it as "no such action exists" language that doesn't imply a denial-testable API surface.
- **Verification needed:** Decide whether "a parent cannot remove another parent" needs an explicit negative test against the child-removal endpoint (recommended), since that endpoint's authorization boundary is a real attack surface even if "remove a parent" isn't a first-class feature.

### B4. Username uniqueness scope and collision handling are undefined
**Accepted by Product Owner**

- **Location:** `specs/family-account-management/spec.md` lines 3–8 (`Requirement: Parent-Provisioned Members` — "a unique username").
- **Evidence:** "Unique" is not scoped (per-household vs. global). `design.md` describes a single, shared "Todone pool" in Cognito (line 21: "IAM must scope actions to the Todone user pool"), which strongly implies usernames are globally unique across all households sharing that pool — not just within one family. No requirement or scenario addresses what happens when a parent chooses a username already taken by an unrelated household (e.g., two different families both wanting a child named "Alex"), which is a highly foreseeable collision given common first names are the natural username choice for children.
- **Impact:** This is not an edge case — it is a likely first-run failure for any household beyond the very first, and the spec provides no defined error, no guidance on username format/scoping, and no product decision on whether the product should use per-household-scoped identifiers (e.g., `household-id:username`) instead of a flat global namespace. Left unresolved, the implementer will invent both the uniqueness scope and the failure UX.
- **Recommendation:** Explicitly decide and document (a) the uniqueness scope (recommend a household-scoped logical username backed by a synthesized globally-unique Cognito username, or clarify that Cognito pool architecture will change), and (b) add a validation `Scenario` for duplicate-username submission (field-level error, no partial account created).
- **Verification needed:** Confirm the intended multi-household namespace model given `brief.md`'s explicit interest in eventually supporting "the rest of the world" as a stretch goal.

---

## Important findings

### I1. No account-recovery path exists for a parent who forgets their password
**Accepted by Product Owner**
> PO Notes: Parents should be able to go through a Forgot Password flow. Children cannot.

- **Location:** `design.md` line 9 (Non-Goals: "email recovery"); `specs/family-account-management/spec.md` `Peer Parent Protection` (bars other parents from resetting a peer's password); `bootstrap-household-membership` spec (only covers registration/sign-in/sign-out/session restoration — no self-service password change or forgot-password flow).
- **Evidence:** Combining these three facts: no email recovery, peer parents cannot reset each other, and no self-service change-password flow exists anywhere in the currently specified capabilities. A parent who forgets their password has no documented way back into the account.
- **Impact:** This is a real, permanent lockout scenario for the primary admin role of the household, and it is never surfaced as an accepted risk or explicit deferred decision — it is simply absent.
- **Recommendation:** Either explicitly document this as an accepted risk/non-goal with rationale (e.g., "out of scope; family members are expected to coordinate device access as a stopgap until a future change adds recovery"), or scope a minimal self-service password-change flow for authenticated parents into this change.
- **Verification needed:** Product decision on acceptable risk level for a personal-use app; if acceptable, add explicit non-goal language with rationale so it isn't mistaken for an oversight later.

### I2. No specification for the parent-facing member-management screen/journey
**Accepted by Product Owner**

- **Location:** `tasks.md` line 14 (`3.1 Implement accessible responsive family management and profile controls...`) vs. `specs/family-account-management/spec.md` (no requirement describing a member list, per-member actions, or navigation).
- **Evidence:** Tasks assume a "family management" UI exists with role selection, child reset, and various states, but no requirement in `spec.md` defines what a parent sees (a member list? per-row actions? a separate creation form vs. management view?).
- **Impact:** This is the primary screen through which every requirement in this spec is exercised by an end user, yet its structure is entirely undocumented. The implementer must invent the information architecture, risking a UI that doesn't match user expectations and can't be objectively verified against any written acceptance criteria.
- **Recommendation:** Add a requirement (or extend `Profile Identity`) describing the family-management view: what members are listed, what actions are available per role/target combination, and how creation/reset/removal are entered.
- **Verification needed:** None beyond authoring the missing requirement/scenario.

### I3. Self-service profile editing authorization is undefined
**Accepted by Product Owner**
> PO Notes: You can only change your own color. Parents cannot change children's colors.

- **Location:** `specs/family-account-management/spec.md` lines 24–25 (`Requirement: Profile Identity` — "mutable display name and ... profile color") vs. `docs/product/brief.md` line 28 (`Profile management is available to all accounts, including updating names and "color"`).
- **Evidence:** The brief states profile management is available to *all* accounts (implying children can edit their own name/color). The change spec says the attributes are "mutable" but never states who may mutate them — only a parent, or also the member themselves.
- **Impact:** If implemented as parent-only (consistent with the rest of this change's "parent administers everything" framing), it would silently contradict the approved brief. If implemented as self-service for children, it isn't specified anywhere and there's no accompanying authorization/negative-test requirement (e.g., can a child edit a sibling's profile?).
- **Recommendation:** Add explicit authorization language: who can edit whose display name/color, and a negative scenario for cross-member edits.
- **Verification needed:** Reconcile with `brief.md`'s "available to all accounts" language.

### I4. No destructive-action confirmation/consequence messaging for child removal
**Accepted by Product Owner**

- **Location:** `specs/family-account-management/spec.md` lines 31–36 (`Requirement: Child Account Removal`).
- **Evidence:** The requirement and its scenario describe only the technical effect (loss of access) and historical-record behavior. Nothing addresses parent-facing confirmation, warning about irreversibility, or what happens to the removed child's active Todos/assignments at the moment of removal.
- **Impact:** Removal is irreversible (per B4's related open question about identity reuse) and destructive; AGENTS.md/product conventions call for explicit destructive-action handling. Without it, an implementer may ship a one-click, unconfirmed delete.
- **Recommendation:** Add a confirmation-step requirement/scenario and state explicitly what happens to the removed child's currently assigned Todos (unassigned? left assigned but hidden? reassigned to a parent?).
- **Verification needed:** Product decision on Todo disposition at removal time; this also affects `family-todo-completion`/lifecycle capabilities.

### I5. Missing failure/validation scenarios for account creation and password reset
**Rejected by Product Owner**

- **Location:** `specs/family-account-management/spec.md` `Requirement: Parent-Provisioned Members` and `Requirement: Child Password Reset` — each has exactly one happy-path scenario.
- **Evidence:** No scenario covers invalid/weak password submission, network failure during creation or reset, or resubmission after a transient failure — despite `tasks.md` 3.1 assuming "validation, cancellation, and error retry states are available."
- **Impact:** Per repo UI conventions (loading/empty/error/success/disabled states must be defined), these states currently have a task-level assumption but no spec-level acceptance criteria, making them unverifiable.
- **Recommendation:** Add at least one validation-failure and one transient-failure scenario per requirement, consistent with the pattern used in `bootstrap-household-membership`'s `Mandatory Household Bootstrap` requirement (which does include a "Creation fails" scenario this change's analogous requirements lack).
- **Verification needed:** None beyond authoring.

### I6. Change silently narrows brief.md's approved MVP scope without documented rationale
**Rejected by Product Owner**

- **Location:** `proposal.md` line 25 (`Does not add invitations, parent removal/demotion, role changes, or shared-device switching.`) vs. `docs/product/brief.md` lines 31–36 (MVP explicitly lists "Remove user from family" and "Change user role" as generic capabilities, not scoped to children only).
- **Evidence:** The brief's family-user-management list treats "remove" and "change role" as applying to any user, not just children. This change unilaterally restricts removal to children only and defers role change entirely, with no rationale documented and no reference to a follow-up change that will close the gap.
- **Impact:** AGENTS.md explicitly prohibits silently changing approved requirements. Even if narrowing scope for a first slice is the right call, doing so without a recorded rationale or forward reference makes it look like an oversight rather than a decision, and risks the gap being permanently forgotten.
- **Recommendation:** Add a short rationale to `design.md`/`proposal.md` for why parent removal/role-change are deferred (e.g., "low household risk at 2-parent scale, revisit if usage shows need"), and/or note the deferred item as a tracked future change.
- **Verification needed:** Confirm product owner intent to defer, and record it explicitly rather than only as a Non-Goal bullet.

### I7. Ambiguity: is role immutability enforced server-side, or only hidden in the UI?
**Accepted by Product Owner**
> PO Notes: This is enforced server-side

- **Location:** `design.md` line 15 (`Roles are immutable through the UI.`) vs. `specs/family-account-management/spec.md` line 4 (`immutable selected role`, stated unconditionally).
- **Evidence:** "Immutable through the UI" is a phrase that, read literally, describes a client-side restriction, which contradicts the repo's own security posture ("Do not assume client-side checks provide security" is the standard security review principle, and `design.md`'s own Risks section stresses server-side authorization elsewhere).
- **Impact:** If an implementer takes "through the UI" literally, role could remain mutable via a direct API call, which would be a real authorization gap (a parent role could self-elevate a child, or vice versa).
- **Recommendation:** Reword `design.md` to state role immutability is enforced at the API/authorization layer, with the UI simply not exposing a control for it.
- **Verification needed:** None beyond the wording fix; but flag for the security review checklist during implementation.

### I8. Unclear whether removed-child usernames/identities are deleted or merely disabled
**Accepted by Product Owner**
> PO Notes: Do a full removal. We don't want to keep data for users that have left.

- **Location:** `design.md` line 16 (`Remove child membership first or atomically with identity disablement`); `specs/family-account-management/spec.md` `Requirement: Child Account Removal`.
- **Evidence:** "Disablement" suggests the Cognito identity persists (disabled) rather than being deleted. No requirement states whether the username becomes available for reuse, or what happens if a parent tries to recreate a child with the same username after removal.
- **Impact:** A very plausible recovery journey — a parent removes a child by mistake or wants to reset and recreate an account — is left undefined and could fail unpredictably (username permanently unavailable) or behave inconsistently depending on implementation choice.
- **Recommendation:** Add an explicit scenario or statement of intended behavior for username availability after removal.
- **Verification needed:** Product decision on retention vs. reuse.

---

## Optional improvements

- **O1.** "Constrained accessible profile color" (`Requirement: Profile Identity`) has no defined palette or contrast criterion, making "accessible" subjective. Reference a concrete palette or WCAG contrast threshold so the requirement is objectively verifiable.
    - Accepted by PO
- **O2.** `design.md` omits the mermaid diagram convention used by sibling changes (`bootstrap-household-membership`, `complete-first-family-todo`); a small sequence diagram for the provisioning flow (parent → API → Cognito → Todone persistence) would materially help implementers, especially given the partial-failure recovery path (B2).
- **O3.** Password strength/format requirements for parent-set child passwords aren't specified; given the target age range (8–12, per `brief.md`), consider an explicit minimum policy suited to a child typing it (e.g., simple, memorable, but not trivially guessable) rather than leaving it to Cognito defaults by default.

---

## Missing decisions or scenarios

1. Username uniqueness scope (household-scoped vs. global) and the duplicate-username failure UX (B4).
2. User-facing behavior for partial-provisioning recovery — what a parent sees, retry vs. repair semantics (B2).
3. Whether `household-membership`'s existing requirements (notably `Tenant Isolation`) need amendment to account for roles/removed-member lifecycle (B1).
4. Parent password recovery / self-service change path, or an explicit accepted-risk statement that none exists (I1).
5. Structure of the parent-facing member-management screen (I2).
6. Authorization for self-service profile edits — parent-only vs. member self-service (I3).
7. Destructive-action confirmation and Todo disposition on child removal (I4).
8. Whether removed-child usernames/Cognito identities can be reused (I8).
9. Rationale (or forward-reference) for deferring parent removal and role changes relative to the approved brief (I6).

---

## Traceability gaps

- `proposal.md`'s "Modified Capabilities: household-membership" has no corresponding spec delta (B1).
- `proposal.md`'s explicit commitment to "recovery from partial account provisioning" has no requirement/scenario in `specs/family-account-management/spec.md` (B2).
- `tasks.md` 3.1 assumes UI elements (family management screen, role selection UI, error/retry states) that are not defined by any requirement in `spec.md` (I2, I5).
- `docs/product/brief.md`'s MVP items "Remove user from family" and "Change user role" are only partially and silently narrowed by this change's Non-Goals, with no documented decision trail (I6).
- `Peer Parent Protection`'s requirement text references actions ("remove," "demote") that have no corresponding feature or scenario anywhere in this change (B3).

---

## Recommended next action

Revise `proposal.md`, `design.md`, and `specs/family-account-management/spec.md` to resolve the four Blocking findings (B1–B4) — in particular, either add the missing `household-membership` spec delta or correct the proposal's capability list, and add the missing provisioning-recovery requirement/scenario — before any implementation task in `tasks.md` is started.
