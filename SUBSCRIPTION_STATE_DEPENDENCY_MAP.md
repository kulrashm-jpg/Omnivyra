# SUBSCRIPTION_STATE_DEPENDENCY_MAP.md

Writers/readers of the two subscription tables, and the entitlement dependency graph.

## Writers
| Table | Writer | Notes |
|---|---|---|
| `organization_plan_assignments` | `pages/api/super-admin/plans/assign.ts:41` (upsert) | only writer; super-admin assigns plan tier; **no status/period** |
| `billing_subscriptions` | **none in app code** | webhooks record to `payment_provider_events` only; table is **inert/empty (0 rows)** |

## Readers
| Table | Reader | Purpose | Source-of-truth role |
|---|---|---|---|
| `organization_plan_assignments` | `planResolutionService.resolveOrganizationPlanLimits`, `usageEnforcementService`, `billingCenterService`, `pages/api/user/subscription`, `subscriptionAllocationService.resolvePlanKey`, `customerReadinessService` | plan TIER + limits + UI | tier (which plan) |
| `billing_subscriptions` | `subscriptionProjectionService` (forecast), `billing/reconciliation/stripeReconciler` (audit) | forecast/reconcile | lifecycle status — **read but not enforced** |

## Dependency graph (before → after this phase)

| Function | Before (entitlement source) | After |
|---|---|---|
| **credit allocation** (`subscriptionAllocationService.allocateMonthlyCreditsForOrg`) | plan assignment only — **no validity check** | **+ `resolveSubscriptionState` gate** (CANCELED/EXPIRED/PAST_DUE/GRACE blocked from new credits) |
| **allocation sweep** (`runMonthlyAllocationSweep`) | iterates plan assignments | unchanged (each org now gated by resolver) |
| **billing/checkout** | — (no checkout writes billing_subscriptions yet) | unchanged (lifecycle write-path still TODO) |
| **webhook processing** | record-only | unchanged (out of scope) |
| **renewal** | scaffolding (`subscriptionProjectionService`, no job) | unchanged (out of scope) |
| **cancellation** | none (status never set) | unchanged (out of scope) |
| **UI entitlement** | tier via plan assignment | unchanged (tier display); resolver available for future top-up lock/UI |
| **usage enforcement (limits)** | plan tier limits | unchanged (tier, not validity) |

## The single new authority
`backend/services/subscriptionStateResolver.ts` — `resolveSubscriptionState(orgId)` is now the
one place that decides subscription validity. It reads `billing_subscriptions` (latest row) with
a **legacy fallback** to plan-assignment presence (so admin-assigned plans without a
billing_subscriptions row resolve ACTIVE). Wired into allocation; ready to be the future source
for the top-up lock gate (`creditPriorityService.computeAvailable`, out of scope here).

## Why no other entitlement checks were migrated
There were **no pre-existing subscription-validity checks** to migrate — only tier resolution
(which legitimately stays on plan assignment). The resolver is therefore *introduced* as the
validity authority and wired into the one place that needed it (allocation). Tier/limits/UI
readers are unchanged.
