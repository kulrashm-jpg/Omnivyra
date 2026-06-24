# CREDIT_POLICY_CONFLICT_AUDIT.md

Conflicts between current behavior and the approved FREE/PAID/INCENTIVE model, with resolution status.

| Area | Current behavior | Required | Risk | Affected files | Status |
|---|---|---|---|---|---|
| initial_free_credit / signup | 300 credits but **14-day** expiry (config); service default 50/14 | 300 / **30-day** | wrong validity | `initialFreeCreditService.ts`, `free_credit_config` | **FIXED** (config 30d; defaults 300/30) |
| free-credit validity | 14d | 30d (signup); cycle (subscription) | premature expiry | `free_credit_config`, `creditExpiryService` | FIXED for signup; subscription via expiry service |
| subscription allocation | category `free`, gated by entitlement (prior series) | FREE, valid while entitled | none | `subscriptionAllocationService.ts` | OK |
| subscription expiry | expired the **whole `free` pool** → would wrongly expire signup | expire subscription portion only | **signup loss** | `subscriptionCreditExpiryService.ts` | **FIXED** (cap at subscription-allocated) |
| admin grant | category `free` (consumed 1st, ~14d expiry) | **PAID** (never expire, after FREE, locked) | mis-bucketed | `creditAdminGrantService.ts` | **FIXED** (→ paid) |
| promo / earn / referral | category `incentive` (consumed 2nd, may expire) | **PAID** | mis-bucketed; future incentive prohibited | `earnCreditsService.ts` | **FIXED** (→ paid) |
| incentive allocation | earn used `incentive` | legacy only; no new allocations | new incentive growth | `earnCreditsService.ts` | **FIXED** (no service grants incentive now) |
| top-up | category `paid`, never expire, locked (prior series) | PAID | none | `purchaseService.ts` | OK |
| paid lock | gates `paid` when not entitled | ACTIVE/TRIALING/GRACE/PAST_DUE usable; EXPIRED/CANCELED locked | none | `creditPriorityService.ts`, `subscriptionStateResolver.ts` | OK (now covers promo/admin too, since they're paid) |
| notifications | only 20%/10% remaining alerts | 80/90/95 consumed + 85%+forecast email | missing | `creditAlertService.ts`, new `creditConsumptionWarningService.ts`, `emailService` | **LOGIC IMPLEMENTED** (wiring/deploy pending) |
| billing/wallet UI | "never expire" only | FREE "expires…"; PAID "never expires, requires active subscription" | copy gap | `BillingCenter.tsx`, `TopUpPanel.tsx` | **FIXED** (copy) |
| onboarding/pricing copy | n/a verified | no internal bucket names | minor | onboarding/pricing pages | not changed (no TRIAL/PERSISTENT names exist to remove) |

Consumption order (FREE→INCENTIVE→PAID) **already matches** — no change.
