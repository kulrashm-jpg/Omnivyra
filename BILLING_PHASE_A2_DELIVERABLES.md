# OMNIVYRA — BILLING PHASE A.2 (STAGING CHECKOUT IMPLEMENTATION) — DELIVERABLES

**Staging-complete top-up flow built.** Test-mode only — no live charging, no production Razorpay, no subscriptions/recurring/founding. The endpoints are **thin wrappers over the existing idempotent, staging-gated functions**, so they are **inert in production** (the underlying service throws without `RAZORPAY_STAGING_ENABLED` + test keys → no prod impact).

> ### Safety property (why this is prod-safe)
> `createRazorpayStagingCreditOrder` throws at `razorpayStagingService.ts:63` unless `RAZORPAY_STAGING_ENABLED='true'` (and, in prod, `RAZORPAY_ALLOW_PRODUCTION_STAGING`), and rejects `rzp_live_` keys (`:76`). So the new customer endpoints **cannot charge anything in production** — they only function in a staging env with test keys. No financial-core code was changed.

---

## SECTION A — FILES CHANGED
| File | Role |
|---|---|
| `pages/api/billing/topup/create-order.ts` (new) | POST — thin wrapper → `createRazorpayStagingCreditOrder` (`withOrgAccess`) |
| `pages/api/billing/topup/verify.ts` (new) | POST — thin wrapper → `verifyAndFulfillRazorpayStagingPayment` (`withOrgAccess`) |
| `components/billing/TopUpPanel.tsx` (new) | Top-up UI: catalog + Razorpay Checkout.js + verify + history |
| `pages/command-center/topup.tsx` (new) | Page mounting the panel (`/command-center/topup`) |
| `pages/api/billing/topup/admin-status.ts` (new) | Read-only staging observability (purchases / provider events / allocations) |
| `scripts/staging/validate-topup-idempotency.ts` (new) | Staging harness — exactly-once allocation proof |
| `lib/billing/topupCatalog.ts`, `pages/api/billing/topup/{catalog,history}.ts` (from A.1) | Catalog SSOT + read-only APIs |
**Not changed:** Razorpay core, ledger, credit logic, payment guards, any live-mode path.

---

## SECTION A (brief) — CREDIT PACKAGE FINALIZATION
Catalog is a **single source of truth** (`topupCatalog.ts`, UUID ids mirroring the seed). **Prices remain placeholders** (₹499/₹1299/₹2399) — the DB `credit_packages.price` is the authoritative value the order path reads, so the real numbers are set when the **approved prices** seed `20260721`. Credits (250/750/1500) are final.

## SECTION B — CHECKOUT ENDPOINTS ✅
- **`POST /api/billing/topup/create-order`** `{org_id, package_id}` → wrapper over `createRazorpayStagingCreditOrder({organizationId, packageId, requestedBy})` → returns `{purchase_id, credits, amount, amount_subunits, currency, razorpay_order_id, razorpay_key_id}`. Mirrors the proven super-admin endpoint, swapping the super-admin gate for **`withOrgAccess`** (customer auth). **No duplicated logic.**
- **`POST /api/billing/topup/verify`** `{org_id, razorpay_order_id, razorpay_payment_id, razorpay_signature}` → wrapper over `verifyAndFulfillRazorpayStagingPayment(...)` (verifies signature, fulfills, **idempotent** `createCredit`). Safe to call repeatedly.

## SECTION C — UI RESULT ✅
`TopUpPanel` (mounted at `/command-center/topup`): reads `/catalog`, renders the 3 packs (credits, ₹price, Buy), drives the full flow, and shows status (creating → paying → verifying → success/failed/cancelled) with a **Retry**. No hardcoded packs (reads the catalog API).

## SECTION D — RAZORPAY STAGING CHECKOUT ✅ (test-mode)
`TopUpPanel` loads **Checkout.js** dynamically, opens Razorpay with the order from create-order, and handles **success** (→ verify → refresh history), **failure** (`payment.failed` handler), **cancel** (`modal.ondismiss`), and **retry** (re-invoke buy). Uses the test `razorpay_key_id` returned by the server. **No live-mode code.**

