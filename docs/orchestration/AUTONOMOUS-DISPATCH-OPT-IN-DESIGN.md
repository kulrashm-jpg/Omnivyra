# Autonomous dispatch: future tenant opt-in design

**Status: design only. Autonomous dispatch stays disabled.** Nothing here is built or authorized.

## Current state, proven

| Engine | Behaviour for an `autonomous` step |
|---|---|
| WS-3 | Submitted for human approval. The live gate requires approval on record (`governance.ts`) |
| WhatsApp | **Refuses.** Real-schema test: `human`, `assisted` and `autonomous` all create no broadcast and call nothing |
| Community | Needs an approved action; an action needing no approval is not treated as approved |
| Social | Observes only; nothing to dispatch |
| Browser | Refuses everything |

`execution_mode` is recorded and reported, and grants nothing. The parked rule that would have allowed it (PI-041-A-H, `pending && requiresApproval !== true`) was deliberately not ported, and its tests are skipped with that reason.

**Fixed in this phase:** WhatsApp had no approval check at all, so it was effectively autonomous whenever the flag was on, in every mode. That is why this design says "provably off" and not "off by convention".

## Principle

Autonomy is a **separately granted, revocable, narrow, tenant-held permission**, never an implication of how a step was authored. Authoring `autonomous` expresses intent; only this policy can make it real.

## All of these must hold for one send

| # | Control | Default |
|---|---|---|
| 1 | Platform flag `WORKFLOW_AUTONOMY_ENABLED` | Off |
| 2 | Platform allow-list of the tenant | Empty |
| 3 | Tenant policy row, active and unexpired | None |
| 4 | Policy covers this channel | None |
| 5 | Policy covers this workflow **version**, not the workflow | None |
| 6 | Step authored `autonomous` | n/a |
| 7 | Caps: per day, per person, per version | Required, no unlimited |
| 8 | Every existing gate: kill switch, enablement, consent, suppression, quota, PI closed state, response exit | Unchanged |

Any failure means the step goes to the human queue, not that it is dropped.

**Pinning to a version matters:** publishing a new version does not inherit autonomy, because someone must decide about the new content.

## Policy record

New append-only table `tenant_autonomy_policies`. Justified because no existing store grants a time-boxed, scoped permission: `outreach_governance_config` is current state with no history and no scope.

Fields: tenant, channel, workflow version, caps, `granted_by`, `granted_at`, `expires_at` (required, maximum 90 days), `revoked_at`, `revoked_by`, and acknowledgement text version. No FK on actors, following the DEFECT-008 pattern. Revocation appends; it never updates history.

## Who may grant

New capability `OUTREACH_AUTONOMY_MANAGE`: COMPANY_ADMIN only, **step-up required**, not grantable by direct assignment.

Platform enablement is separate and requires `OUTREACH_PLATFORM_MANAGE`, so two parties are always involved. A tenant cannot self-enable. A platform admin cannot enable a tenant's autonomy on their behalf.

## Prerequisites before this is built

1. Tenant approval, built and used. Autonomy only makes sense as a step up from an approval history.
2. Email evidence erasure policy in force, because autonomous sends produce evidence with no human having seen it.
3. Provable real-provider sends on each channel.
4. Decision on legal basis per jurisdiction. Automated contact has different requirements in some, which is outside what engineering can decide.

## Observability

Every autonomous send records: the policy id it relied on, its caps at the time, and a rendered-content hash. The journey report separates autonomous from human-approved counts. An anomaly stop pauses the policy automatically on bounce or complaint rate above a threshold (values to be decided).

## Rollout

Shadow mode first: for each step, record "would have sent autonomously" while still requiring approval. Compare with human decisions. Only then enable, one tenant, one channel, one version, low caps.

## Tests required when built

Default refuses (each of the 8 controls, one at a time); expiry; revocation mid-sweep; new version does not inherit; caps enforced under concurrency; response exit still wins; kill switch still wins; revoke needs no deploy.

## Decisions needed, when you choose to pursue this

| # | Decision |
|---|---|
| AU-1 | Whether to pursue at all, and after which milestone |
| AU-2 | Maximum policy duration, and caps |
| AU-3 | Anomaly thresholds |
| AU-4 | Legal review of automated contact, per jurisdiction |
