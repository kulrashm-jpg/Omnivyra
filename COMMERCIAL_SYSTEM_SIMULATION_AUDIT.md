# OMNIVYRA — COMMERCIAL SYSTEM SIMULATION AUDIT (no implementation)

Audit/simulation only — no code modified, nothing deployed, no prod writes. Findings are grounded in the actual source across the Orchestrator / Checkout / Allocation / Invoice phases.

---

## SECTION A — SYSTEM INVENTORY (end-to-end flow)
```
ENTRY POINTS
  /pricing  ──┐                         Super-Admin /super-admin/pricing
  Billing Ctr ┴─→ /command-center/topup → (FX/overrides/plan pricing → billing_* tables)
                       (TopUpPanel)            │
                          │                    ▼
        POST /api/billing/checkout/create-order
                          │  pricingConfigService.getFxConfig + resolvePrice (canonical USD → INR)
                          ▼
        paymentOrchestrator.createOrder  ──→ providerRegistry (routing, INR)
                          │                     Razorpay(p1) ─fallback→ Cashfree(p2)
                          │                     adapters: RazorpayAdapter / CashfreeAdapter
                          ├─ credit_purchases INSERT  status=pending           (PURCHASE RECORD)
                          ▼
              provider SDK (checkout.js / cashfree v3)
                          │  POST /api/billing/checkout/verify
                          ▼
        paymentOrchestrator.verifyPayment ──(verified)──→ completePurchase()   (VERIFICATION)
                          │                                   │
   /api/webhooks/payments/:provider ──→ orchestrator.handleWebhook (verify+record)
        (payment.captured) ──────────────→ completePurchase()  ← second trigger
                          ▼
        completePurchase → createCredit({category:'paid'})  (ALLOCATION → LEDGER credit_transactions)
                          │                 ↑ idempotencyKey = makeIdempotencyKey(org,'credit_purchase',id)
                          ├─ organization_credits.paid_balance += credits        (WALLET)
                          ├─ credit_purchases: status=completed, fulfillment_status=completed, fulfilled_at
                          └─ generateTopupInvoice → invoices + invoice_line_items (INVOICE) → PDF endpoint
                          ▼
        Billing Center (getBillingCenter): plan · pools (plan/bonus/topup) · history · invoices+download
                          ▲
   CONSUMPTION: creditPriorityService.computeSplit → free(monthly) → incentive → paid(top-up)
   MONTHLY ALLOC: subscriptionAllocationService → createCredit({category:'free'})  (separate pool)
```
**State transitions:** `purchase: pending → (verify/webhook) → completed | failed`; `fulfillment: pending → event_recorded → completed | failed`; `wallet.paid += credits (once)`; `invoice: draft → paid`.

---

## SECTION B — PURCHASE STATE MACHINE AUDIT
DB `credit_purchases.status` CHECK = **{pending, completed, failed}** (mig 20260322). `fulfillment_status` (free text) observed = {pending, event_recorded, completed, failed}. (Spec "paid" = `completed`; **"refunded" is NOT in the CHECK** → unsupported.)

| Transition | Trigger | Source / Service | Protection | PASS/FAIL |
|---|---|---|---|---|
| pending → completed | verify/webhook OK | `checkout/verify`,`webhooks/payments` → `purchaseService.completePurchase` | `.eq('status','pending')` guard | ✅ |
| pending → failed | unverified / timeout | `checkout/verify` → `failPurchase` | status set | ✅ |
| completed → completed | duplicate verify/webhook | `completePurchase` early-return (l.130) | idempotent | ✅ |
| fulfillment pending→completed | grant OK | `completePurchase` (l.193) | after createCredit | ✅ |
| fulfillment →failed | grant throws | `completePurchase` (l.180) | error path | ⚠ see below |
| failed → completed | — | blocked (l.133 `already_failed`) | guard | ✅ (forbidden, enforced) |
| paid + failed (status) | — | impossible (single column) | schema | ✅ |
| pending + fulfilled | — | impossible (fulfillment set only after status=completed) | ordering | ✅ |
| **completed + fulfillment=failed** | grant fails AFTER status flip | `completePurchase` sets status=completed (l.140) BEFORE createCredit (l.162) | **none until re-call** | ❌ **FAIL** |

**Finding B-1 (contradictory state, real):** `completePurchase` flips `status='completed'` *before* the credit grant. If `createCredit` throws, the row is **paid-but-unfulfilled** (status=completed, fulfillment_status=failed, **0 credits**). It self-heals only if `completePurchase` is called again (a webhook re-fire). With no webhook registered, it is **stuck**. → High.

---

