# PI-ADR-007 — enrichment execution authority and spend governance

**Status:** ACCEPTED by the programme owner, 2026-09-25.
**Base SHA:** `8621b1d93cb6f6a878c0156277c9f5112949fb0a` · **Decision id:** `OD-A` (PI-DECISIONS-001).
**Closes:** `NF-09` (enrichment spend governance).
**Does not change:** `PI-ADR-002`, `PI-ADR-004`, `PI-ADR-006`. **Does not decide:** `OD-B`, `ARCH-1` — see §7.

---

## 1. The decision

The programme owner was asked two questions and answered both explicitly. They are recorded here verbatim, because the whole of this ADR is the implementation of these two answers and nothing else.

> **Is tenant self-serve billable enrichment intended, and at which roles?**
> **— Self-serve, admin-tier only.**

> **What spend-governance posture applies?**
> **— Required: no ceiling, no call.**

Concretely:

- Tenant self-serve enrichment **is** intended. A tenant funds provider calls with its own stored credential, and the platform does not need to enable each tenant individually.
- It is **admin-tier only**. A new capability, `PROSPECT_ENRICH_EXECUTE`, is granted to `COMPANY_ADMIN` and `SUPER_ADMIN` and to nothing else — exactly as narrowly as `PROSPECT_INGEST` and `PROSPECT_ICP_MANAGE`.
- A daily provider-call ceiling is now **required**. An enrichment call proceeds only when a ceiling is resolvable for that tenant and provider and the tenant is under it. An absent ceiling is a refusal, not permission.

## 2. What was wrong, stated factually

Two separate defects, one per question.

**Authorization.** `POST /api/prospects/:id/enrich` called `requireTenantAccess(req, res, companyId)` with no options and no capability. `requireTenantAccess` filters by role only when `requireRoleIn` is supplied, and no PI route supplies it, so **every active member of the tenant at any of the seven canonical roles — including `VIEW_ONLY`, whose entire grant set is `CAMPAIGN_VIEW`, `MFA_ENROLL`, `MFA_VIEW_FACTORS` — could cause a real, billable provider call.** Meanwhile importing a single prospect required admin-tier `PROSPECT_INGEST`. Spending the tenant's money was easier than adding a row to it.

**Spend governance.** The ceiling mechanism was fully built and correctly wired to the production singleton (`cost.ts` constructs `tenantFundedExecutionPort` with `allow: makeDailyCallCeilingAllow()`), but it was inert: `makeDailyCallCeilingAllow` consulted a global environment switch first and returned permitting **before any I/O** when it was off, and off was the default. A second gate then treated an unconfigured tenant as unlimited. So the mechanism existed and enforced nothing.

Note what was **not** wrong, because an earlier audit reported it and it was incorrect: `tenantFundedExecutionPort` did **not** "authorize unconditionally". It carried the ceiling. The ceiling simply never fired.

## 3. Authorization — the capability

`PROSPECT_ENRICH_EXECUTE` is a new, per-tenant capability. It is deliberately its own capability rather than a reuse of the two that exist, on the same reasoning `PROSPECT_ICP_MANAGE` gives for not reusing `PROSPECT_INGEST`:

| Capability | Authorises | Blast radius |
|---|---|---|
| `PROSPECT_INGEST` | an assertion about one person | one row; no network, no credential, no money |
| `PROSPECT_ICP_MANAGE` | a definition governing every prospect | tenant-wide scoring input; no money |
| **`PROSPECT_ENRICH_EXECUTE`** | **egress to a third party against the tenant's own credential, which the vendor bills** | **money and an outbound call, per invocation** |

Conflating enrichment with ingestion would mean that permission to import a CSV silently carried permission to spend. That is capability inflation of exactly the kind `PROSPECT_INGEST`'s own comment refuses.

It holds **no hierarchy relationship** in either direction: it neither implies nor is implied by anything, and in particular holding it does not imply `PROSPECT_INGEST`. It is **not** step-up gated: step-up is reserved for platform-tier and irreversible actions, and a bounded, ceiling-capped tenant-funded call is neither.

