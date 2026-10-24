## ADDED Requirements

### Requirement: Explicit Membership Resolution

The application SHALL distinguish a genuinely unattached authenticated identity from an active, pending, inactive, credential-stale, or persistence-inconsistent Membership.

#### Scenario: Strong membership and credential validation

- **WHEN** an ordinary household API evaluates an authenticated request
- **THEN** Ordinary household APIs SHALL authorize only a strongly validated active lookup, Household, and household Membership whose member ID, `sub`, immutable username, immutable role, and activation copies agree.
- **AND** The sole credential-validity cutoff SHALL be stored on the `USER#<sub>/MEMBERSHIP` lookup, and a token with missing `iat` or `iat` at or before that cutoff SHALL NOT authorize household access.

#### Scenario: Unattached identity resolves current membership
- **WHEN** an authenticated first-parent identity has no user-membership lookup
- **THEN** current-Membership returns `membership: null` and the client may offer household setup

#### Scenario: Non-active identity resolves current membership
- **WHEN** the lookup or household Membership is pending or inactive
- **THEN** current-Membership does not return `membership: null` or household data and the client does not offer creation of a second household

#### Scenario: Stored Membership is inconsistent
- **WHEN** lookup, Household, and household Membership data is malformed, missing after reference, or disagrees on an invariant
- **THEN** authorization fails closed with a generic request-ID error and a non-identifying operator consistency outcome rather than treating the identity as unattached or disclosing stored values

#### Scenario: Token predates child credential cutoff
- **WHEN** a household request carries a token whose `iat` is missing or not later than the lookup's `credentialsValidAfter`
- **THEN** the request requires reauthentication before reading household or target data

### Requirement: Parent-Provisioned Members

Any parent SHALL be able to create a child or parent account in their household using a globally unique, case-insensitive, immutable username and an immutable selected role.

#### Scenario: Provisioned identity and credential rules

- **WHEN** a parent provisions a child or additional parent
- **THEN** Usernames SHALL be normalized to lowercase, contain 3-24 characters using only `a-z`, `0-9`, `-`, and `_`, allow any permitted character at the beginning or end, and be stored on Membership as an immutable read copy while Cognito remains the uniqueness authority.
- **AND** A child account SHALL use a parent-supplied initial password and SHALL NOT require email.
- **AND** A parent account SHALL require an email address, complete the emailed one-time setup-code/password flow, and separately prove the current intended recovery email through Cognito's email-attribute verification before activation.
- **AND** The application SHALL NOT mark an email verified merely because password setup succeeded.

#### Scenario: Parent creates child
- **WHEN** a parent submits valid child account details
- **THEN** the child can sign in with the supplied username and password and belongs only to that household

#### Scenario: Parent creates another parent
- **WHEN** a parent submits a new parent username and email
- **THEN** a pending parent appears in family management and receives a branded welcome email with a one-time setup code for selecting their own password

#### Scenario: Additional parent activates
- **GIVEN** a pending parent has completed the username, one-time setup code, and self-selected password challenge
- **WHEN** they complete Cognito email-attribute verification for the current intended recovery email and renew their ID token
- **THEN** the self-only activation API validates the verified email claims against the current pending account, atomically activates both Membership copies under its concurrency guard, and returns the ordinary active Membership without administratively marking an email verified

#### Scenario: Password setup finishes before email verification
- **WHEN** a pending parent completes password setup but has not verified the current intended recovery email
- **THEN** the activation page offers the separate email-verification step, household access remains denied, and neither a client success flag nor an otherwise valid token without matching verified-email claims can activate the account

#### Scenario: Verification code expires or is invalid
- **WHEN** the pending parent submits an invalid or expired email-verification code
- **THEN** activation remains pending, accessible feedback permits a new explicit attempt or resend, and the application does not mark an email verified or expose the code in history, storage, or logs

#### Scenario: Existing parent attempts to activate a pending peer
- **WHEN** an active parent calls the activation API with a target identifier or another parent's pending state
- **THEN** the request is rejected before mutation because activation accepts only the verified pending caller and no target identity

