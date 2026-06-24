# STRIPE_PLAN_MAPPING_FLOW.md

Deterministic resolution of a subscription event → `pricing_plans.id`.

## Flow
```
customer.subscription.* (obj)
  → applyStripeSubscriptionEvent
  → resolvePlanId(obj, {db})                    [deterministic, fail-closed]
       A. metadata.plan_id (uuid)  --verify in pricing_plans-->  planId   [source: metadata]
       B. price_id (obj.plan.id | items[0].price.id)
              --pricing_plans.provider_price_id = price_id-->     planId   [source: price_map]
       C. metadata.plan_key  --pricing_plans.plan_key (is_active)--> planId [source: legacy_plan_key]
       else: planId = null                                                  [source: unmapped_price | none]
  → buildUpsertFromStripeSubscription(obj, org, resolvedPlanId)
  → billing_subscriptions.plan_id
```

## Priority (exact)
| # | Source | Match | Wins when |
|---|---|---|---|
| A | `metadata.plan_id` | uuid that exists in `pricing_plans.id` | explicit, authoritative |
| B | Stripe `price_id` | `pricing_plans.provider_price_id = price_id` | normal Stripe checkout/upgrade/downgrade |
| C | `metadata.plan_key` | `pricing_plans.plan_key` (is_active=true) | legacy migration / manual |
| — | none | — | **fail closed → plan_id null** |

## Fail-closed semantics
- A `price_id` present but unmapped → `planId=null`, `source='unmapped_price'` (never guesses a
  default plan). The subscription row is still written (state is known) with `plan_id=null`, so
  downstream credit allocation gets `no_plan` (no credits) — fail closed at the money layer.
- No price and no metadata → `planId=null`, `source='none'`.

## price_id extraction
`extractPriceId(obj)` = `obj.plan.id` ?? `obj.items.data[0].price.id` ?? null.

## Upgrade / downgrade
A `customer.subscription.updated` carrying a different `price_id` re-resolves via B → the upserted
`plan_id` changes to the new plan. Same `price_id` on renewal → same `plan_id` (preserved).
