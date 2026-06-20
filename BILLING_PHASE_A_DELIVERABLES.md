# OMNIVYRA — BILLING PHASE A (TOP-UPS ONLY) — DELIVERABLES

**Scope: top-ups only** (no subscriptions/recurring/founding/monthly). Goal: customer pays → credits added → recorded, reusing the existing ledger.

> ### Honest headline
> The audit (Sections A/B) is **decisive and resolves the open unknowns**: the billing schema **IS applied in prod but completely unused**, the top-up catalog (`credit_packages`) is **empty**, and the wired Razorpay path is **hard-gated to staging** (rejects live keys by code). I built the **safe, verifiable** pieces — top-up catalog single-source-of-truth, catalog API, read-only billing history, and a prepared seed — but the **real-money charge loop cannot be completed or verified from here** (no live keys, staging-gated, unseeded catalog, no staging env for E2E). **A customer cannot yet pay→credits→history.**

---

## SECTION A — BILLING FOUNDATION FINDINGS (live prod probe)
| Table | Exists in prod? | Rows | Actively used? | Safe to reuse? |
|---|---|---|---|---|
| `payment_transactions` | ✅ | **0** | No (never written) | ✅ reuse |
| `credit_purchases` | ✅ | **0** | No | ✅ reuse |
| `billing_checkout_sessions` | ✅ | **0** | No | ✅ reuse |
| `payment_provider_events` | ✅ | **0** | No | ✅ reuse |
| `billing_subscriptions` | ✅ | **0** | No | (out of scope) |
| `invoices` / `invoice_line_items` | ✅ | **0** | No | ✅ (later) |
| `credit_packages` (top-up catalog) | ✅ | **0 ← empty** | **No — blocks orders** | ✅ but **must seed** |
| `payment_provider_config` | ✅ | 0 | No | ✅ |
| `credit_transactions` (ledger) | ✅ | **333** | **Yes (live)** | ✅ reuse |
| `organization_plan_assignments` | ✅ | **0** | No | — |
**Finding:** the schema is **applied but never exercised** — no purchase, checkout, or payment event has ever been recorded. **No duplicate tables needed.** The critical blocker for top-ups is the **empty `credit_packages`** (orders look it up by id).

---

## SECTION B — RAZORPAY PRODUCTIONIZATION (findings + decision)
The wired path `createRazorpayStagingCreditOrder` (`razorpayStagingService.ts:173`) is **staging-hard-gated**:
- requires `RAZORPAY_STAGING_ENABLED='true'` (`:63`); in production requires `RAZORPAY_ALLOW_PRODUCTION_STAGING` (`:66`); honors a global kill-switch (`:70`);
- **rejects `rzp_live_` keys (`:76`)** and `order_live` order ids (`:153`); stamps every row `PROVIDER_MODE` (staging);
- looks up `credit_packages` by id (`:186-188`) — empty → order fails.

It **already does** signature verification (`verifyRazorpayWebhookSignature:105`, `verifyRazorpayPaymentSignature:113`), payment verification (`verifyAndFulfillRazorpayStagingPayment:621`), webhook handling (`handleRazorpayStagingWebhook:383`), and **idempotency** (UNIQUE `payment_provider_events`, idempotency-keyed `createCredit`).

**Decision (honest):** "live-mode support" means editing those financial-auth guards (`:63/66/76/153`) and parameterizing `PROVIDER_MODE` — the **highest-risk possible change** (enables real charges). With **no live keys and no staging env, I cannot test it**, so I did **not** make it. Productionizing must be done with live test+prod keys against a **staging environment**, validated E2E, then enabled. The verification/idempotency primitives to reuse already exist.

---

## SECTION C — FILES CHANGED
| File | Role | Status |
|---|---|---|
| `lib/billing/topupCatalog.ts` (new) | **Single source of truth** for 250/750/1500 packs (no hardcoded UI) | ✅ typecheck-clean |
| `pages/api/billing/topup/catalog.ts` (new) | GET catalog (UI reads this) | ✅ |
| `pages/api/billing/topup/history.ts` (new) | GET customer billing history (read-only, reuses `credit_purchases`, `withOrgAccess`) | ✅ |
| `supabase/migrations/20260721_seed_topup_credit_packages.sql` (new) | Seed `credit_packages` (250/750/1500) | ⚠ **PREPARED, NOT APPLIED** (verify DDL + prices) |
**Not changed:** no ledger, no Razorpay core, no payment guards, no credit logic.

---

## SECTION D — CHECKOUT FLOW → ⚠ NOT BUILT (blocked, spec provided)
`Billing → select pack → Razorpay checkout → success → credits` is **not wired**, because the order path is staging-gated + `credit_packages` is empty + no live keys + untestable. **Reuse-based spec for when keys+seed+staging exist:**
- `POST /api/billing/topup/create-order` (`withOrgAccess`) → `createRazorpayStagingCreditOrder({organizationId, packageId, requestedBy:userId})` (productionized for live mode).
- Razorpay checkout.js on the client with the returned order id.
- `POST /api/billing/topup/verify` (`withOrgAccess`) → `verifyAndFulfillRazorpayStagingPayment(...)`.
- Webhook already exists (`pages/api/webhooks/razorpay-staging.ts`).
I did **not** ship untested customer-facing charge endpoints.