#### Scenario: Parent manages a pending parent
- **WHEN** an active parent views a pending parent in family management
- **THEN** the active parent can resend the welcome email, change the pending email and resend, or cancel the pending account, but cannot manually activate it

#### Scenario: Provisioned username already exists
- **WHEN** a parent submits a username that case-insensitively matches any existing user-pool username
- **THEN** creation is rejected with an accessible field-level conflict and no membership or partial account data is created

### Requirement: Pending Parent Activation Concurrency
Activation and pending-account administrative actions SHALL be serialized across API instances, revalidate pending state under exclusive ownership, and condition final writes on that owner and version. Activation SHALL require server-verified email ownership matching the current intended destination; password setup or proof for an earlier different address SHALL NOT suffice.

#### Scenario: Email binding is private and temporary
- **WHEN** a pending parent is provisioned, activated, or cancelled
- **THEN** raw email, verification codes, and verification tokens never enter application persistence or peer responses, private derived binding metadata is never logged or exposed as an authorization grant, and activation or cancellation removes that metadata

#### Scenario: Email replacement wins before activation
- **GIVEN** a parent is pending and an activation attempt has proof for the earlier email
- **WHEN** a concurrent pending-email replacement completes first
- **THEN** the earlier proof cannot activate the account or verify the replacement, including when Cognito still retains the earlier verified address, and the pending parent must prove the current intended email before activation

#### Scenario: Email changes during password setup or verification
- **GIVEN** a pending parent's password challenge or email-verification request is in flight
- **WHEN** another parent changes the pending email
- **THEN** completing the earlier flow cannot cause the application to verify the new email, and activation succeeds only with server-verified ownership of the current intended destination

#### Scenario: Activation wins before an administrative action
- **GIVEN** activation and a pending email-change, resend, or cancellation request overlap for the same identity
- **WHEN** activation commits first
- **THEN** the administrative request is rejected before its Cognito side effects and cannot change, resend credentials for, or delete the now-active peer

#### Scenario: Cancellation wins before activation
- **WHEN** pending-account cancellation wins exclusive ownership before an overlapping activation request
- **THEN** activation cannot grant household authority, recreate deleted records, or release cancellation ownership while external deletion remains in flight

#### Scenario: Another request holds the pending-account guard
- **WHEN** activation or a pending-account administrative request encounters an operation already holding exclusive ownership
- **THEN** it returns a safe conflict without side effects, and the UI refreshes authorized state before another explicit attempt rather than claiming success or automatically replaying a mutation

#### Scenario: Guard holder has an uncertain external outcome
- **GIVEN** an operation might have changed Cognito but cannot confirm its complete outcome
- **WHEN** a timeout, process failure, or overlapping retry occurs
- **THEN** the account remains closed to conflicting mutations until an authorized operator quiesces in-flight work and repairs it, and no elapsed timeout, expiring lease, or delayed response permits a second writer to mutate an activated peer

#### Scenario: Unverified or forged activation proof
- **WHEN** activation receives missing, false, malformed, wrong-client, or unverified email claims, an earlier different email, or an email supplied in a request body instead of server-verified claims
- **THEN** activation fails before Membership mutation and no administrative call marks an address verified

#### Scenario: Activation repeats after success
- **WHEN** the now-active parent repeats self activation without a target or payload
- **THEN** the API returns the ordinary active Membership without repeating Cognito verification or any pending-account mutation

#### Scenario: Legacy pending account lacks an email binding
- **WHEN** a pending account lacks the required current-email binding or concurrency metadata
- **THEN** activation and pending administrative actions fail closed without inferring ownership from an old setup challenge, and authorized operator repair or recreation is required

#### Scenario: Local emulator cannot enforce email verification
- **WHEN** the local Cognito emulator cannot prove the email-binding or verification behavior required for activation
- **THEN** local activation explicitly reports the unsupported boundary before granting household authority, while automated service-boundary tests and a documented real-provider release check cover that behavior without bypassing authorization

### Requirement: Peer Parent Protection
Every parent SHALL have equal authority to manage Todos and child accounts. The application SHALL expose no parent removal or demotion operation. Existing child-reset and child-removal endpoints SHALL reject a parent target, and a parent SHALL NOT reset another parent's password or edit another parent's profile.

