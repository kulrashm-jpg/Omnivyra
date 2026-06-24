# SUBSCRIPTION_LIFECYCLE_AUDIT.md

State of each subscription lifecycle stage. Audit only; evidence with file references.

## Stage-by-stage

| Stage | Trigger | Handler | Implemented? | Status mutation |
|---|---|---|---|---|
| **Created / ACTIVE** | `customer.subscription.created/updated` (Stripe) | `stripeWebhookService.ts:141-144,272-284` → `record_subscription` | **Record-only** | **NONE** — recorded to `payment_provider_events`, `billing_subscriptions.status` never set |
| **RENEWAL** | `current_period_end` passes + `auto_renew` | `subscriptionProjectionService.ts:68-98` `listRenewalsDue()` (forecast) | **SCAFFOLDING** — file is read-only; `subscriptionRenewalJob.ts` is "future Phase 6"; not in `cron.ts` | NONE |
| **Monthly credits** | should occur at renewal | `subscriptionAllocationService.ts:86-118` | **Partial** — allocates `category:'free'` keyed off plan assignment, **no status check** (`:103-105`) | NONE |
| **PAST_DUE / failed renewal** | `invoice.payment_failed` | `stripeWebhookService.ts:286-301` → `fail_purchase` (top-up purchases only) | **ABSENT** for subscriptions | NONE — no transition to `past_due` |
| **GRACE PERIOD** | — | — | **ABSENT** — no `grace`/`dunning`/retry column or code | n/a |
| **CANCELED (soft)** | set `cancel_at_period_end` | no endpoint | **ABSENT** — flag exists, never set | NONE |
| **CANCELED (hard)** | `customer.subscription.deleted` | `stripeWebhookService.ts` → `record_subscription` | **Record-only** | NONE |
| **EXPIRED** | `current_period_end < now` | — | **ABSENT** — no cron/trigger sets `expired`; status goes stale | NONE |

## What the webhooks actually do
All `customer.subscription.*` and `invoice.*` events are **append-only records** in
`payment_provider_events`; the reconciler may emit compensating audit rows but takes no state
action (`stripeWebhookService.ts:272-284`). Razorpay/Cashfree handle only `payment.captured`-class
success events; no subscription events at all.

## Credit expiry vs subscription expiry (distinct, unlinked)
`creditExpiryService.ts` expires `free`/`incentive` credits on a **time basis**
(`free_credit_profiles.credit_expiry_at`), explicitly never `paid`, and **never reads
`billing_subscriptions.status`**. So credit expiry is not tied to subscription lifecycle.

## Answers
- **What happens during failed renewal today?** **Nothing.** `invoice.payment_failed` is recorded;
  no `past_due` transition, no dunning/retry, no effect on credits or access. (Recommended:
  status→`past_due`, enter grace, suspend new subscription-credit grants.)
- **What happens during grace period today?** **No grace period exists** — no schema field, no
  code. (Recommended: a window after `current_period_end`/`past_due` during which subscription
  credits are not renewed but top-up remains AVAILABLE; on grace end → expire + lock.)
- **What event should UNLOCK top-up?** Subscription becoming entitled again — renewal/checkout
  success / `invoice.payment_succeeded` setting `status='active'` with a future `current_period_end`
  (i.e. `resolveSubscriptionState → ACTIVE/TRIALING/GRACE`).
- **What event should LOCK top-up?** Subscription ceasing to be entitled — expiry
  (`current_period_end` + grace passed) or effective cancellation (`status` canceled/expired).

## Net verdict
The subscription **schema exists** but the **lifecycle is essentially unimplemented**: webhooks
record without mutating, renewal is scaffolding, and past_due/grace/cancel/expiry transitions are
absent. Subscriptions remain in whatever state they were created in, indefinitely — which is why
`billing_subscriptions` cannot yet serve as an enforceable source of truth without first building
the lifecycle write path.

Audit only — no implementation, writes, or migrations.
