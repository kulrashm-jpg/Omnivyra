# BILLING_CREDIT_VALIDITY_AUDIT.md

Audit of the credit / subscription / top-up / ledger implementation to determine **where the
target validity policy should be enforced**. Audit only — no implementation, migrations, writes,
or sends. Evidence with file references.

## Executive summary
- The ledger is **bank-grade and source-attributed**: subscription vs top-up credits are fully
  distinguishable (`category` + `reference_type`).
- The **consumption-order policy is already satisfied** today (free→incentive→paid ⇒ subscription
  before top-up) — see [CREDIT_CONSUMPTION_FLOW_MAP.md](CREDIT_CONSUMPTION_FLOW_MAP.md).
- The **usage-projection mechanism for email gating already exists** (credit-advisor forecast).
- The genuine gaps are all **subscription-state-linked**: subscription-credit expiry on period
  end, and **top-up lock/unlock** when a subscription lapses/renews — neither exists today. Plus
  the 80/90/95 session warnings and the 85%+projection email (see the other two docs).

---

## STEP 1 — Credit ledger architecture

| Artifact | Location | Role |
|---|---|---|
| `credit_transactions` | `supabase/migrations/20260322_expiry_category_guard.sql` | append-only ledger; cols incl. `category` ('free'/'paid'/'incentive'), `reference_type`, `reference_id`, `*_delta`, `execution_phase`, `idempotency_key` |
| `organization_credits` | same migration | wallet snapshot: `free_balance`, `paid_balance`, `incentive_balance`, `reserved_*`, `lifetime_*` |
| `credit_purchases` | `20260322_monetization_foundation.sql` | payment-gateway order ledger (`package_id`=top-up, `plan_id`=plan) |
| `usage_events` | `database/usage_events.sql` | per-call telemetry (tokens/cost) |
| `credit_hold_policy_snapshots` | `20260666_credit_hold_policy_snapshots.sql` | frozen pricing at HOLD time |
| `creditExecutionService` | `backend/services/creditExecutionService.ts` | **single authority** — HOLD→CONFIRM/RELEASE, idempotent |
| balance calculator | `backend/services/creditPriorityService.ts` | `getWalletSnapshot`, `computeAvailable`, `getTotalAvailable`, `computeSplit` |
| subscription allocation | `backend/services/subscriptionAllocationService.ts` | `allocateMonthlyCreditsForOrg()` → `createCredit(category:'free', reference_type:'subscription_allocation')` |
| top-up allocation | `backend/services/purchaseService.ts` | `completePurchase()` → `createCredit(category:'paid', reference_type:'credit_purchase')` |

**Answers:**
- **Subscription credits stored:** `organization_credits.free_balance` (wallet) + `credit_transactions` rows with `category='free'`, `reference_type='subscription_allocation'`.
- **Top-up credits stored:** `organization_credits.paid_balance` + `credit_transactions` rows with `category='paid'`, `reference_type='credit_purchase'`.
- **Distinguishable?** **YES** — by both `category` and `reference_type`.
- **Source attribution preserved?** **YES** — `reference_type` + `reference_id` + `note` + per-category `*_delta` on every transaction.

---

## STEP 2 — Consumption logic (summary; full map in companion doc)
- Balance computed in `creditPriorityService` (`computeAvailable` = balance − reserved per category); checked via `getTotalAvailable` inside `creditExecutionService.resolveDeduction`.
- Deduction performed by `creditExecutionService.executeWithCredits` / `executeWithEntryConsumption` → repository `callCreditReservation` → RPC `apply_credit_reservation` (`supabase/migrations/20260323_remove_balance_credits.sql`).
- **Ordering:** `computeSplit()` is hardcoded **free → incentive → paid** and **deterministic**. ⇒ subscription (free) is consumed before top-up (paid). **Policy item 3 already holds.**
- Enforcement is wired but **dark**: `phase2EnforcementGate` defaults to `'off'`.

