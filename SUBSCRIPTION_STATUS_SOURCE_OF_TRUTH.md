# SUBSCRIPTION_STATUS_SOURCE_OF_TRUTH.md

The single canonical source for active/expired/renewed/cancelled/grace. Audit only.

## Current reality: NO single source of truth (split-brain)

| Concern | Today's de-facto source | Problem |
|---|---|---|
| "Org has a plan" (allocation, enforcement, UI) | **`organization_plan_assignments`** (row exists) | has **no status / period / expiry** — cannot represent active vs expired vs cancelled vs grace |
| Lifecycle status (active/expired/cancelled/past_due/trialing/paused) | **`billing_subscriptions.status`** | **never written, never enforced** — inert |

Neither table alone is a correct source of truth:
- `organization_plan_assignments` is **populated but stateless**.
- `billing_subscriptions` is **stateful but unpopulated/unenforced**.

## Recommended canonical source of truth
**`billing_subscriptions` must become the authoritative subscription-state table**, exposed
through ONE resolver that every consumer calls:

```
resolveSubscriptionState(orgId) → {
  state: 'ACTIVE' | 'TRIALING' | 'GRACE' | 'PAST_DUE' | 'EXPIRED' | 'CANCELED' | 'NONE',
  periodEnd, cancelAtPeriodEnd, planId, isEntitled  // isEntitled = state ∈ {ACTIVE,TRIALING,GRACE}
}
```

Derivation (read-time, deterministic):
- `ACTIVE`/`TRIALING` — `status` active/trialing AND `current_period_end > now`.
- `GRACE` — `past_due` (or period_end passed) AND within grace window (e.g. `current_period_end + GRACE_DAYS > now`).
- `EXPIRED` — `current_period_end (+ grace) < now` and not renewed.
- `CANCELED` — `status = canceled` OR (`cancel_at_period_end` AND period ended).
- `NONE` — no subscription row.

This resolver is what should be consumed by: `subscriptionAllocationService` (gate allocation),
the **top-up lock chokepoint** (`creditPriorityService.computeAvailable`), `usageEnforcementService`,
and all billing UI.

## Prerequisite (must precede enforcement)
`billing_subscriptions` is currently inert. Before the resolver can be trusted, the lifecycle
**write path must exist**: checkout creates the row; webhooks update `status`/periods; a
renewal/expiry job advances periods and flips `expired`. Until then, the only populated signal is
the statusless `organization_plan_assignments`, which cannot drive lock/unlock correctly.

## Reconciling the two tables
`organization_plan_assignments` should be reduced to **"which plan"** (entitlement tier) and
`billing_subscriptions` should own **"is it currently valid"** (state). Allocation must read
BOTH: plan from assignment (or from the subscription's `plan_id`), gated by
`resolveSubscriptionState(orgId).isEntitled`.

## Answer — what function should determine active subscription?
A **new single resolver `resolveSubscriptionState(orgId)` / `isActiveSubscription(orgId)` over
`billing_subscriptions`** (as above). It does **not exist today**; today "active" is wrongly
proxied by the existence of a statusless `organization_plan_assignments` row.

Audit only — no implementation.
