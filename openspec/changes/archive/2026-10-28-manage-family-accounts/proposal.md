## Why

Parents need to create and recover child accounts without email, while children need a simple identity that is clearly represented during assignment. Parent peers require equal authority without the ability to administer one another.

## What Changes

- Add parent-created child and parent accounts using globally unique immutable usernames stored on Membership and separate mutable, non-unique display names.
- Send the first parent from household creation to required profile setup before family management.
- Activate additional parent accounts through a branded setup email, self-selected password, and a separate Cognito email-verification step so each parent proves the recovery address before gaining household authority. The welcome email contains only the one-time setup code and instructions; the selected password is never emailed. Completing the setup-password challenge alone never marks an email verified.
- Bind activation to the pending account's current intended email and serialize activation, resend, email replacement, and cancellation for that identity. An overlapping administrative action cannot verify an unproven address, change an activated peer, or delete an account after activation wins.
- Add private self-service parent recovery-email settings with verification before a replacement address becomes active.
- Add parent-managed child passwords and password reset without requiring a child email address; a reset invalidates the child's existing sessions.
- Add self-service display-name and profile-color editing; members cannot edit another member's profile.
- Replace in-memory screen switching with route-backed authentication, onboarding, profile, security, family-management, and authenticated `/todos` navigation so URLs identify the current surface and browser back, forward, reload, and safe deep links work as expected. During this change `/todos` is an explicit nonfunctional work-in-progress child landing page; Todo data and actions remain owned by the first Todo slice.
- Add immutable creation-time roles and peer-parent protections.
- Add confirmed full child-account removal with an extensible cascade contract. This change deletes the Cognito identity, Membership/profile, and all currently known child-owned data; each downstream Todo/history/recurrence change extends and tests the cascade for the records it introduces. The username becomes reusable after successful deletion.
- Prevent deleted-account JWTs from being treated as newly unattached identities: publish a temporary SHA-256 identity-revocation marker without raw identity data, deny bootstrap and Membership resolution while it is live, and expire it after confirmed Cognito deletion plus the configured ID-token lifetime and clock tolerance. This explicitly approved exception also protects pending-account cancellation.
- Document AWS/CLI repair for partial provisioning instead of building recovery UI or monitoring for this edge case.

## Capabilities

### New Capabilities
- `family-account-management`: Parent-managed household account provisioning and profile identity.

### Modified Capabilities

- None. The prerequisite `household-membership` capability already defines immutable roles and active membership; this change adds family-account behavior without changing those requirements.

## Impact

- Depends on household bootstrap and Cognito administrative APIs.
- Delivers the crawl MVP's immutable parent/child accounts and self-managed profiles.
- Routes the existing pre-signup trigger by Cognito trigger source: public `SignUp` requires the Entry Code, while pool-scoped IAM-authorized `AdminCreateUser` relies on parent API authorization and does not require the public gate.
- Adds the minimum reviewed Cognito administrative permissions needed for provisioning, removal, password reset, activation resend, and global child sign-out, restricted to the Todone pool.
- Uses Cognito's built-in email delivery and reviewed static HTML welcome-email template for additional-parent setup. The default 50-message daily account quota is sufficient for this private deployment; a separately configured SES sender and custom-message Lambda are deferred unless delivery volume or sender-control requirements change.
- Adds a distinct email-verification step within `/activate-parent`, using Cognito `GetUserAttributeVerificationCode` and `VerifyUserAttribute`, followed by renewed server-verified ID-token claims. Setup and verification messages both consume the existing sender quota. Replaces the unused username-only administrative verification helper before activation ships.
- Adds private pending-account email-binding and operation-guard metadata to the existing DynamoDB records. The guard is conditional concurrency control, with operator recovery after uncertain external outcomes; it does not introduce automatic cross-service repair, a provisioning workflow engine, or a new service. Existing pending records without this metadata fail closed until repaired or recreated by an authorized operator.
- Adds client-side routing and guarded, secret-free URLs for the existing authentication/bootstrap surfaces, the family-account surfaces introduced by this change, and the honest `/todos` placeholder needed for child landing behavior. Transient form values, credentials, email addresses, setup codes, verification codes, and tokens never enter route paths, query strings, fragments, or history state.
- Does not add reusable/public household invitations, parent removal/demotion, role changes, or shared-device switching. The account-specific additional-parent welcome email is explicitly in scope.

## Approved local review fixtures

The owner requested a development-only second active parent and a single full local wipe-and-seed
npm command. Provide two disposable active parents and one child in one household through explicit
fixture initialization. This simulates existing verified accounts for UI/authorization review; it
never supplies evidence of native email verification or changes production activation behavior.

## Owner review correction: parent-owned profile

Additional-parent invitations collect username/email only. The invited parent selects display name
and color on first login after verification/activation using existing required self-profile setup.
Pending and active-unconfigured parent directory entries omit profile fields and use username;
child provisioning still includes parent-chosen profile data. Desktop child actions share one aligned
action group. This supersedes invitation requirements that previously collected peer profile data.

## PR review: recoverable activation

Welcome resend and change-email-and-resend apply only before password setup. Check provider
invitation eligibility under the existing guard before mutation; confirmed accounts instead
complete native verification themselves. Add only pool-scoped `AdminGetUser` to the existing
privileged role; ordinary read/profile/activation roles receive no provider status permission. A definitive side-effect-free resend rejection releases
ownership. Unknown mutation outcomes and email-update/resend splits retain ownership.
Self activation is independently resumable after consumed-code verification, token-renewal or
activation failure, and reload/sign-in; only the server current-binding check requires verification.

## Approved development and release boundary

The owner approved credential-free development and manual acceptance on 2026-10-28.
Implementation completion requires tested application artifacts, local verification and the
`family-paas` contract/handoff. AWS credentials and authenticated state remain on the human
operator's computer. Full state-backed plan review, no-replacement TTL evidence, publication,
apply and live Cognito checks remain mandatory human release gates, separate from development
completion. No preservation, authorization or provider-verification requirement is waived.
