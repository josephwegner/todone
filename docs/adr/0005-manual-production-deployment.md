# ADR 0005: Use Reviewed Manual Production Deployment

- Status: Proposed
- Date: 2026-08-05

## Context

Todone has one production environment, no staging environment, and private family data. Automatic deployment on every commit would turn source changes into production changes without a deliberate review or smoke-test decision. A second persistent environment is not justified by current scale and cost constraints.

## Decision

Use local simulation and automated CI as pre-production verification. Deploy to the single production environment only through a reviewed manual process after all required checks and infrastructure plans pass.

A human release owner explicitly authorizes and performs infrastructure apply, application publication, production user setup, live smoke testing, rollback, and restore. Agents may prepare commands, plans, and evidence but MUST NOT execute production-changing actions without explicit authorization.

Application development completion is separate from release approval. Local build/test and
artifact preparation require no AWS credentials or Terraform state. Credentials and authenticated
state remain on the human operator's computer; `family-paas` owns account-specific resource
wiring. The operator supplies the real plan and release checks before deployment. Completing
application work never substitutes local/mock evidence for those checks.

Retain identifiable prior frontend and Lambda artifacts. Record the deployed artifact IDs, reviewed Terraform plan, smoke result, and rollback target for each release.

## Consequences

- Production changes remain deliberate and auditable.
- CI success is necessary but never sufficient authorization to deploy.
- Some environment-only issues are found in the human-authorized smoke test rather than staging.
- Rollback procedures and artifact retention are mandatory.
- Infrastructure/data migrations must be backward-compatible or have a separately reviewed roll-forward plan; blindly applying an old Terraform plan is not rollback.
- A staging environment can be introduced later only with a new cost and risk decision.