## SECTION C — END-TO-END SIMULATION MATRIX
| Step | S1 (250) | S2 (500) | S3 (1000) |
|---|---|---|---|
| Order created | ✅ orchestrator→Razorpay (sandbox-proven: `order_T3guT…`) | ✅ | ✅ |
| Payment completed | ⚠ **browser SDK — not executed here** | ⚠ | ⚠ |
| Verification | ✅ logic (orchestrator.verifyPayment, HMAC) | ✅ | ✅ |
| Purchase record | ✅ pending→completed | ✅ | ✅ |
| Allocation | ✅ +250 paid (code) | ✅ +500 | ✅ +1000 |
| Wallet update | ⚠ **not run (prod wallet)** — harness ready | ⚠ | ⚠ |
| Invoice | ✅ idempotent gen + PDF (1,522-byte render proven) | ✅ | ✅ |
| Billing refresh | ✅ pools+history+invoices | ✅ | ✅ |
| Expected state | completed/fulfilled, +N paid, 1 invoice | same | same |
| Actual (simulated) | matches in code; **live balance unproven** | same | same |
| **PASS/FAIL** | ⚠ **PARTIAL** (code PASS; live run pending) | ⚠ PARTIAL | ⚠ PARTIAL |

---

## SECTION D — FAILURE MATRIX
| Scenario | System behaviour | Recovery | User-visible | Data consistency | PASS/FAIL |
|---|---|---|---|---|---|
| Payment failure | `failPurchase` → status=failed | none needed | "Payment failed" + Retry | consistent | ✅ |
| Provider timeout (after order create) | createOrder sees failure → tries next provider | order on provider A orphaned (unpaid) | falls back / retry | 1 purchase, ≤1 paid | ⚠ orphaned provider order (low) |
| Verification failure | 400, status=failed | re-checkout | "Verification failed" | consistent | ✅ |
| **Allocation failure** | status already=completed, fulfillment=failed | **only on webhook re-call; no sweeper** | 500; record shows paid | **paid-but-unfulfilled** | ❌ FAIL (B-1) |
| Invoice failure | best-effort; allocation unaffected | retry on next verify/webhook (idempotent) | invoice missing until retry | consistent | ✅ |
| Webhook failure (bad sig) | 401, no record/alloc | provider retries | none | consistent | ✅ |
| Provider unavailable | routing skips unconfigured; fallback | Cashfree | transparent | consistent | ✅ |
| Provider retry | createOrder per-provider retry + fallback | yes | transparent | 1 purchase | ✅ |

---

## SECTION E — IDEMPOTENCY AUDIT
| Case | Purchases | Credit grants | Invoices | Wallet changes | PASS/FAIL |
|---|---|---|---|---|---|
| Duplicate verify | 1 | 1 (idempotencyKey UNIQUE) | 1 (invoice_number UNIQUE) | 1 | ✅ |
| Duplicate webhook | 1 | 1 | 1 | 1 | ✅ (`payment_provider_events` UNIQUE(provider,event_id)) |
| Webhook replay | 1 | 1 | 1 | 1 | ✅ (event dedup) |
| Verify + webhook race | 1 | 1 (`.eq('status','pending')` + key) | 1 | 1 | ✅ |
| Allocation retry | 1 | 1 | 1 | 1 | ✅ (deterministic key — proven `58709848…`) |
| Invoice retry | 1 | 1 | 1 (deterministic number) | — | ✅ |
| Provider retry | 1 | ≤1 | ≤1 | ≤1 | ✅ |
**Idempotency: PASS** — four independent layers (deterministic ledger key + UNIQUE idempotency_key + completed-guard + webhook-event UNIQUE).

---

