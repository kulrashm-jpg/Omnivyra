# SUBSCRIPTION_STATE_FLOW_MAP.md

Every location that computes/reads subscription state, and the two tables involved. Audit only;
evidence with file references.

## Two state-bearing tables (they have diverged)

| Table | Migration | State fields | Written by | Read by |
|---|---|---|---|---|
| **`organization_plan_assignments`** | `database/pricing_plans.sql:36-44` | `organization_id` (UNIQUE), `plan_id`, `assigned_at` — **NO status, NO period/validity/expiry** | `pages/api/super-admin/plans/assign.ts:41` (super-admin upsert) — **actively written** | allocation, enforcement, UI (see below) |
| **`billing_subscriptions`** | `20260664_phase2_governance_and_payment_foundation.sql:164-189` | `status` (trialing/active/past_due/paused/canceled/expired), `current_period_start/end`, `trial_ends_at`, `cancel_at_period_end`, `auto_renew` | **NOBODY** — webhooks record only to `payment_provider_events`; no app code writes this table | forecast + reconciliation only |

## Every reader/computer of subscription state

### Reads `organization_plan_assignments` (the de-facto "is subscribed")
| File:function | Reads | Concludes |
|---|---|---|
| `planResolutionService.ts:32-110` `resolveOrganizationPlanLimits()` | assignment → plan_id → plan_key + limits | canonical plan/limits; null = no plan |
| `subscriptionAllocationService.ts:70-80` `resolvePlanKey()` + `:143-145` sweep | assignment → plan_key | which plan to allocate monthly credits for |
| `usageEnforcementService.ts:68-95` | assignment + plan_limits + meter | allow/deny usage |
| `billingCenterService.ts:56-80` | assignment → plan_key | "current plan" shown in billing UI |
| `pages/api/user/subscription.ts:28-42` | assignment (via resolver) | tier (defaults 'free') for feature gates |
| `pages/api/super-admin/plans/{assign,get-organization-plan,analytics}.ts` | assignment | admin plan read/write |
| `customerReadinessService.ts:320-322` | bulk org→plan | readiness aggregation |

### Reads `billing_subscriptions` (forecast/audit only — drives NO behavior)
| File:function | Reads | Concludes |
|---|---|---|
| `subscriptionProjectionService.ts:31-66` `projectOrgSubscriptions()` | period_end, status, auto_renew | days-until-renewal forecast (not persisted) |
| `subscriptionProjectionService.ts:68-98` `listRenewalsDue()` | status IN (active,past_due) ∧ auto_renew ∧ ¬cancel_at_period_end ∧ period_end≤cutoff | "would renew if a job ran" — **never called** |
| `billing/reconciliation/stripeReconciler.ts:121-140` | status/period vs Stripe | reconciliation matching (read-only) |

### No canonical resolver
There is **no** `isActiveSubscription` / `getSubscriptionState` / `subscriptionStatus` function
anywhere. "Subscribed" is inferred from the mere **existence of an `organization_plan_assignments`
row** — which carries no status, no period, no expiry.

## The divergence (core finding)
- The **rich lifecycle state** (`status`, periods, cancel flags) lives in `billing_subscriptions`
  — but **nothing writes it and nothing enforces it**.
- The **behavior-driving signal** is `organization_plan_assignments` — but it has **no
  status/validity**, so it cannot express active/expired/cancelled/grace.
- Result: an org whose Stripe subscription is `canceled`/`expired` keeps receiving monthly credits
  and passes all gates, because allocation/enforcement read only the (statusless) plan assignment
  and never check `billing_subscriptions.status` (`subscriptionAllocationService.ts:103-105` — no
  status check).

Audit only — no implementation, writes, or migrations.
