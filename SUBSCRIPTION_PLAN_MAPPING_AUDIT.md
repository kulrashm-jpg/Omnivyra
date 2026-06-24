# SUBSCRIPTION_PLAN_MAPPING_AUDIT.md

Audit of how `pricing_plans.id` was (not) derived for subscriptions, before this change.

## Checkout / subscription event → plan_id (BEFORE)
| Event | How plan_id was derived |
|---|---|
| `checkout.session.completed` | not handled (absent from classifier) |
| `customer.subscription.created` | `record_subscription` → **no plan_id** (record-only, pre-lifecycle) |
| `customer.subscription.updated` | (after lifecycle phase) upsert used **metadata.plan_id uuid only**, else **null** |

## Mapping infrastructure (BEFORE)
- `pricing_plans` columns: `id, plan_key, name, description, monthly_price, currency, is_active,
  enforcement_enabled, allow_overage, grace_percent, credits_included, validity_days`.
- **No Stripe/provider price column anywhere** (`PRICE_ID_COLUMNS: NONE`). No price-mapping table
  (only `billing_price_overrides`, unrelated to plan identity).
- `pricing_plans` is **empty (0 rows)** in prod.
- ⇒ There was **no deterministic Stripe price → plan mapping**. plan_id could only come from an
  explicit metadata uuid; everything else → null.

## Existing billing_subscriptions plan_id behavior (BEFORE)
- 0 rows. The lifecycle write-path set `plan_id` from `metadata.plan_id` (uuid) only.
- **Fallback:** none. **Null path:** any subscription without a metadata uuid → `plan_id = null`
  silently (no fail-closed signal, no price mapping).

## Gap
A real Stripe subscription (which carries a `price_id`, not our uuid) would resolve to `plan_id =
null` — i.e. no plan, with no deterministic mapping and no explicit fail-closed behavior.

## Change (this phase)
- Added `pricing_plans.provider_price_id` (nullable, unique-indexed) — the missing price→plan
  mapping column. Migration `20260624200000_pricing_plan_provider_price.sql` (applied).
- Implemented deterministic `resolvePlanId` (priority A metadata → B price_id → C legacy plan_key,
  else fail closed). See the flow + implementation reports.