#### Scenario: Parent attempts peer password reset
- **WHEN** a parent requests a password reset for another parent
- **THEN** the API denies the request and no credential changes

#### Scenario: Child-removal endpoint targets parent
- **WHEN** a parent submits another parent's identifier to child removal
- **THEN** the API denies the request and the peer parent remains active

### Requirement: Child Password Reset
A parent SHALL be able to set a new permanent password for a child account in their household. The new password SHALL never be persisted or logged by Todone. A successful reset SHALL globally sign out the child's Cognito sessions and advance the server-side credential-validity cutoff on that child's user-membership lookup so previously issued JWTs cannot continue to authorize household APIs.

#### Scenario: Child reset succeeds
- **WHEN** a parent submits a valid replacement password for a household child
- **THEN** the child can sign in immediately with the replacement password

#### Scenario: Existing child session follows reset
- **WHEN** a previously authenticated child calls a household API after their password is reset
- **THEN** authorization rejects the pre-reset token and requires the child to sign in with the replacement password

#### Scenario: Reset form navigation
- **WHEN** a parent opens `/family/children/:memberId/password` and navigates, cancels, reloads, or traverses browser history
- **THEN** the form resolves only an authorized household child, keeps passwords out of the URL/history, clears secret input, and never replays a reset automatically

#### Scenario: Local emulator cannot sign out a child
- **WHEN** reset is attempted through the local simulator whose Cognito emulator lacks global sign-out
- **THEN** the API explicitly reports reset unavailable before any password mutation and the UI makes no success claim

### Requirement: Private Parent Recovery Email
A parent's recovery email SHALL be visible only to that parent in their own security settings and SHALL NOT appear in family management or another parent's APIs. An authenticated parent SHALL be able to replace only their own recovery email. The existing verified email SHALL remain active until the replacement email completes verification, after which Cognito Forgot Password SHALL use the replacement.

#### Scenario: Parent changes recovery email
- **WHEN** an authenticated parent submits and verifies a replacement email address
- **THEN** the replacement becomes that parent's recovery email and the previous address is no longer used for Forgot Password

#### Scenario: Parent views peer account
- **WHEN** a parent views another parent in family management
- **THEN** the peer's recovery email is not returned or displayed

### Requirement: Profile Identity

Each member's completed Profile SHALL provide a mutable, non-unique display name and a profile color selected by stable identifier from the canonical nature-inspired palette: `PINE` `#2F6B4F`, `FERN` `#4D7C3F`, `MOSS` `#6B7A3A`, `CLAY` `#B85C3F`, `CEDAR` `#8A5A44`, `MARIGOLD` `#966300`, `LAKE` `#337B8C`, and `DUSK` `#76507A`.

#### Scenario: Self-only profile editing and accessible identity

- **WHEN** a member views or edits profile identity
- **THEN** A member SHALL edit only their own display name and profile color.
- **AND** Interfaces SHALL pair profile color with the member's visible name, meet the application's WCAG contrast rules in actual state combinations, and SHALL NOT use color as the only identity signal.

#### Scenario: First parent completes profile setup
- **WHEN** the first parent successfully creates a household without an existing Profile
- **THEN** the application requires display-name and profile-color setup before opening family management

#### Scenario: Profile color is shown
- **WHEN** a member is rendered in an assignment control
- **THEN** the control shows both the member name and their profile color indicator

#### Scenario: Child edits own profile
- **WHEN** a child submits a valid change to their own display name or profile color
- **THEN** the profile is updated and later references display the current values

#### Scenario: Member edits another profile
- **WHEN** any member attempts to change another member's display name or profile color
- **THEN** the API denies the request and the target profile remains unchanged

### Requirement: Parent Family Management View

The application SHALL provide parents a responsive family-management view listing household members with username, role, activation state, and their self-selected display name and color when a Profile exists, but no recovery emails.

#### Scenario: Authorized directory actions and feedback

- **WHEN** a parent uses family management or views a pending member
- **THEN** Pending parents SHALL appear with pending status and only resend-welcome, change-email-and-resend, and cancel-pending actions.
- **AND** The view SHALL expose create-parent, create-child, child-password-reset, and confirmed child-removal actions only where authorized and SHALL provide loading, empty, submitting, disabled, success, cancellation, error, and retry states.

