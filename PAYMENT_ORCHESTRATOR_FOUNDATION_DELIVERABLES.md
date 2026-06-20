# OMNIVYRA — PAYMENT ORCHESTRATOR FOUNDATION — DELIVERABLES

Provider-agnostic payment orchestrator: **Razorpay (primary) + Cashfree (fallback)**, test mode, INR routing. No live payments, no UI/billing changes. Stripe/PayPal extensible without architecture change. **TypeScript: 0 errors. Section G: all pass.**

## FILES CHANGED (all new — `backend/services/payments/orchestrator/`)
| File | Role |
|---|---|
| `types.ts` | Canonical contracts: `PaymentProvider`, `CanonicalOrder`, `OrderRequest`, `VerifyResult`, `PaymentAdapter`, `WebhookHandler` |
| `providerRegistry.ts` | **§A** registry + **§C** currency routing & fallback |
| `providerConfig.ts` | **§D** env credentials, validation, fail-fast assert |
| `razorpayAdapter.ts` / `cashfreeAdapter.ts` | **§E** adapters (common shape, test-gated) |
| `adapters.ts` | Adapter registry (`getAdapter`) |
| `webhookHandlers.ts` | **§F** Razorpay/Cashfree handlers (verify + record only) + handler registry |
| `paymentOrchestrator.ts` | **§B** resolve / createOrder (fallback+retry) / verify / handleWebhook / health |
| `index.ts` | Public surface |
**No UI, no billing logic, no DB schema change.** (Webhook handlers reuse the existing `recordPaymentProviderEvent` — event recording only.)

## ARCHITECTURE
```
                        paymentOrchestrator  (§B, internal)
                                 │
          resolveProviderForCurrency(currency)   ← §C routing (never user-chosen)
                                 │
                 ┌───────────────┴───────────────┐
        providerRegistry (§A)            providerConfig (§D)
   Razorpay p1 ─ Cashfree p2 ─ …      env creds + fail-fast validation
                                 │
                     getAdapter(provider_id)  (§E, common shape)
                 ┌───────────────┼───────────────┐
        RazorpayAdapter     CashfreeAdapter   (Stripe / PayPal → just add)
        createOrder / verifyPayment / verifyWebhookSignature
                                 │
                     webhookHandlers (§F): verify + record only
            RazorpayWebhookHandler        CashfreeWebhookHandler
```
**Flow:** order → orchestrator resolves provider by currency → adapter.createOrder (fallback to next provider on failure) → adapter.verifyPayment → webhook handler verifies + records. Adding a provider = one registry row + one adapter + one webhook handler; routing/orchestrator unchanged.

## PROVIDER REGISTRY (§A)
| provider_id | name | enabled | priority | currencies | methods | mode |
|---|---|---|---|---|---|---|
| `razorpay` | Razorpay | true | **1** | INR | card, upi, netbanking, wallet | test |
| `cashfree` | Cashfree | true | **2** | INR | card, upi, netbanking | test |

Model fields: `provider_id, provider_name, enabled, priority, supported_currencies, supported_payment_methods, mode` — Stripe/PayPal slot in by appending a row.

## VALIDATION RESULTS (§G — live, no order executed)
```
Registry:   razorpay(p1,test) · cashfree(p2,test)
Routing:    INR: razorpay → cashfree    USD: (none — Stripe not yet added)
Adapters:   razorpay instance=true configured=true · cashfree instance=true configured=true
Webhooks:   registered: razorpay, cashfree
§D validator: ok=true  missing=[]  errors=0   ← both providers' TEST creds present in env
Health:     all providers { adapter:true, webhook:true, configured:true }
```
- **Provider registry loads** ✅ · **Routing works** (INR primary→fallback, internal) ✅
- **Razorpay adapter initializes** ✅ · **Cashfree adapter initializes** ✅
- **Webhook handlers register** ✅ · **No live payment execution** ✅ (validation never called `createOrder`)
- **Env validation / fail-fast** ✅ — `RAZORPAY_TEST_KEY_ID/SECRET` + `CASHFREE_TEST_APP_ID/SECRET` detected; validator passes. (Fail-fast assert is opt-in at orchestrator init — deliberately not wired into global bootstrap so it can't crash key-less environments.)
- **TypeScript:** 0 errors.

## READY FOR CHECKOUT PHASE? → **YES**
The orchestration foundation is complete and validated, and **both providers' test credentials are present**, so the checkout phase can build directly on it. Next phase wires `paymentOrchestrator.createOrder` / `verifyPayment` / `handleWebhook` into the top-up checkout (replacing the direct `razorpayStagingService` call), adds the Cashfree order/verify endpoints, and runs the success/fail/duplicate/webhook/retry matrix against the sandboxes.

> Scope honored: test/sandbox only, no live charging, no production execution, no UI or billing-logic changes; webhook handlers verify + record only (no credit allocation).

*(All new orchestration code. No live payments. No billing changes. Fail-fast is opt-in. Typecheck clean; no order executed.)*
