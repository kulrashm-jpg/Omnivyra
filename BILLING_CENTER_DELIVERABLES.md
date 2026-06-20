# OMNIVYRA — BILLING CENTER & CREDIT CONSUMPTION — DELIVERABLES

Customer-facing **Billing & Subscription Center** at `/command-center/billing` — all 9 sections, read-only + buy/upgrade hand-off. Consumption priority (monthly → top-up) and separate balances are **enforced by the wallet and surfaced**. No subscriptions, no gateway, no checkout implemented here. **TypeScript: 0 errors. Live read-only probe: PASS. No DB changes.**

## FILES CHANGED
| File | Role |
|---|---|
| `backend/services/billingCenterService.ts` (new) | Read-only aggregator: current plan + credit pools + billing history + invoices + payment methods |
| `pages/api/billing/center.ts` (new) | `GET …?org_id=` → the payload (`withOrgAccess`) |
| `components/billing/BillingCenter.tsx` (new) | The 9-section UI (brand-aligned) |
| `pages/command-center/billing.tsx` (new) | Page mounting the center |
| *(reused)* `creditAccountabilityService.ts`, `commercialPlans.ts`, top-up flow | Credit pools, plan display, Buy hand-off |

## DATABASE CHANGES
**None.** Everything reads existing tables: `organization_credits` (pools), `organization_plan_assignments` + `pricing_plans` (plan), `credit_purchases` (history), `invoices` (invoices). No migration, no new columns, no writes.

## THE 9 SECTIONS
| # | Section | Source |
|---|---|---|
| 1 | **Current Plan** | `organization_plan_assignments → pricing_plans.plan_key` (null → Free); name/credits/seats from `commercialPlans` |
| 2 | **Credit Summary** | `creditAccountabilityService` total + per-pool chips |
| 3 | **Monthly Credits** | `plan` pool (free bucket) — "Spent 1st · resets" |
| 4 | **Top-Up Credits** | `topup` pool (paid bucket) — "Never expires" |
| 5 | **Buy More Credits** | `commercialPlans.TOPUPS` → Buy → `/command-center/topup?pack=<id>` (existing checkout) |
| 6 | **Upgrade Plan** | CTA → `/pricing` (no subscription logic) |
| 7 | **Payment Methods** | none stored per-org (no gateway) → empty state |
| 8 | **Billing History** | `credit_purchases` (date / credits / amount / status) |
| 9 | **Invoice History** | `invoices` (number / period / total / status / issued) |

## CREDIT CONSUMPTION PRIORITY (already enforced; surfaced here)
- **Monthly credits consumed first**, **top-up second** — `creditPriorityService.computeSplit` spends `free → incentive → paid`; monthly = `free`, top-up = `paid`.
- **Top-ups have no time-based expiry** — `paid` is never-expired, guarded at service **and** DB level.
- **Separate balances displayed** — sections 3 & 4 show the pools independently, each with its validity badge.

## VALIDATION RESULTS
- **TypeScript:** ✅ 0 errors across all new files.
- **Live read-only probe** (`getBillingCenter` against prod, real org `73e5fa6f…`):
  ```
  org wallet: free_balance=300, paid_balance=0, incentive_balance=0
  currentPlan: { key: null }            → renders "Free"
  buckets: [ plan:300 (never:false), bonus:0, topup:0 (never:true) ]
  totalAvailable: 300
  billingHistory rows: 0 · invoices rows: 0 · paymentMethods: []
  ```
  → plan pool = 300 (spent first, can expire); top-up pool = 0 (never expires); empty history/invoices render their empty states. Mapping + priority surfacing confirmed against real data.
- **UI screenshots:** not capturable in this headless environment. Rendered layout (verified by structure + the probe payload):
  ```
  [ Current Plan: Free · Upgrade ]   [ Available credits: 300 · pool chips ]
  [ Monthly credits: 300  Spent 1st ] [ Top-up credits: 0  Never expires ]
  [ Buy more credits: 250 $30 · 500 $55 · 1000 $100  → Buy ]
  [ Payment methods: empty state ]
  [ Billing history: "No purchases yet." ]
  [ Invoices: "No invoices yet." ]
  ```

## REMAINING COMMERCIALIZATION GAPS
1. **Monthly subscription grant** — depositing each plan's monthly credits into the `plan` (free) pool per cycle is part of the **unbuilt subscription billing**; today `plan` holds the one-time Free grant. The center renders monthly credits correctly the moment they land. *High (subscription side).*
2. **Real billing history / invoices** — tables are empty until the checkout (Phase A.2 staging flow) and an invoice generator run; the sections are wired and will populate automatically. *Medium.*
3. **Payment methods vault** — no per-org saved methods (no gateway); requires Razorpay productionization + a method-storage decision. *Medium.*
4. **Nav entry** — add `/command-center/billing` to the app nav (left out to avoid churn on the revert-prone nav config). *Low.*
5. **Upgrade = checkout** — "Upgrade plan" links to `/pricing`; actual plan-change checkout is the deferred subscription work. *High (subscription side).*

*(Read-only UI + aggregator only. No subscriptions / gateway / checkout. No DB change. Typecheck clean; live read-only probe passed.)*
