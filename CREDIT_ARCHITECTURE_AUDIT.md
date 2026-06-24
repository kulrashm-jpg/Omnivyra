# CREDIT_ARCHITECTURE_AUDIT.md

Phase 1 — full credit architecture audit. Audit only.

## 1. Balance buckets (`organization_credits`)
`free_balance`, `incentive_balance`, `paid_balance` (+ `reserved_*`, `lifetime_*`). These are
**consumption-tier** buckets (free=1st, incentive=2nd, paid=3rd), **not source buckets**.

## 2. Categories
`free | incentive | paid` (on `credit_transactions.category` + `*_delta`).

## 3. Reference types (source attribution in the ledger)
`subscription_allocation`, `credit_purchase`, `initial_free_credit`, admin grant, earn/incentive,
`expiry`, `subscription_expiry`. `credit_transactions` also has **`expires_at`** (per-grant expiry)
and `free/paid/incentive_delta`.

## 4. Allocation services
| Source | Service | Category | Expiry |
|---|---|---|---|
| Signup / trial | `initialFreeCreditService` | **free** | default **50 / 14d** (config `free_credit_config.initial_free_credit`), via `free_credit_profiles.credit_expiry_at` |
| Subscription monthly | `subscriptionAllocationService` | **free** | none today (subscription-credit expiry added this series, expires the free pool) |
| Admin grant | `creditAdminGrantService` | **free** | default 14d (or 0 = no expiry) |
| Promo / earn | `earnCreditsService` | **incentive** | per `free_credit_config` incentive_expiry (often off) |
| Top-up purchase | `purchaseService` | **paid** | never |

## 5. Deduction services
`creditExecutionService.executeWithCredits / executeWithEntryConsumption` → `creditPriorityService.resolveDeduction` → RPC `apply_credit_reservation`. Single authority.

## 6. Availability calculations
`creditPriorityService.computeAvailable` (the chokepoint), `getTotalAvailable`, `resolveDeduction`. Top-up lock gate added (paid→0 when not entitled).

## 7. Expiry jobs
`creditExpiryService` (time-based free + optional incentive; paid never). `subscriptionCreditExpiryService` (this series — expires the **free** pool on terminal subscription).

## 8. Subscription gates
`subscriptionStateResolver` (6 states) → allocation gate (`canReceiveSubscriptionCredits`) + top-up lock (`resolveTopupEntitlement` → gates **paid** only).

## 9. Notification systems
`creditAlertService` (in-app `notifications` + `credit_alert_log` 24h dedup; thresholds only **20% / 10%**), `NotificationBell`. Email via `send-transactional-email` Edge Function (no credit-alert type).

## 10. Forecasting systems
`creditAdvisor/*`: `creditForecastService` (runway, exhaustion), `consumptionMetricsService` (burn), `preExecutionImpactService`, `upgradeAdvisorService`, `executiveIntelligenceService` (`exhaustion_within_30d`), `admissionControl`.

## 11. UI balance displays
`BillingCenter`, `TopUpPanel`, `BillingSummaryWidget`, `CreditPill` (Header/GlobalHeader), `ActivityCostRange`, `CreditAdvisorBanner`, `pages/company/billing`, `pages/company/credits`.

## 12. APIs exposing balances
`/api/user/subscription`, `/api/company/billing/summary` (billingCenterService), `/api/credits/*` (advisor/executive/optimization), `/api/billing/activity-cost-range`, CreditPill source endpoint.

---

## Where each credit type currently lives
| Approved type | Current home |
|---|---|
| **Trial credits** | category `free` (`initial_free_credit`, default 50/14d) — **mixed in free_balance** |
| **Subscription credits** | category `free` (`subscription_allocation`) — **mixed in free_balance** |
| **Admin credits** | category `free` (admin grant) — **mixed in free_balance** |
| **Promotional credits** | category `incentive` (earn) |
| **Top-ups** | category `paid` |

## Conflicts with the approved model
1. **`free` conflates THREE approved buckets** (TRIAL + SUBSCRIPTION + ADMIN) — they require
   different expiry (30d vs cycle vs never) and different consumption order (1st vs 2nd vs 3rd).
   A single `free_balance` cannot represent them.
2. **Admin credits mis-bucketed:** today `free` (consumed 1st, 14d expiry). Approved = PERSISTENT
   (never expire, consumed LAST, subscription-locked).
3. **Promo credits mis-bucketed:** today `incentive` (consumed 2nd, may expire). Approved =
   PERSISTENT (never expire, consumed LAST, subscription-locked).
4. **Top-up:** today `paid` (consumed last, never expire, now subscription-locked) — closest match,
   but PERSISTENT must also include promo + admin (currently elsewhere).
5. **Consumption order:** current `free→incentive→paid` ≠ approved `trial→subscription→persistent`
   (admin is consumed first today but should be last; promo second but should be last).
6. **Subscription-credit expiry (this series):** expires the **whole `free` pool**, which would
   WRONGLY expire trial + admin credits (they're mixed in `free`). Approved: only subscription
   expires at cycle end; trial at 30d; admin never.
7. **Top-up lock (this series):** gates only `paid`. Approved PERSISTENT lock must also gate promo
   (`incentive`) + admin (`free`).
8. **Trial amount/expiry:** service default 50/14d vs approved 300/30d (prod config must be verified).

**Conclusion: the approved source-bucket model does NOT map onto the current consumption-tier
category model. Multiple existing behaviors conflict — STOP and report (this audit).**