Enforcement follows the pattern the three `lead-ingestion` routes already use — membership first, capability second, bound to the **verified** tenant id:

```
requireTenantAccess(req, res, companyId)      // WHICH tenant, and is the caller in it
requireCapability(req, res, {                 // WHETHER this principal may spend
  capability: PROSPECT_ENRICH_EXECUTE,
  organizationId: companyId,
})
```

`requireCapability` writes its own 401/403 and audits the decision, so no new refusal vocabulary is introduced here.

## 4. Spend governance — required, not optional

`makeDailyCallCeilingAllow` is inverted. Three changes, and no others:

1. **The global bypass is removed.** `ENABLE_ENRICHMENT_SPEND_CEILING` and `isSpendCeilingEnabled()` are gone. A switch whose only function is to disable the control contradicts a decision that the control is required; keeping it would mean the posture depended on an environment variable being remembered.
2. **An absent ceiling refuses.** `resolveCeiling(...) === null` now yields a refusal rather than permission. "Not configured" is not "unlimited".
3. **Everything already fail-closed stays fail-closed.** An unreadable count, a non-numeric count, and `used >= ceiling` all continue to refuse. `>=` semantics are unchanged: a ceiling of N permits the Nth call and refuses the N+1th.

What is deliberately **not** changed: the ledger (`prospect_enrichment_attempts` remains the single source of usage; no spend table is introduced), the UTC day boundary, the treatment of `provider_call_state = 'unknown'` as consuming capacity, the per-provider override in flag metadata, and the executor's gate order (adapter → credential → attribute → duplicate suppression → cost → call). A refusal still produces `cost_denied` with zero transport, through the branch `executeEnrichment` already has.

**No billing behaviour is introduced.** No credits are reserved, no monetization registry is consulted, and the vendor continues to invoice the tenant directly. The ceiling counts calls; it does not price them.

## 5. The operational consequence, stated plainly

This is the part that must not be discovered after deployment.

**After this lands, enrichment refuses for every tenant that has no `enrichment_spend_ceiling` flag row.** If no tenant currently holds one — which is unverified, because production flag state has never been read — then enrichment is effectively off in production until ceilings are provisioned.

That is the intended meaning of "required: no ceiling, no call", and it is the direction the owner chose knowingly: an unbounded vendor bill becomes structurally impossible, at the cost of requiring a deliberate per-tenant ceiling before any tenant can spend. Provisioning those rows is an operator action, is not part of this workstream, and is not performed by it.

## 6. Verification standard

Because this ADR changes an authorization boundary and a money path, the tests must establish both halves in both directions: that an admin-tier principal still succeeds, that every excluded role is refused, that a cross-tenant attempt fails, that an absent ceiling now refuses, that an over-ceiling tenant is refused, that a tenant under a configured ceiling still proceeds, and — the property that matters most — that **no refusal path reaches the provider**. No real provider call is made to prove any of this; the executor's ports are the seam the existing suites already drive.

The three assertions in `piM1SpendCeiling.test.ts` that pinned the old permit-on-absent behaviour are **deliberately superseded, not deleted**: they are replaced by their inverses, in place, so the change of contract is visible in the diff rather than silent.

## 7. What this does not decide

- **`OD-B` — who may record a business outcome.** Untouched. `POST /api/outreach/outcomes` remains membership-only and no capability governs outcomes; that is the next decision in PI-DECISIONS-001, not this one.
- **`ARCH-1` — whether outcome evidence may inform derived intelligence.** Untouched. The observational wall stands and the lifecycle ledger still has no runtime caller.
- Whether any tenant *should* be granted a ceiling, and of what size. That is an operator action.
- The provider adapters, the credential store, the credential control-plane route (settled separately by NF-06), the enrichment planner, and the freshness/duplicate-suppression window. None is modified.
- `NF-05`, `NF-07`, `G-07`, `PROD-1`, `OD-C`, `D-1`, `D-4`, `003B-OPEN-1` — all remain exactly as deferred.
