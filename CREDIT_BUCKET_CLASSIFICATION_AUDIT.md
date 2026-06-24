# CREDIT_BUCKET_CLASSIFICATION_AUDIT.md

Audit of credit categories / balance buckets and their source attribution.

## Buckets (`organization_credits`)
| Bucket | Category | Consumed | Expirable (today) |
|---|---|---|---|
| `free_balance` | `free` | 1st | yes (time-based) |
| `incentive_balance` | `incentive` | 2nd | only if config enables |
| `paid_balance` | `paid` | 3rd | **never** (top-up) |

## Source → category (who writes each bucket)
| Source | Service | Category |
|---|---|---|
| **Subscription / plan monthly** | `subscriptionAllocationService` (`reference_type='subscription_allocation'`) | **`free`** ("PLAN / monthly pool — consumed first; NEVER paid") |
| Onboarding free credits | `initialFreeCreditService` | `free` |
| Admin grant | `creditAdminGrantService` | `free` |
| Earn / invite / feedback | `earnCreditsService` | `incentive` |
| Top-up purchase | `purchaseService` (`reference_type='credit_purchase'`) | `paid` |

## Classification verdict
- **Subscription credits = the `free` pool** (system convention: plan/monthly pool, consumed first).
- **Top-up credits = the `paid` pool.**
- **Incentive credits = the `incentive` pool.**
- **Source attribution** is preserved in `credit_transactions` (`reference_type` + `reference_id`),
  but the **balance is bucketed by category, not by source** — `free_balance` mixes subscription +
  onboarding + admin-free in one number.

## Implication for subscription-credit expiry
Because `free_balance` is a single pooled bucket, "expire only subscription-issued" is implemented
as **"expire the `free` pool for a terminated subscription"**. Onboarding/admin free credits share
the pool but (a) are consumed first, so little remains once a subscription has run, and (b) have
their own time-based expiry. Precise per-source sub-balances would require a ledger-derived split
(a larger change) — documented as a follow-up. **paid + incentive are never touched** (structurally
enforced by the DB `expire` phase, which raises if those amounts are non-zero).
