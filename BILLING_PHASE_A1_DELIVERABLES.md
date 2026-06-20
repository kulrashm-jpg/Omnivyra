# OMNIVYRA — BILLING PHASE A.1 (COMMERCIAL FOUNDATION ACTIVATION) — DELIVERABLES

**Activation + validation + planning only.** No checkout, no payments, no subscriptions, no financial-core changes. The seed was **validated, found schema-incompatible, corrected** — and **not applied** (placeholder prices fail the "if correct" gate + controlled-process required).

---

## SECTION A — MIGRATION RESULT (validation caught a real defect)
**Schema validation of the prepared seed → FAILED, then corrected.** The actual DDL (`20260322_monetization_foundation.sql`) is:
```
credit_packages ( id UUID PK DEFAULT gen_random_uuid(), name TEXT NOT NULL,
                  credits INT CHECK>0, price NUMERIC(10,2) CHECK>=0,
                  is_active BOOL DEFAULT true, created_at TIMESTAMPTZ )
```
The order path reads `select('id, credits, price, is_active')` and derives the charge from **`price`** (currency hardcoded INR) — `razorpayStagingService.ts:187-196`.

| Check | Original seed | Result |
|---|---|---|
| **Schema compatibility** | used `amount`/`currency`/`amount_subunits` (don't exist), text id (real id is UUID), omitted required `name` | ❌ **would fail** → **corrected** to `(id uuid, name, credits, price, is_active)` |
| **Idempotency** | `ON CONFLICT (id)` with text ids (id is auto-UUID → never conflicts → duplicates) | ❌ → **fixed**: deterministic fixed UUIDs + `ON CONFLICT (id) DO NOTHING` |
| **Credit values** | 250 / 750 / 1500 | ✅ correct |
| **Pricing values** | ₹499 / ₹1299 / ₹2399 — **placeholders** | ⚠ **not confirmed** → **fails the gate** |

**Decision: NOT APPLIED.** Per Section A's gate ("validate pricing values; *if correct*, apply"), the placeholder prices are not validated, so I did not apply. Also: applying requires the **controlled migration process** (bulk `db push` is forbidden per repo policy; `.env.local` is prod). The corrected, schema-valid, idempotent seed (`20260721_seed_topup_credit_packages.sql`) is **ready to apply once the approved prices are set**.

---

## SECTION B — credit_packages EVIDENCE + BILLING TABLE HEALTH
Live read-only probe (prod):
| Table | Readable? | Rows | Constraints (from DDL) |
|---|---|---|---|
| `credit_packages` | ✅ | **0** (unseeded) | PK(id uuid); CHECK credits>0, price>=0; NOT NULL name |
| `payment_transactions` | ✅ | 0 | immutable (mig `20260664:125`) |
| `credit_purchases` | ✅ | 0 | **UNIQUE reference_id** (double-claim guard, mig `20260322`); FK org |
| `billing_checkout_sessions` | ✅ | 0 | mig `20260718:59` |
| `payment_provider_events` | ✅ | 0 | **UNIQUE (provider, event_id)** (webhook dedupe, mig `20260625:39`) |
| `credit_transactions` (ledger) | ✅ | 333 | immutable trigger; idempotency_key UNIQUE |
- **Readable:** ✅ confirmed live for all.
- **Writable:** the order/webhook path writes via **service-role** (`ownedDbTable(...).insert`) — structurally writable; I did **not** test-write to prod billing tables (read-only discipline). The idempotency-bearing UNIQUE constraints (`reference_id`, `(provider,event_id)`) are present in the DDL → **healthy for exactly-once allocation**.
- **Indexes/constraints:** present per DDL above; not re-introspected live (information_schema not exposed to service_role).

---

## SECTION C — RAZORPAY PRODUCTIONIZATION SCOPE (plan only — NO changes made)
Exact code locations to change for live mode (financial-core — defer to staging-validated work):
| Item | Location | Change |
|---|---|---|
| Staging-enabled gate | `razorpayStagingService.ts:63` | gate on `RAZORPAY_LIVE_ENABLED` (new) alongside staging, env-driven mode |
| Prod-block gate | `:66` (`RAZORPAY_ALLOW_PRODUCTION_STAGING`) | allow live mode in prod under an explicit live flag |
| Global kill-switch | `:70` (`getMonetizationControlMode`) | keep (good) |
| **Live-key rejection** | `:76` (`rzp_live_` rejected) | conditionally allow `rzp_live_` when live mode is on |
| **Live order rejection** | `:153` (`order_live` rejected) | conditionally allow in live mode |
| **Provider mode** | `PROVIDER_MODE` constant (stamped on every row `:209,248,...`) | parameterize `'test' | 'live'` per request/env |
| Webhook | `pages/api/webhooks/razorpay-staging.ts` → `handleRazorpayStagingWebhook:383` | register the prod webhook URL in Razorpay dashboard; secret via `RAZORPAY_WEBHOOK_SECRET` |
Already production-grade (reuse, no change): signature verification (`:105/:113`), payment verification (`:621`), idempotency (UNIQUE event + idempotency-keyed `createCredit`). **No financial-core change made this phase.**

---

## SECTION D — STAGING CHECKLIST
| Item | Requirement |
|---|---|
| **Supabase** | A **non-prod** project with the billing schema applied + `credit_packages` seeded (the corrected `20260721`) |
| **Env vars** | `RAZORPAY_STAGING_ENABLED=true`; `RAZORPAY_TEST_KEY_ID` + `RAZORPAY_TEST_KEY_SECRET` (`rzp_test_…`); `RAZORPAY_WEBHOOK_SECRET`; `NODE_ENV != production` (or `RAZORPAY_ALLOW_PRODUCTION_STAGING=true`); monetization kill-switch OFF |
| **Razorpay test keys** | from Razorpay test dashboard; **no live keys** in staging |
| **Webhook endpoint** | expose `/api/webhooks/razorpay-staging` publicly; register URL + secret in the Razorpay test dashboard; events: `payment.captured`, `payment.failed` |
| **DB** | billing tables present (✅ already in prod schema) + catalog seeded; ledger reachable |
| **App** | deploy the branch (pricing page + topup catalog/history + the telemetry fix) to staging |

---

## SECTION E — CHECKOUT CONTRACTS (design only — reuse existing functions)
**`POST /api/billing/topup/create-order`** (`withOrgAccess`)
- Req: `{ org_id, package_id }` (`package_id` = `credit_packages.id` UUID)
- → reuse `createRazorpayStagingCreditOrder({ organizationId: org_id, packageId: package_id, requestedBy: userId })`
- Res: `{ purchase_id, provider_order_id, amount_subunits, currency, key_id }`

**`POST /api/billing/topup/verify`** (`withOrgAccess`)
- Req: `{ org_id, razorpay_order_id, razorpay_payment_id, razorpay_signature }`
- → reuse `verifyAndFulfillRazorpayStagingPayment({ ... })` (verifies signature, fulfills, **idempotent** `createCredit`)
- Res: `{ status: 'fulfilled'|'pending'|'failed', credits_granted, purchase_id }`

**`GET /api/billing/topup/history`** (`withOrgAccess`) — **already built** (`pages/api/billing/topup/history.ts`)
- Res: `{ purchases: [{ id, credits, amount_paid, currency, status, fulfillment_status, provider_order_id, created_at }], total_credits_purchased, count }`

Webhook (`/api/webhooks/razorpay-staging`) already implements the async fulfillment path. No implementation written this phase.

---

## SECTION F / G — VALIDATION RESULTS
| Item | Result |
|---|---|
| `credit_packages` seeded | ❌ **NOT seeded** (prices unconfirmed; controlled-process required) — corrected seed **ready** |
| Seed schema-compatible | ✅ now matches live DDL (id/name/credits/price/is_active) |
| Seed idempotent | ✅ fixed UUIDs + `ON CONFLICT (id)` |
| Billing tables healthy | ✅ exist, readable, idempotency UNIQUEs present |
| **Existing ledger unaffected** | ✅ no ledger/credit/Razorpay-core code changed; `credit_transactions` untouched (333 rows) |
| **TypeScript** | ✅ **PASS — 0 errors** (catalog/history/topupCatalog) |
| Files changed | `topupCatalog.ts` (UUID ids + `price`), `topup/catalog.ts` (field rename), `20260721` seed (corrected). No financial-core. |

---

## SECTION H — READINESS ASSESSMENT

### Can implementation of customer checkout begin safely? → **NO (from here) — exact blockers below**
The **design is ready** (contracts in §E reuse the already-idempotent System-1 functions), but **coding + verifying the charge path cannot begin safely in this environment**:

**Exact blockers:**
1. **`credit_packages` not seeded** with **approved prices** — orders can't resolve, and I won't seed placeholder prices into prod. → set approved prices, apply the corrected `20260721` via the controlled process. *Critical.*
2. **No staging environment + no Razorpay test keys** — checkout/verify can't be exercised; building untested charge endpoints is unsafe. *Critical.*
3. **Live-mode productionization is financial-core** (§C) — must be done + validated in staging, not blind. *Critical for live, not for test-mode staging.*

**Once those are met, the next implementation phase (safe) is:**
- In **staging** with seeded catalog + test keys: implement `create-order` + `verify` as thin reuse-wrappers (§E), wire Razorpay checkout.js + a top-up UI on the existing billing portal, and **validate E2E** (success / failure / webhook retry / duplicate / exactly-once allocation / history). Then productionize live mode (§C) and re-validate before enabling.

> **Bottom line:** the foundation is now **validated and de-risked** — the schema is confirmed, the seed defect was caught and corrected, the billing tables + idempotency guards are healthy, the ledger is untouched, and the Razorpay scope + staging checklist + checkout contracts are documented. The remaining work is **safe to start the moment a staging project with a seeded catalog and Razorpay test keys exists** — at which point the checkout is a small, reuse-heavy, *verifiable* build. **Customer checkout should not begin in this prod-only, no-keys, no-staging environment.**

*(No checkout/payment/subscription code. No financial-core change. Seed corrected + schema-validated but NOT applied. Ledger untouched. New/changed files typecheck clean. Read-only prod probe; temp scripts removed.)*