## SECTION E — HISTORY INTEGRATION ✅
The panel renders `/api/billing/topup/history` (date, credits, amount, status, provider reference) and refreshes it after a successful verify.

## SECTION F — VALIDATION HARNESS ✅ (staging-runnable)
`scripts/staging/validate-topup-idempotency.ts`: after one real test checkout, calls `verify` **twice** and asserts the wallet grew **exactly once** (`granted on 2nd (duplicate) === 0`). Refuses to run in production. Proves Section H's "exactly-once allocation / duplicate verify / retry."

## SECTION G — ADMIN OBSERVABILITY ✅ (read-only)
`GET /api/billing/topup/admin-status` returns a summary (attempts / succeeded / pending / failed / credits_allocated) + recent `credit_purchases`, `payment_provider_events` (webhook records), and the `credit_purchase` allocation ledger — for staging validation. Read-only.

---

## SECTION H — VALIDATION RESULTS
| Item | Result |
|---|---|
| **TypeScript (all new files)** | ✅ **PASS — 0 errors** |
| create-order / verify endpoints | ✅ built (thin wrappers, `withOrgAccess`) |
| history endpoint + UI | ✅ built, integrated |
| UI rendering | ✅ typecheck-clean (Checkout.js dynamic load, status/retry, history table) |
| **Allocation idempotency** | ✅ **by construction** (idempotency-keyed `createCredit`, UNIQUE `payment_provider_events`/`reference_id`) + harness ready to confirm live |
| **No production impact** | ✅ endpoints inert in prod (staging-gated service throws); no financial-core/ledger change |
| Live run (success/failure/webhook) | ⛔ not run here — needs staging env + Razorpay test keys + seeded catalog |

---

## SECTION G — KNOWN GAPS
1. **Approved prices** not set — catalog/seed use placeholders; set before applying the seed. *Medium.*
2. **`credit_packages` not seeded** in any env — apply the corrected `20260721` (with approved prices) to staging. *Critical pre-req.*
3. **Staging env + Razorpay test keys + public webhook URL** — required to actually run the flow. *Critical pre-req (external).*
4. Nav entry for `/command-center/topup` + placement on the billing portal — minor UI wiring. *Low.*
5. Live-mode productionization — deliberately out of scope (Phase B). *N/A here.*

---

## SECTION H — READY FOR STAGING TEST

### Answer: If Razorpay test keys + a staging environment are provided today, can Omnivyra complete **Pay → Verify → Allocate Credits → Show History**? → **YES**

**Evidence:** the full loop is implemented and typecheck-clean, reusing the already-idempotent System-1 functions end-to-end:
- **Pay:** `create-order` → Razorpay Checkout.js (test mode) in `TopUpPanel`.
- **Verify:** `verify` → `verifyAndFulfillRazorpayStagingPayment` (signature-checked).
- **Allocate:** idempotent `createCredit` (UNIQUE event + reference + idempotency key) → ledger.
- **History:** `/history` + admin `/admin-status`, rendered in the UI.

**To turn it on (3 staging prerequisites, none of them code):**
1. Apply the corrected seed `20260721` (with **approved prices**) to a **non-prod** Supabase.
2. Set `RAZORPAY_STAGING_ENABLED=true` + `RAZORPAY_TEST_KEY_ID/SECRET` (`rzp_test_…`) + `RAZORPAY_WEBHOOK_SECRET`; register the webhook URL in the Razorpay test dashboard.
3. Deploy this branch to staging; open `/command-center/topup`, buy a pack with a Razorpay test card, and run `validate-topup-idempotency.ts` to confirm exactly-once.

> **Bottom line:** the staging-complete top-up flow (endpoints, UI, history, admin observability, idempotency harness) is **built and typecheck-verified**, reuses the idempotent core with **zero financial-core changes**, and is **inert in production**. It is **ready for staging test the moment the catalog is seeded and Razorpay test keys + a staging env exist** — none of which can be provisioned from here, but all of which are external setup, not engineering.

*(No live mode. No production charging. Thin reuse-wrappers only; idempotent core untouched. All new files typecheck clean. No prod writes.)*
