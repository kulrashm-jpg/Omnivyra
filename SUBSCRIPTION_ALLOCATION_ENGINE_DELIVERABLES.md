# OMNIVYRA — SUBSCRIPTION CREDIT ALLOCATION ENGINE — DELIVERABLES

Monthly credit allocation engine for Starter / Growth / Business. Grants into the **plan/monthly pool (`free`)** — never the top-up pool — **idempotently**. No gateway, no checkout, no subscription purchase flow. **TypeScript: 0 errors. Dry-run validation: PASS (zero prod writes).**

> **Safety:** the engine grants real credits, so it is **dry-run-validated only** and **not auto-wired to a live cron**. Real granting requires an explicit `dry_run:false` call through the capability-gated trigger — a deliberate go-live decision, not an automatic one.

## FILES CHANGED
| File | Role |
|---|---|
| `backend/services/subscriptionAllocationService.ts` (new) | The engine: plan rules, period math, idempotent grant, dry-run, sweep, status |
| `backend/services/billingCenterService.ts` | + `allocation` (status) in the payload |
| `components/billing/BillingCenter.tsx` | Current Plan card now shows This-cycle / Last / Next allocation (Section E) |
| `pages/api/admin/billing/allocate.ts` (new) | Capability-gated trigger; **dry-run by default** |

## ALLOCATION ENGINE (Sections A–C)
- **Plan rules (A):** `PLAN_MONTHLY_CREDITS = { starter: 300, growth: 700, business: 1400 }`. Unknown/Free → no allocation.
- **Pool (A/C):** grants to `category: 'free'` — the monthly pool, **consumed first**. **Never `paid`** (top-up, never-expiring). Top-ups are untouched by allocation.
- **Process (B):** `allocateMonthlyCreditsForOrg` → resolve plan → compute current billing period → grant idempotently. `runMonthlyAllocationSweep` drives it across all plan-assigned orgs. Both support `dryRun`.
- **Idempotency (B):** deterministic key `monthly_alloc:<org>:<plan>:<periodStart>`. Same cycle ⇒ same key ⇒ the **UNIQUE `credit_transactions.idempotency_key`** + `createCredit`'s no-op-on-conflict guarantee **no duplicate grants**. Re-running the sweep daily is safe.

## LEDGER INTEGRATION (Section D)
Each allocation is a `credit_transactions` grant row via the existing `createCredit` (phase `grant`, `category: 'free'`, `reference_type: 'subscription_allocation'`, `performed_by: SYSTEM_USER_ID`, the deterministic `idempotency_key`). That single immutable row **is** the billing-history record — allocation date (`created_at`), plan + cycle (encoded in the key), credits granted (`credits_delta`), reference id. `getAllocationStatus` reads them back.

## BILLING CENTER INTEGRATION (Section E)
`getBillingCenter` now returns `allocation`, surfaced in the Current Plan card:
- **Current Plan** — `pricing_plans.plan_key`.
- **Credits Granted This Cycle** — sum of allocation deltas whose key matches the current period.
- **Last Allocation Date** — newest allocation row.
- **Next Allocation Date** — period start + 1 month.

## VALIDATION EVIDENCE (dry-run — no writes)
```
SECTION A/B — allocation per plan (pool = free):
  starter   credits=300  period=2026-06-01  next=2026-07-01  key=…:starter:2026-06-01
  growth    credits=700  period=2026-06-01  next=2026-07-01  key=…:growth:2026-06-01
  business  credits=1400 period=2026-06-01  next=2026-07-01  key=…:business:2026-06-01
Duplicate prevention:
  repeat keys identical:  true     ← same cycle ⇒ DB UNIQUE blocks the 2nd grant
  next-month key differs: true     (…:growth:2026-07-01)
Non-billable skip:
  free → not_billable(0) · enterprise → not_billable(0) · null → no_plan(0)
rule table: { starter:300, growth:700, business:1400 }
```
- **Starter / Growth / Business allocation:** ✅ correct amounts, into `free`.
- **Duplicate prevention:** ✅ deterministic key (proven identical on repeat; differs next cycle) + DB UNIQUE + `createCredit` conflict no-op.
- **Billing center updates:** ✅ `getBillingCenter` carries `allocation`; UI renders This-cycle / Last / Next.
- **TypeScript:** ✅ 0 errors.

## KNOWN GAPS
1. **Trigger not auto-enabled** — no live cron by design (financial safety). Go-live = enable a daily `runMonthlyAllocationSweep` cron or call the guarded endpoint with `dry_run:false`. *Decision, not code.*
2. **Renewal anchor = calendar month** — period anchors to day-1 (configurable via `anchorDay`); true per-subscription renewal-day cycles need a subscription-period source (part of the unbuilt subscription system). *Medium.*
3. **"May reset" rollover** — allocation is additive; expiring/resetting prior-cycle monthly credits is a deferred policy hook (`creditExpiryService` already expires `free`). *Low/policy.*
4. **plan_key coverage** — only starter/growth/business are billable; other keys skip (intended). *N/A.*
5. **Not executed in prod** — validated dry-run only; no real credits granted (read-only discipline). *Intended.*

## READY FOR CHECKOUT?
**The allocation engine is READY** — built, idempotent, ledger-integrated, billing-center-surfaced, and dry-run-validated for all three plans. It does **not** block checkout; it's ready to grant the moment a renewal fires.

**Overall checkout = NOT READY YET** — the two out-of-scope prerequisites remain: (1) the **subscription purchase flow** (create subscription → set renewal) and (2) **Razorpay productionization + a staging env** (Phases A.1/A.2). Once a subscription exists and its renewal is reached, enabling the trigger (`dry_run:false`) completes the loop with **no further engine work**.

*(Allocation engine only. No gateway / checkout / subscription purchase. Grants to `free` pool, idempotent. Dry-run validated; zero prod writes. Typecheck clean.)*