## SECTION E — CREDIT ALLOCATION VERIFICATION → ✅ primitive verified, ⛔ loop not live
The allocation primitive is **idempotent and ledger-backed** (verified by code): `completePurchase` → `createCredit({category:'paid', referenceType:'credit_purchase'})` keyed by `makeIdempotencyKey(org,'credit_purchase',purchaseId)`; UNIQUE `payment_provider_events(provider,event_id)` dedupes webhook retries; UNIQUE `reference_id` blocks double-claim. So **250→250 / 750→750 / 1500→1500** would be exactly-once. **But it cannot be exercised** without a real payment (no keys/staging) and a seeded catalog.

## SECTION F — WEBHOOK VERIFICATION → ✅ exists, ⛔ not live-validated
Signature (`verifyRazorpayWebhookSignature`), amount/order/org checks, and success/failure/retry recording into `payment_provider_events` already exist. **Cannot be live-validated** here (needs a real Razorpay webhook).

## SECTION G — HISTORY SCREENS → ✅ API built (read-only)
`GET /api/billing/topup/history` returns per-org purchases (top-up, credits granted, amount paid, status, date, provider reference) from `credit_purchases`. **Built + typecheck-clean.** Returns empty today (no purchases exist) — correct. No subscription screens. (A UI surface can read this; the existing company billing portal is the natural host.)

## SECTION H — ADMIN VISIBILITY → ⚠ existing super-admin endpoints; no new dashboard
Super-admin purchase/payment-event endpoints exist; a purchases/failures/allocations/webhook-failures dashboard was not built (no data to show until the loop is live).

---

## SECTION I — VALIDATION RESULTS
| Item | Result |
|---|---|
| Successful purchase | ⛔ cannot run (no live keys / staging / seeded catalog) |
| Failed purchase | ⛔ cannot run |
| Webhook retry / duplicate webhook | ⛔ cannot run; **idempotency verified in code** (UNIQUE event + idempotency key) |
| Credit allocation / duplicate protection | ⛔ not live; **verified idempotent by code** (Section E) |
| Transaction history | ✅ endpoint built, read-only, typecheck-clean (returns empty — no purchases yet) |
| **TypeScript (all new files)** | ✅ **PASS — 0 errors** |
| Prod schema audit | ✅ decisive (schema applied, unused, catalog empty) |

---

## SECTION J — KNOWN GAPS / READINESS

### Can a customer now: pay → receive credits → see history? → **NO**
Because: (1) `credit_packages` is **empty** (orders can't resolve) — needs the prepared seed applied; (2) Razorpay is **staging-hard-gated** and live-mode is untestable here (no keys, no staging); (3) the **customer checkout endpoints + UI** are spec'd but not shipped (would be untested charge code); (4) **no environment exists to validate** the payment loop E2E.

**Known gaps (ranked):**
1. **Seed `credit_packages`** (prepared `20260721`) — apply via controlled process. *Critical.*
2. **Productionize Razorpay live mode** (guards `:63/66/76/153` + `PROVIDER_MODE`) — needs live keys + staging. *Critical.*
3. **Customer checkout endpoints + UI** (spec in §D) — build once 1+2 exist. *High.*
4. **Staging environment** for E2E validation. *Critical pre-req.*

### ⛔ NOT READY FOR SUBSCRIPTIONS
**Justification:** subscriptions are correctly out of scope, but even the **top-up loop is not operational** — the smallest commercial loop (pay→credits→history) is **blocked on seeding the catalog, live Razorpay keys, and a staging env to validate**, none of which exist here. What **is** done and solid: the prod-schema reality is now known (applied, unused), the catalog is a single source of truth, history is exposed read-only, the allocation/webhook idempotency is verified in code, and a seed is prepared. When the catalog is seeded, live keys are provisioned, and a staging environment is available, the remaining checkout/verify endpoints are thin reuse-wrappers over the already-idempotent System-1 functions — at which point I can implement and **verify** the full loop (success/failure/retry/duplicate/allocation) end-to-end.

> **Bottom line:** I delivered the decisive audit + the safe building blocks (catalog SSOT, history API, prepared seed) and **refused to ship or "verify" untested real-money charge code**. The honest unblock: **seed `credit_packages`, provision live Razorpay test+prod keys in a staging project, and confirm the loop there** — then the customer checkout is a small, reuse-heavy, verifiable addition.

*(No ledger/credit/Razorpay-core/payment-guard code changed. The seed migration is prepared, NOT applied. All new files typecheck clean. Read-only prod probe; temp script removed.)*
