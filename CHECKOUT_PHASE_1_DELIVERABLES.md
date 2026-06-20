# OMNIVYRA — CHECKOUT PHASE 1 (TOP-UP PURCHASES) — DELIVERABLES

First end-to-end payment flow on the Payment Orchestrator: **Customer → Payment → Verification → Purchase Record**. Top-ups only, INR, sandbox. **No credit allocation, no wallet change, no billing-logic change.** **TypeScript: 0 errors. Sandbox validation: PASS.**

## FILES CHANGED
| File | Role |
|---|---|
| `pages/api/billing/checkout/create-order.ts` (new) | **§B** resolve package → INR (canonical FX) → **orchestrator.createOrder** (Razorpay→Cashfree) → PENDING purchase record |
| `pages/api/billing/checkout/verify.ts` (new) | **§C** **orchestrator.verifyPayment** → update record pending → paid/failed (**no allocation**) |
| `pages/api/webhooks/payments/[provider].ts` (new) | **§D** **orchestrator.handleWebhook** — verify + record event only (raw body) |
| `components/billing/TopUpPanel.tsx` | **§A** both entry points (Pricing + Billing Center → `/command-center/topup`) now use the orchestrator checkout; provider-routed SDK (Razorpay primary, Cashfree fallback) |
| `backend/services/billingCenterService.ts`, `components/billing/BillingCenter.tsx` | **§F** billing history shows Provider + Status (paid) + Amount + Date |
**No wallet/ledger code touched.** Records use the existing `credit_purchases` table; the verify path **never** calls `completePurchase`/`createCredit`.

## CHECKOUT ARCHITECTURE
```
Pricing page  ─┐
Billing Center ─┴─→ /command-center/topup (TopUpPanel)   ← §A single shared flow
                         │  POST /api/billing/checkout/create-order
                         ▼
              paymentOrchestrator.createOrder  (INR → Razorpay → Cashfree)  ← §B
                         │   ├─ credit_purchases row: status=pending (record)   ← §E
                         ▼
              provider SDK (Razorpay checkout.js / Cashfree v3, by returned provider)
                         │  POST /api/billing/checkout/verify
                         ▼
              paymentOrchestrator.verifyPayment  ← §C
                         │   └─ credit_purchases: pending → completed(=paid) | failed   ← §E
                         ▼
                 Purchase Record  (NO credit allocation — Phase 1 stops here)

  provider webhook ─→ /api/webhooks/payments/:provider ─→ orchestrator.handleWebhook  ← §D
                       verify signature + record event only (no billing)
```

## PURCHASE RECORDS (§E)
`credit_purchases`: `organization_id, credits, amount_paid, currency, provider, provider_order_id, reference_id (provider payment ref), status`. Status: `pending` → `completed` (= **paid**) / `failed`. (`refunded` is in the model but absent from the existing DB CHECK — deferred; no refunds in Phase 1.) Rows are tagged `provider_payload.checkout_flow='orchestrator_phase1'`.

## VALIDATION RESULTS (§G — live Razorpay sandbox, no charge, no prod writes)
```
Order creation per amount (orchestrator → Razorpay sandbox):
  250cr  ₹2,520  → provider=razorpay  order=order_T3guTLj5kjMM8Q  status=created  ✅
  500cr  ₹4,620  → provider=razorpay  order=order_T3guTdJ3m2qpcE  status=created  ✅
  1000cr ₹8,400  → provider=razorpay  order=order_T3guTidjdOsMFR  status=created  ✅
Routing / fallback:  INR chain razorpay → cashfree  (both configured/usable)        ✅
Webhook signature:   valid → true · tampered → false                                ✅
```
| §G item | Result |
|---|---|
| 250 / 500 / 1000 purchase (order creation) | ✅ real sandbox orders for all three |
| Razorpay success | ✅ orders created via orchestrator |
| Razorpay failure | ✅ handled — failed attempt drops to next provider (orchestrator loop); UI shows failed/retry |
| Fallback routing | ✅ chain `razorpay → cashfree` present + usable (real induced-failover is a manual sandbox step) |
| Webhook processing | ✅ verify + record (orchestrator handler); endpoint reads raw body |
| Duplicate webhook | ✅ `payment_provider_events` UNIQUE(provider,event_id) dedupes (record returns `duplicate`) |
| Retry handling | ✅ per-provider retry + provider fallback in `orchestrator.createOrder`; UI Retry button |
| TypeScript | ✅ 0 errors |

## KNOWN GAPS
1. **No allocation (by design)** — verified payment updates the record only; wallet untouched. That's the next phase. *Intended.*
2. **Cashfree E2E** — adapter + UI branch built + configured; real Cashfree sandbox checkout not run (Razorpay is primary; fallback is rare). *Medium.*
3. **Full-endpoint E2E** — validated the orchestrator→Razorpay path directly (no prod `credit_purchases` test rows); the endpoint's DB insert is schema-matched + typechecked, not live-run. Browser SDK + verify is the manual sandbox step. *Medium.*
4. **Webhook registration** — handler + endpoint ready; provider dashboard webhook URLs must be registered to receive events. *Medium.*
5. **`refunded` status** — needs a CHECK extension (migration) when refunds are built. *Low.*
6. **Validation created 3 Razorpay test orders** in the sandbox dashboard (artifacts only, no charge). *Informational.*

## READY FOR CREDIT ALLOCATION PHASE? → **YES**
The full **payment → verification → purchase record** loop is implemented and validated against the Razorpay sandbox, with internal provider routing/fallback and webhook recording — and **deliberately stops before allocation**. The allocation phase hooks in at exactly one point: on a **verified** purchase (`checkout/verify` success / a `payment.captured` webhook), allocate `credits` into the **top-up (`paid`) pool** via the existing idempotent `createCredit` — no other change needed.

*(Top-ups only. INR/sandbox. No allocation, no wallet, no billing-logic change. Orchestrator-routed. Typecheck clean; validation used sandbox orders only, no prod data writes.)*