#### Scenario: Parent opens family management
- **WHEN** a parent opens family management
- **THEN** every active household member and pending parent appears with only the actions allowed for that role and activation state

### Requirement: Route-Backed Account Navigation

Authentication, household/profile onboarding, self-profile, security, family-management, member-creation, and authenticated Todo-landing page surfaces SHALL use canonical client-side routes whose URLs identify the current safe surface.

#### Scenario: Route history and private-input constraints

- **WHEN** an account or Todo-landing surface is opened, navigated, reloaded, or guarded
- **THEN** The authenticated route map SHALL include `/todos`.
- **AND** Before the Todo capability ships, `/todos` SHALL be an explicit nonfunctional work-in-progress surface and SHALL NOT render fabricated Todo data or actions or call a Todo API.
- **AND** Ordinary user navigation SHALL create browser history entries; automatic guard and normalization redirects SHALL replace the current entry.
- **AND** Browser Back, Forward, reload, and direct navigation SHALL restore the authorized surface without replaying writes or restoring secret input.
- **AND** Credentials, Entry Codes, verification/setup/recovery codes, tokens, email addresses, and usernames SHALL NOT appear in paths, query strings, fragments, or persisted history state.

#### Scenario: Active child enters before Todo delivery
- **WHEN** an active child with a completed Profile signs in before the Todo capability is available
- **THEN** the application replaces the entry route with `/todos` and renders only a clear work-in-progress surface with ordinary account navigation, no Todo records or controls, and no Todo API request

#### Scenario: Member navigates between account surfaces
- **WHEN** a member navigates from family management to self-profile editing and then uses browser Back
- **THEN** the URL changes for each surface and Back returns to family management without discarding confirmed server state or submitting either surface

#### Scenario: Member reloads a protected route
- **WHEN** an authenticated member reloads or directly visits a protected canonical route
- **THEN** the application restores the session, resolves Membership/onboarding authorization, and renders that route or replaces it with the required safe prerequisite route

#### Scenario: Signed-out visitor opens a protected route
- **WHEN** a signed-out visitor opens a protected canonical route
- **THEN** the application replaces it with sign-in without rendering private data and may retain only a non-secret authorized return destination in current-tab state

#### Scenario: Visitor opens a secret-bearing flow
- **WHEN** a visitor opens email verification, password reset, or additional-parent activation
- **THEN** the URL identifies only the flow and the visitor supplies username and codes in current in-memory form fields rather than through the URL or persisted history state

#### Scenario: History traverses a submitted form
- **WHEN** a user traverses Back or Forward across a route whose form was previously submitted
- **THEN** navigation performs no API mutation, does not restore secret fields, and shows only state confirmed by a fresh or retained authorized read

### Requirement: Administrative Provisioning Boundary

Public first-parent signup SHALL require the Entry Code only for Cognito `PreSignUp_SignUp`.

#### Scenario: Administrative trigger and authorization constraints

- **WHEN** a parent-provisioned identity is created or its pre-signup event is processed
- **THEN** Parent-provisioned child and additional-parent creation SHALL use IAM-authorized `AdminCreateUser`, SHALL pass parent and household authorization before the Cognito call, and SHALL be restricted by IAM to the Todone user pool.
- **AND** The pre-signup trigger SHALL explicitly permit `PreSignUp_AdminCreateUser` without an Entry Code and reject unexpected trigger sources.
- **AND** Administrative creation SHALL NOT assume or require a prior public signup event.

#### Scenario: Public caller attempts administrative creation
- **WHEN** a caller without a valid active-parent session and the runtime's IAM authority attempts to create a child or additional parent
- **THEN** no `AdminCreateUser` call is authorized and no identity or membership is created

#### Scenario: Authorized parent creates a member
- **WHEN** an active parent submits valid member details through the protected family-account API
- **THEN** the pool-scoped runtime may invoke `AdminCreateUser` and the pre-signup trigger does not require the public Entry Code

### Requirement: Branded Parent Welcome Email

