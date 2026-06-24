# CREDIT_POLICY_GAP_ANALYSIS.md

Target policy vs current implementation. Audit only — no implementation. "Existing support" =
what already works; "Missing components" = what the policy additionally requires.

## Gap table

| Policy requirement | Existing support | Missing components | Impacted files |
|---|---|---|---|
| **Subscription credits — allocated via plan** | `subscriptionAllocationService.allocateMonthlyCreditsForOrg()` grants `category:'free'`, `reference_type:'subscription_allocation'` | none (works) | `subscriptionAllocationService.ts` |
| **Subscription credits — valid only during active period; expire when subscription ends** | Time-based free expiry exists (`creditExpiryService`, `credit_expiry_at`) | **No subscription-period-linked expiry.** Need: on subscription period-end, expire remaining subscription (`free`) credits | `subscriptionProjectionService.ts` (renewal/expiry job — not built), `creditExpiryService.ts`, `billing_subscriptions`, webhook handlers |
| **Subscription credits — consumed before top-up** | **Already enforced** — `computeSplit` free→incentive→paid | none | `creditPriorityService.ts` |
| **Top-up credits — never expire / stored indefinitely** | **Already true** — `paid` structurally excluded from expiry | none | `creditExpiryService.ts:28,152` |
| **Top-up credits — cannot be consumed without active subscription; LOCKED on expiry** | None (no subscription-state gating anywhere) | **Lock gate**: subtract/zero the `paid` bucket from *available* when no active subscription | `creditPriorityService.ts` (`computeAvailable`/`getTotalAvailable` — the single chokepoint), `creditExecutionService.resolveDeduction`, `billing/admissionControl.ts` |
| **Top-up credits — auto-AVAILABLE on renewal** | None | **Unlock on renewal**: clear the lock when subscription becomes active | `subscriptionProjectionService.ts`/renewal processing, `creditPriorityService.ts` |
| **Top-up credits — consumed after subscription credits** | **Already enforced** (paid last) | none | `creditPriorityService.ts` |
| **Consumption order — subscription first, top-up second, never reversed** | **Already enforced & deterministic** | none | `creditPriorityService.computeSplit` |
| **Session-start notifications — 80/90/95% consumption, once/session, no mid-op interruption** | Notification center + writer + dedup; once-per-session pattern (`DailyBrief`); session gates (`CompanyContext`); mount point (`AppLayout`) | **80/90/95 thresholds** (only 20/10 remaining-% exist); a **session-start banner**; consumption-% (not remaining-%) computation | `creditAlertService.ts`, `components/layout/AppLayout.tsx`, `components/CompanyContext.tsx`, `components/NotificationBell.tsx` |
| **Email alerts — only when ≥85% AND remaining insufficient for projected near-term usage** | **Projection exists** (`creditForecastService`, `admissionControl`, `preExecutionImpactService`); email infra exists | **`credit_alert` email type**; a **conditional trigger** (≥85% AND projection-insufficient); admin-recipient resolution; dedup type | `supabase/functions/send-transactional-email/index.ts`, `backend/services/emailService.ts`, `creditAlertService.ts`, `creditAdvisor/creditForecastService.ts` |
| **UI — top-up validity disclaimer / locked top-up / active-subscription requirement** | Balance/top-up/plan surfaces exist; TopUpPanel already says "never expire / used after plan credits" | **Subscription-validity messaging**: disclaimer, LOCKED badge, "active subscription required" | `components/billing/BillingCenter.tsx`, `components/billing/TopUpPanel.tsx`, `components/billing/BillingSummaryWidget.tsx`, `components/Header.tsx`/`layout/GlobalHeader.tsx` (CreditPill), `pages/company/billing/index.tsx`, `pages/company/credits/index.tsx` |

## Coverage by policy area
- **Subscription expiry:** partial — allocation + time-based expiry exist; **subscription-period-linked expiry missing**.
- **Top-up locking:** **missing** (no subscription-state gating).
- **Top-up unlocking:** **missing** (no renewal processing acts on credits).
- **Consumption ordering:** **complete** (already satisfied).
- **UI messaging:** **missing** (validity/lock/subscription-required messaging).
- **Session warnings:** **infra present, 80/90/95 + banner missing**.
- **Email alerts:** **projection present; email type + ≥85%-and-projection trigger missing**.

## Single highest-leverage enforcement point
`creditPriorityService.computeAvailable` / `getTotalAvailable` is the **one chokepoint** through
which every deduction, admission check, and balance read flows. Gating the `paid` (top-up)
bucket there by active-subscription status would enforce **top-up lock/unlock** platform-wide in
one place — without touching the (already-correct) consumption order. Subscription-credit expiry
and the renewal-driven unlock additionally require the **subscription expiry/renewal job that
does not yet exist** (today only read-only scaffolding in `subscriptionProjectionService.ts`).

## Net
- Already satisfied: **consumption order**, **top-up never-expire**, **usage projection** (for the
  email condition), **distinguishable source attribution**.
- Net-new required: **subscription-linked expiry**, **top-up lock/unlock + active-sub gating**,
  **80/90/95 session warnings**, **≥85%+projection email**, **UI validity messaging**.

Audit only — no implementation, migrations, billing writes, or notification sends.
