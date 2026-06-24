# CREDIT_LIFECYCLE_SCHEDULER_MAP.md

The credit/subscription lifecycle, now fully scheduled.

```
DAILY 05:00  /api/cron/credit-expiry
              → creditExpiryService.runExpiryCheck()
              → expire FREE/incentive credits at credit_expiry_at (signup = 30d). paid never.

DAILY 05:15  /api/cron/subscription-status-expiry
              → billingSubscriptionService.markExpiredSubscriptions({db})
              → lapsed subscriptions (period + grace passed) → status='expired'
              → THIS is what drives the paid LOCK + subscription-credit expiry without a webhook.

DAILY 05:30  /api/cron/subscription-credit-expiry      (runs after status-expiry)
              → subscriptionCreditExpiryService.runSubscriptionCreditExpirySweep()
              → for EXPIRED/CANCELED subs: expire subscription FREE credits,
                capped at subscription-allocated (signup credits NOT early-expired);
                paid + incentive preserved (DB-enforced).

MONTHLY 1st 06:00  /api/cron/subscription-monthly-allocation
              → subscriptionAllocationService.runMonthlyAllocationSweep()
              → reallocate subscription FREE credits per plan (ACTIVE/TRIALING only),
                idempotent per (org, plan, period).
```

## How the lock/unlock stays correct (derived, no cron of its own)
The paid lock is a read-time gate at `creditPriorityService.computeAvailable` keyed off
`resolveSubscriptionState`. It needs the subscription to actually reach EXPIRED — which the daily
`subscription-status-expiry` sweep guarantees even when no webhook fires. Renewal (or a webhook /
monthly allocation) returns state → ACTIVE → paid auto-unlocks. No dedicated lock cron required.

## Dependencies / order
status-expiry → (credit-expiry consumes the updated state). Monthly allocation is independent.
All four are idempotent and re-entrant-safe via `runJob` + function-level keys.