Additional-parent creation and resend SHALL use reviewed application-owned HTML welcome-email copy in Cognito's static invitation template and Cognito's built-in email delivery.

#### Scenario: Invitation content and delivery configuration

- **WHEN** additional-parent welcome delivery is configured or a welcome email is sent
- **THEN** The message SHALL contain `{username}` and `{####}`, present the temporary password as a one-time setup code, explain the shared account-password requirements, and direct the parent to `/activate-parent` without placing username, email, setup code, password, or another secret in the URL.
- **AND** This private deployment accepts Cognito's 50-message daily account quota and SHALL NOT add an SES developer configuration, custom-message/custom-sender Lambda, dedicated IP, or paid email plan for this capability.

#### Scenario: Pending parent receives welcome email
- **WHEN** Cognito sends or resends an additional-parent welcome message
- **THEN** the parent receives branded setup instructions that distinguish the one-time setup code from the subsequent email-verification code without secret values entering application logs or URLs

#### Scenario: Built-in daily email quota is exhausted
- **WHEN** Cognito refuses a welcome or verification message because the built-in daily quota is exhausted
- **THEN** the application reports that delivery could not be confirmed without exposing the address or code and does not silently switch to an unreviewed sender

### Requirement: Child Account Removal

A parent SHALL be able to permanently remove a child account only after explicit confirmation describing the deletion consequences.

#### Scenario: Complete child cascade and identity erasure

- **WHEN** child removal is implemented or executed, including after later capabilities add associated records
- **THEN** Removal SHALL use an extensible cascade that deletes the child's Cognito identity, Membership, profile, and every child-associated data type known to the deployed application.
- **AND** Each later capability that introduces child-associated records SHALL extend this cascade before that capability is complete.
- **AND** The globally unique username SHALL become reusable only after the complete deployed cascade succeeds.
- **AND** The application SHALL NOT retain the child's name, color, `sub`, credentials, or user-visible historical identity.

#### Scenario: Removed child session
- **WHEN** a removed child's previously valid session calls a household API
- **THEN** the API denies access because active membership no longer exists

#### Scenario: Parent cancels child removal
- **WHEN** a parent dismisses the removal confirmation
- **THEN** the child account and all associated data remain unchanged

#### Scenario: Parent confirms child removal
- **WHEN** a parent confirms removal and the operation succeeds
- **THEN** the child identity, profile, Membership, and every child-associated record known to the deployed application are deleted and the username may be registered again as a new unrelated identity

### Requirement: Deleted Identity Revocation
Successful deletion SHALL prevent an old valid JWT from becoming an unattached identity or creating a household. A temporary non-reversible revocation marker MAY retain only the identity hash and expiry, with no raw child identity or history. Its denial window SHALL cover confirmed Cognito deletion plus the configured ID-token lifetime and clock tolerance; partial removals SHALL remain denied until repaired.

#### Scenario: Deleted child attempts bootstrap with an old token
- **GIVEN** child removal has removed its Membership lookup
- **WHEN** the child presents an otherwise valid old JWT to current Membership or household bootstrap
- **THEN** access is denied rather than reporting an unattached account or creating a new household, including during the gap before Cognito deletion

#### Scenario: Revocation marker outlives all valid old tokens
- **WHEN** confirmed deletion plus the configured token lifetime and clock tolerance have elapsed
- **THEN** the marker logically expires and is eligible for physical TTL cleanup without preserving raw identity, and an expired JWT still cannot authorize a request

#### Scenario: Username is reused after complete deletion
- **WHEN** the same username is registered as a new Cognito identity after complete deletion
- **THEN** the new unrelated `sub` does not match the old revocation hash and the former identity gains no access

#### Scenario: Pending-parent cancellation leaves an old token
- **WHEN** a cancelled pending parent's old token is presented after its lookup is deleted
- **THEN** the same temporary hashed revocation boundary denies bootstrap without retaining that parent's raw identity

### Requirement: Provisioning Repair Runbook

Todone SHALL NOT build parent-facing repair UI, automatic cross-service repair, or monitoring for partial Cognito and application-data provisioning failures.

#### Scenario: Operator repair and confirmed retry contract

