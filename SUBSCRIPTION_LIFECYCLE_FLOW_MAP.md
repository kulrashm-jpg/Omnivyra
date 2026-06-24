# SUBSCRIPTION_LIFECYCLE_FLOW_MAP.md

How `billing_subscriptions` is now populated + maintained, end to end.

## Write-path
```
Stripe customer.subscription.{created,updated,deleted}
  → pages/api/stripe/webhook.ts (deps.applySubscriptionEvent)
  → stripeWebhookService.processStripeWebhookEvent  [record_subscription branch, best-effort]
  → billingSubscriptionService.applyStripeSubscriptionEvent(eventType, obj, orgId, {db})
  → buildUpsertFromStripeSubscription (pure)  → upsertBillingSubscription
  → billing_subscriptions  (upsert on provider+provider_subscription_id)
```
Expiry (lapse without renewal):
```
daily sweep (operator/cron)
  → billingSubscriptionService.markExpiredSubscriptions({db})
  → status='expired' where status∈{active,trialing,past_due} AND current_period_end + GRACE < now
```
Read-path (entitlement):
```
billing_subscriptions  → subscriptionStateResolver.resolveSubscriptionState(orgId)
  → ACTIVE | TRIALING | GRACE | PAST_DUE | EXPIRED | CANCELED
  → subscriptionAllocationService gate (canReceiveSubscriptionCredits)
```

## Event → ledger mapping
| Stripe event | Action | Ledger effect |
|---|---|---|
| `customer.subscription.created` | upsert | row created with mapped status + periods |
| `customer.subscription.updated` | upsert | status + periods advanced (this is RENEWAL — Stripe sends the new period) |
| `customer.subscription.deleted` | upsert (forced) | `status='canceled'` |
| `invoice.payment_failed` | (via subsequent `customer.subscription.updated` status=past_due) | `status='past_due'` |
| no renewal + period+grace passed | sweep | `status='expired'` |

## State → entitlement
| Ledger status / derived | Resolver state | Entitled (new sub credits)? |
|---|---|---|
| active, within period | ACTIVE | yes |
| trialing, within trial | TRIALING | yes |
| active, period ended ≤ grace | GRACE | no (grace-eligible access; no new credits) |
| past_due, within grace | PAST_DUE | no |
| canceled / cancel-at-period-end elapsed | CANCELED | no |
| expired / paused / past grace | EXPIRED | no |

Status mapping: `mapStripeStatus` (trialing/active/past_due[+unpaid,incomplete]/paused/canceled/
incomplete_expired→expired).