---

## STEP 3 — Subscription expiry / renewal / plan change

| Area | Finding | Evidence |
|---|---|---|
| Expiry processing | Subscriptions have status incl. `expired` but **no business logic acts on it**; webhooks are record-only | `billing_subscriptions` (`20260664…sql`); `stripeWebhookService.ts:272-283`; `webhooks/payments/[provider].ts` |
| Renewal | **Scaffolding only** — `subscriptionProjectionService.listRenewalsDue()` is read-only; the renewal cron that would re-grant credits is explicitly future work | `subscriptionProjectionService.ts:1-11,68-96` |
| Plan change | `plans/assign.ts` grants plan credits to **`category:'paid'`** (note: not 'free') on assignment | `pages/api/super-admin/plans/assign.ts:59-75` |
| Credit expiry | **Time-based only** (`free_credit_profiles.credit_expiry_at`); `paid` is **structurally never-expiring**; **not** linked to subscription status | `creditExpiryService.ts:25-31,152` |
| Lock/unlock | **NONE** tied to subscription. Only **manual** `emergency_freeze` / `billing_lock` | `orgFinancialControlService.ts:1-177` |

**Answers:**
- **Unused subscription credits on expiry today:** nothing — they remain usable (expiry is time-based, not subscription-linked).
- **Top-up credits on expiry today:** nothing — `paid` never expires and is never locked.
- **Lock/unlock concept present?** **NO** (subscription-linked). Manual freeze/lock exist but are operator-triggered, not tied to subscription state.

---

## STEP 6 — Usage projection (for the email-alert condition)
**YES_EXISTING_MECHANISM.** The credit-advisor suite already computes "remaining unlikely to
complete near-term work":
- `backend/services/creditAdvisor/creditForecastService.ts` — `computeForecast`, `runwayDays`, `days_remaining`, `projected_exhaustion_date`, `riskForDays` (<7 Critical).
- `consumptionMetricsService.ts` — daily/7d/30d burn rate + trend.
- `preExecutionImpactService.ts` — per-action cost vs remaining (`runway_impact_days`, `pct_of_remaining`).
- `upgradeAdvisorService.ts` / `executiveIntelligenceService.ts` — `exhaustion_within_30d`.
- `billing/admissionControl.ts` — `canStartActivity` → `shortfall`.
- `activityEconomyCatalog.ts` — upcoming-work cost ranges.

⇒ The "remaining credits insufficient for projected near-term usage" half of the email rule is
**already computable**; only the trigger wiring (≥85% AND projection-insufficient → email) is missing.

---

## Where the policy SHOULD be enforced (chokepoints)
| Policy | Enforcement point (existing chokepoint) |
|---|---|
| Consumption order (sub → top-up) | **Already** `creditPriorityService.computeSplit` — no change |
| Top-up LOCKED without active subscription | `creditPriorityService.computeAvailable`/`getTotalAvailable` — gate the `paid` bucket by active-subscription status; this single chokepoint covers **all** deduction paths + `admissionControl` + UI reads |
| Subscription credits expire on period end | Subscription **expiry/renewal job** (does not exist yet) + `creditExpiryService` extended to a subscription-period trigger for the `free`/subscription category |
| Top-up auto-AVAILABLE on renewal | Subscription **renewal** processing (currently scaffolding) → clear the lock |
| 80/90/95 session warnings | client session-start (`CompanyContext`/`AppLayout`) + `creditAlertService` thresholds — see [CREDIT_NOTIFICATION_AUDIT.md](CREDIT_NOTIFICATION_AUDIT.md) |
| 85% + projection email | `creditAlertService` + new `credit_alert` email type, using `creditForecastService` for the projection condition |

Full gap table: [CREDIT_POLICY_GAP_ANALYSIS.md](CREDIT_POLICY_GAP_ANALYSIS.md).

Audit only — no code, migrations, writes, or sends.