- **WHEN** a partial Cognito or application-data provisioning outcome requires repair or a product retry
- **THEN** The operations documentation SHALL define how an authorized operator detects and deletes or repairs orphaned users with AWS or CLI tools without logging credentials.
- **AND** Product retries SHALL replay only a confirmed completed result; an uncertain split result SHALL block username reuse or a repeated destructive transition until the operator resolves it.

#### Scenario: Provisioning partially fails
- **WHEN** Cognito identity creation and Todone membership creation do not both complete
- **THEN** the parent receives a generic request-ID failure without a claim that retry is safe, and an authorized operator follows the documented repair procedure before the username is retried

### Requirement: Explicit Local Review Fixtures
The development workflow SHALL provide an explicitly local wipe-and-seed command and a disposable household containing two active parents and one child. Fixtures SHALL preserve normal authentication and household authorization and SHALL NOT weaken native verification gates or be included in production artifacts.

#### Scenario: Owner resets local review data
- **WHEN** the owner runs the local reset command with all local services stopped
- **THEN** only the ignored emulator database and generated fixture manifest are wiped, local identities/clients are recreated, and the API reconstructs one household with both active parents and their Profiles on startup
- **AND** the command stops its temporary emulator, preserves unrelated configuration, and documents disposable credentials, restart behavior, and unsupported provider parity

#### Scenario: Unsafe local reset request
- **WHEN** a configured endpoint is remote, production mode is set, a reset path is symlinked, or a local service/SSH listener is running
- **THEN** the reset refuses before deleting data or making identity-service calls

#### Scenario: Seeded peer parent signs in
- **WHEN** either seeded parent signs in through the real local emulator
- **THEN** both resolve the same household through ordinary Membership authorization, may edit only their own Profile, cannot reset/remove the peer parent, and ordinary pending-parent activation still refuses unsupported verification

### Requirement: Additional Parent Owns First-Login Profile
An inviter SHALL supply only username and recovery email when creating an additional parent. The new parent SHALL choose their own display name and canonical profile color through required self-profile setup after native email verification and activation, before entering family management. No placeholder Profile SHALL be persisted on their behalf.

#### Scenario: Invitation precedes profile setup
- **WHEN** a parent creates an additional parent with username and email
- **THEN** no Profile is created, extra display-name/color fields are rejected, and the directory identifies the pending member by username without inventing a name or color

#### Scenario: Verified parent completes first login
- **WHEN** a newly activated parent has no Profile
- **THEN** the router requires `/profile/setup`, reload and deep links preserve that requirement, and only that authenticated parent can save their name/color before entering family management
- **AND** peers see their username and profile-setup status until the Profile exists; missing parent Profiles do not break the household directory

#### Scenario: Child account actions on desktop
- **WHEN** an active child row is shown on a desktop layout
- **THEN** the Reset child password navigation link and Remove child account action are grouped with aligned vertical centers and consistent target height, while remaining usable when compact layouts wrap

### Requirement: Pending parent activation recovers without replaying consumed codes

The system SHALL distinguish invitation eligibility before password setup from pending email
verification after password setup. Welcome/email-and-resend SHALL check private provider state
under the pending guard before mutation and reject ineligible accounts without retaining ownership.
Pure resend SHALL release ownership on a definitive side-effect-free invalid-state rejection;
unknown outcomes and email-update/resend splits SHALL retain ownership.

#### Scenario: Parent already chose a password

- **WHEN** a peer requests resend or change-email-and-resend for a confirmed pending parent
- **THEN** no email or invitation is mutated, ownership is released, and self verification/activation remains possible

#### Scenario: Password setup races invitation resend

- **WHEN** the provider definitively rejects pure resend after eligibility was checked
- **THEN** ownership is released, but an email-update/resend split remains closed for operator repair

#### Scenario: Verification consumed a code before activation failed

- **WHEN** native verification succeeds but renewal or activation fails
- **THEN** explicit retry renews credentials and retries self activation without submitting the code again, and conflict refreshes authorized context

#### Scenario: Verified pending identity is restored

- **WHEN** a verified pending identity reloads or signs in again
- **THEN** renewed-token self activation is attempted independently and only the server current-binding rejection returns the UI to verification