## SECTION F — WEBHOOK AUDIT
| Check | Razorpay | Cashfree | PASS/FAIL |
|---|---|---|---|
| Signature verification | HMAC-SHA256(rawBody, secret), `timingSafeEqual` | HMAC-SHA256(timestamp+rawBody) base64 | ✅ |
| Replay protection | event dedup (`payment_provider_events` UNIQUE) | same | ✅ (via dedup) |
| Timestamp protection | none (Razorpay doesn't sign ts) | ts **in signature** but **no freshness window** | ⚠ Medium |
| Duplicate detection | UNIQUE(provider,event_id) | same | ✅ |
| Invalid signature | DENY (no record/alloc) | DENY | ✅ |
| Old-event replay | deduped (same event_id) | deduped; stale-but-unseen ts accepted | ⚠ Medium |
| Cross-provider injection | per-URL `[provider]` + **per-provider secret** → wrong secret fails | same | ✅ |
**Finding F-1:** no explicit timestamp-freshness rejection; replay is mitigated by dedup, not by a time window. → Medium.

---

## SECTION G — CREDIT ECONOMY AUDIT
| Check | Result | PASS/FAIL |
|---|---|---|
| Monthly consumed first | `computeSplit` free→incentive→paid; monthly=free | ✅ |
| Top-up consumed second | top-up=paid (last) | ✅ |
| No negative balances | `computeSplit` returns null if insufficient; CHECK ≥0 | ✅ |
| No double deduction | atomic `apply_credit_reservation` RPC | ✅ |
| No cross-pool leakage | per-category split; `paid` never-expire (DB-guarded); monthly=free | ✅ |
| Top-up alloc → paid only | `createCredit({category:'paid'})` | ✅ |
| Monthly alloc → free only | `subscriptionAllocationService` → `category:'free'` | ✅ |
**Credit economy: PASS.**

---

## SECTION H — INVOICE AUDIT
| Check | Result | PASS/FAIL |
|---|---|---|
| One purchase → one invoice | deterministic `INV-YYYYMM-<8hex>` + UNIQUE invoice_number | ✅ |
| Invoice retry / regeneration | returns existing (no dup) | ✅ |
| Duplicate webhook/verify → invoices | 1 | ✅ |
| Numbering / uniqueness | UNIQUE constraint enforced | ✅ |
| Download endpoint | `/api/billing/invoices/:id/pdf` (pdfkit, org-scoped) — render proven | ✅ |
| Billing-center visibility | invoices table + Download link | ✅ |
**Invoice: PASS (code).** Note: invoice ↔ purchase link is **soft** (`metadata.purchase_id` + line `reference_id`), not a FK; `invoices.payment_transaction_id` FK is **unused** (flow records in `credit_purchases`, not `payment_transactions`). → Medium (H-1).

---

## SECTION I — PROVIDER ROUTING AUDIT
| Check | Result | PASS/FAIL |
|---|---|---|
| Razorpay primary | priority 1, INR | ✅ |
| Cashfree secondary | priority 2, INR | ✅ |
| Failover | `createOrder` loops candidates on failure | ✅ |
| Recovery | unconfigured providers skipped; re-included when configured | ✅ |
| Duplicate orders | only on **timeout-after-create** (provider A order orphaned, unpaid) | ⚠ Low |
| Lost orders | no — both-fail → purchase=failed (recorded) | ✅ |
| Orphaned purchases | purchase created before order; on total failure → status=failed | ✅ |
**Finding I-1:** a provider timeout *after* it created the order can leave an orphaned unpaid provider order while the customer pays via fallback — **no duplicate purchase or credits**, just an abandoned provider-side order. → Low.

---

## SECTION J — DATA CONSISTENCY AUDIT (trace one purchase)
```
purchase.id = P
  order:        credit_purchases.id = P, provider_order_id = O           ✅
  payment:      reference_id = paymentId                                  ✅
  verification: completePurchase(P, paymentId)                            ✅
  allocation:   credit_transactions.reference_id = P (referenceType=credit_purchase)  ✅
  invoice:      invoices.metadata.purchase_id = P; line_item.reference_id = P  ✅ (soft)
  billing ctr:  reads credit_purchases(P) + paid pool + invoices          ✅
```
| Check | Result | PASS/FAIL |
|---|---|---|
| Every entity references P | yes (ledger via FK-style reference_id; invoice via metadata) | ✅ |
| No orphan records | purchase precedes children; failed paths recorded | ✅ |
| No broken references | consistent | ✅ |
| No missing FKs | ⚠ `invoices.payment_transaction_id` (canonical FK) **null/unused**; invoice→purchase is metadata, not FK | ⚠ Medium (H-1) |
**Data consistency: PASS with one soft-link caveat.**

---

## SECTION K — COMMERCIAL READINESS SCORE
| Dimension | Score | Rationale |
|---|---|---|
| **Architecture** | **82 / 100** | Clean orchestrator/registry/adapter layering, correct pool model, idempotent ledger. −: two parallel order+webhook paths; `payment_transactions` unused. |
| **Implementation** | **56 / 100** | Code complete + typecheck-clean, but **checkout is non-functional in prod** (mig 20260723 unapplied → `create-order` selects non-existent `canonical_usd_price`; `credit_packages` empty). Live flow unrun. |
| **Reliability** | **66 / 100** | Idempotency strong; −: paid-before-grant window (B-1) with no sweeper; no webhook freshness window; dual webhook handlers. |
| **Commercial readiness** | **38 / 100** | Test-gated providers, migration unapplied/unseeded, no public deploy, no live/sandbox E2E executed. |

---

## SECTION L — GAP REPORT (real gaps only)
| # | Sev | Affected | Impact | Root cause | Required fix |
|---|---|---|---|---|---|
| L1 | **Critical** | checkout/create-order, both order paths, credit_packages | Checkout **errors in prod** (`column canonical_usd_price does not exist`) + nothing to buy | mig `20260723` not applied; packages unseeded | Apply migration + seed via controlled process |
| L2 | **Critical** | Razorpay/Cashfree adapters, orchestrator | Cannot charge real money | providers `mode='test'`, `rzp_live_` rejected (by design) | Add gated live-mode + live keys; staging-validate first |
| L3 | **High** | purchaseService.completePurchase, verify, webhook | **paid-but-unfulfilled** purchase on grant failure; stuck without a webhook | status flips to completed *before* createCredit; no reconciliation sweeper | Reconciliation sweeper retrying `completePurchase` for `status=completed && fulfillment_status≠completed` (idempotent) |
| L4 | **High** | /api/billing/topup/* (legacy) + razorpay-staging webhook vs /checkout/* + /webhooks/payments | Two allocating paths + two webhook handlers → config/double-processing & drift risk | A.2 flow left in place when orchestrator flow added | Converge on the orchestrator path; retire/redirect legacy endpoints + webhook |
| L5 | Medium | invoices ↔ payment_transactions | Canonical payment record unused; invoice↔purchase link is soft (metadata) | flow records in credit_purchases only | Populate `payment_transactions` + set `invoices.payment_transaction_id`, or formalize the credit_purchases link |
| L6 | Medium | webhook handlers | No timestamp-freshness rejection (replay relies on dedup) | freshness window not implemented | Reject events older than N minutes (Cashfree ts; Razorpay event time) |
| L7 | Low | orchestrator.createOrder | Orphaned unpaid provider order on timeout-after-create | no order-reconcile/cancel | Cancel/ignore unpaid orphan orders (provider reconcile) |
| L8 | Low | credit_purchases | `refunded` status unsupported (CHECK lacks it) | out of scope so far | Add `refunded` to CHECK + refund path when needed |

---

## SECTION M — REMEDIATION PLAN (single prompt; do not implement)
> **OMNIVYRA — COMMERCIALIZATION PHASE E (CONVERGENCE & ACTIVATION).** Close all Critical/High gaps in the smallest coherent phase, top-ups/INR/sandbox-first, no new features.
> 1. **Apply** migration `20260723` (canonical `credit_packages` columns + FX/override/plan-pricing tables + seeds) via the controlled process; verify rows exist. (L1)
> 2. **Converge to one path:** make `/command-center/topup` + webhooks use ONLY the orchestrator checkout (`/api/billing/checkout/*` + `/api/webhooks/payments/[provider]`); retire or 410 the legacy `/api/billing/topup/{create-order,verify}` + the `razorpay-staging` webhook so exactly one path allocates. (L4)
> 3. **Reconciliation sweeper:** add an idempotent job that finds `credit_purchases` with `status='completed' AND fulfillment_status NOT IN ('completed')` and re-invokes `completePurchase` (idempotency-key-safe), closing the paid-but-unfulfilled window. (L3)
> 4. **Gated live mode:** add `mode: 'test'|'live'` to the orchestrator providers driven by an explicit env flag + live keys (default test); keep the fail-fast validator. Do NOT enable in prod yet. (L2)
> 5. **Validate:** run `scripts/sandbox/topup-e2e.ts` against a **designated test org** (+250/+500/+1000, dup=0, one invoice each); register sandbox webhooks on a public deploy; exercise the failure + idempotency matrix. Then typecheck.
> *(Medium/Low gaps L5–L8 deferred: payment_transactions linkage, webhook freshness window, orphan-order reconcile, refund status.)*

---

## FINAL VERDICT: **NOT READY FOR LIVE TOP-UP SALES**

### Every blocker
1. **Migration `20260723` unapplied + `credit_packages` unseeded** → checkout errors in prod (selects a non-existent column; no packages). *Critical.*
2. **Providers test-gated** (no live mode / live keys) → cannot charge real money. *Critical.*
3. **Paid-but-unfulfilled window** (B-1/L3) with no reconciliation sweeper → a paid customer can end up with 0 credits until a webhook re-fires. *High.*
4. **Two parallel allocating paths** (legacy `/topup/*` + staging webhook vs orchestrator) → config ambiguity / drift. *High.*
5. **No live/sandbox E2E executed** (browser checkout) + **dashboard webhooks not registered** + **no public deployment**. *Critical (operational).*
6. Medium: `payment_transactions` unused / soft invoice link; no webhook freshness window. Low: orphan-order on timeout; `refunded` unsupported.

> Closing blockers 1–4 is exactly the **Section M** phase; blocker 5 is the operational run (designated test org + public deploy + dashboard webhooks + a real sandbox checkout). After both, re-audit C/D/E live before enabling live mode.

*(Audit only — no code modified, no deployment, no prod writes. Findings verified against source: `purchaseService.completePurchase`, `razorpayStagingService`, orchestrator, checkout endpoints, invoice service.)*
