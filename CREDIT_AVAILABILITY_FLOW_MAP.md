# CREDIT_AVAILABILITY_FLOW_MAP.md

How credit availability is computed, with the subscription-linked top-up gate.

## Flow
```
deduction / balance read
  → creditPriorityService.getTotalAvailable(orgId)  |  resolveDeduction(orgId, amount)
       → getWalletSnapshot(orgId)                       (raw balances — unchanged)
       → resolveTopupEntitlement(orgId, {db: supabase})
              load latest billing_subscriptions row
                no row            → usable=true   (NO_SUBSCRIPTION, legacy — not gated)
                row → state via resolveSubscriptionStateFrom → isTopupUsable(state)
                     ACTIVE/TRIALING/GRACE/PAST_DUE → usable=true
                     EXPIRED/CANCELED               → usable=false
       → computeAvailable(wallet, { topupUsable: usable })
              free      = balance − reserved        (unchanged)
              incentive = balance − reserved        (unchanged)
              paid      = usable ? balance − reserved : 0      ← DERIVED GATE
       → computeSplit(amount, available)            free → incentive → paid (order unchanged)
```

## The gate (single chokepoint)
`computeAvailable` — the only place paid availability is computed. The gate zeroes paid
*availability* when not entitled. No balance is mutated; renewal restores availability automatically
on the next read.

## State → top-up availability
| Subscription state | `availablePaid` |
|---|---|
| NO_SUBSCRIPTION (legacy) | `paid_balance − reserved_paid` (usable) |
| ACTIVE | usable |
| TRIALING | usable |
| GRACE | usable |
| PAST_DUE | usable (documented policy) |
| EXPIRED | **0 (locked)** |
| CANCELED | **0 (locked)** |

## Enforcement reach
- **Deductions:** `creditExecutionService.executeWithCredits` → `resolveDeduction` → gated
  `computeAvailable` → gated split. A locked org cannot spend top-up.
- **Total reads:** `getTotalAvailable` (admissionControl, creditSafetyGate, advisor, billingCenter)
  reflect the gated total.
- **Unaffected:** free + incentive availability, consumption ordering, ledger, balances.
