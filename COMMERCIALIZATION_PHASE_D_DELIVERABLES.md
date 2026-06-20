# OMNIVYRA — COMMERCIALIZATION PHASE D (SANDBOX E2E + WEBHOOKS + INVOICES) — AUDIT

Invoice generation + PDF + Billing Center download **built and validated** (§D/§E). The **live sandbox E2E, dashboard webhook registration, and prod-wallet allocation (§A/§B/§C/§F)** require a browser, provider-dashboard access, and a designated test org — they **cannot be executed from this headless, prod-only environment**. A server-side E2E harness is provided to run §A(server)/§C/§F against a designated test org. **TypeScript: 0 errors. PDF render: confirmed.**

## WHAT I CAN vs CANNOT DO HERE (honest scope)
| Section | Needs | Status |
|---|---|---|
| §A browser checkout (250/500/1000) | a **browser** driving Razorpay/Cashfree SDK + a test wallet | ⛔ I can't operate a browser — **manual** |
| §B dashboard webhook registration | login to **Razorpay/Cashfree dashboards** + a public URL | ⛔ I can't access dashboards — **manual** |
| §C allocation (+250/+500/+1000) | writes to a **production wallet** | ⛔ won't mutate prod wallets unprompted — needs a **designated test org** |
| §D invoice generation + PDF | code | ✅ **built + validated** |
| §E billing-center invoices + download | code | ✅ **built** |
| §F failure/idempotency live runs | execution env + test org | ⛔ logic proven; live run via the harness |

## FILES CHANGED
| File | Role |
|---|---|
| `backend/services/billing/topupInvoiceService.ts` (new) | **§D** idempotent invoice + line item per paid purchase (deterministic `invoice_number`) |
| `pages/api/billing/invoices/[id]/pdf.ts` (new) | **§D/E** on-demand pdfkit PDF (org-scoped) |
| `pages/api/billing/checkout/verify.ts` | generate invoice after fulfillment (best-effort, idempotent) |
| `pages/api/webhooks/payments/[provider].ts` | generate invoice after webhook fulfillment |
| `components/billing/BillingCenter.tsx`, `backend/services/billingCenterService.ts` | **§E** invoices show Provider/Status/Amount + **Download** |
| `scripts/sandbox/topup-e2e.ts` (new) | server-side §A/§C/§F harness (designated test org; guarded) |
Uses existing `invoices` / `invoice_line_items` tables — **no schema change, no wallet/ledger change**.

## INVOICE GENERATION (§D)
On a **paid** purchase → one `invoices` row (`invoice_number = INV-YYYYMM-<8hex>`, `status=paid`, `issued_at`/`paid_at`, `total=amount_paid`, `metadata={purchase_id, credits, provider, provider_reference}`) + one `invoice_line_items` row (`N top-up credits`). Idempotent: deterministic number + UNIQUE constraint → retry returns the existing invoice. PDF rendered on demand from the stored rows (pdfkit), exposed at `/api/billing/invoices/:id/pdf`.

## VALIDATION RESULTS
```
PDF render (pdfkit):    ✅ generated a 1,522-byte A4 invoice PDF (no DB)
TypeScript:             ✅ 0 errors (invoice service, PDF endpoint, wiring, billing center, harness)
Idempotency (key):      ✅ proven in the Allocation Phase (deterministic makeIdempotencyKey)
Order creation (Phase1):✅ 250/500/1000 → real Razorpay sandbox orders
Invoice idempotency:    ✅ by construction (deterministic invoice_number + UNIQUE)
```

## §G AUDIT REPORT (what was executed vs is ready)
| Metric | This environment |
|---|---|
| Sandbox transactions executed (browser) | **0** — browser required (3 order-creations done in Phase 1, order-level) |
| Webhook events received | **0** — provider dashboards not registered (no access) |
| Invoices generated (live) | **0** — generation built + PDF validated; runs on real/harness purchases |
| Balance changes | **0** — no prod-wallet writes performed |
| Ledger / credit-transaction / purchase / invoice records | **0 written by me** — the harness creates+captures these against a designated test org |
| TypeScript | ✅ 0 errors |

> The server-side harness `scripts/sandbox/topup-e2e.ts` produces the §A(server)/§C/§F evidence — before/after paid balance, exact grants (+250/+500/+1000), duplicate-grant=0, one invoice — when run as:
> `ALLOW_SANDBOX_WALLET_WRITES=true npx tsx -r dotenv/config scripts/sandbox/topup-e2e.ts dotenv_config_path=.env.local <TEST_ORG_ID>`

## FINAL VERDICT: **NOT READY FOR LIVE TOP-UP SALES**

### Remaining blockers
1. **Sandbox E2E not human-executed** — real browser checkout (Razorpay/Cashfree SDK) for 250/500/1000 against a designated test org, capturing before/after. *Critical — manual.*
2. **Dashboard webhooks not registered** — register `/api/webhooks/payments/razorpay` + `/cashfree` in each provider's dashboard against a publicly deployed URL; validate success/failure/duplicate/retry/invalid-signature. *Critical — manual.*
3. **Allocation not live-validated** — run the harness against a **designated test org** (you provide the id; I won't pick one) to prove +250/+500/+1000 and idempotency. *Critical.*
4. **Live-mode productionization** — Razorpay/Cashfree are **test-gated** (`PROVIDER_MODE='test'`, `rzp_live_` rejected). Live sales need live-mode + live keys (Phase A.1 §C). *Critical.*
5. **Migration `20260723` not applied** — canonical `credit_packages` + FX config must be applied via the controlled process. *Critical.*
6. **`refunded` status + invoice tax/compliance** — refund path + GST/tax fields not implemented. *High.*
7. **Public deployment** — webhooks + checkout need the app deployed at a public URL. *High.*

### Go-live checklist (once a non-prod/staging env + designated test org exist)
1. Apply migration `20260723` (canonical packages + FX) to the target env.
2. Provide a **designated test org**; run `topup-e2e.ts` → confirm +250/+500/+1000, dup=0, one invoice each.
3. Deploy publicly; register Razorpay + Cashfree **sandbox** webhooks; run a real browser checkout for each pack; capture before/after + webhook events.
4. Exercise §F: payment failure, duplicate webhook, retry, invalid signature → confirm idempotent (no duplicate credits, one invoice).
5. Productionize providers to **live** mode + live keys; re-run a single low-value live transaction; verify allocation + invoice; then enable sales.

*(Built: invoice generation + PDF + billing-center download. No wallet/ledger/pricing change. PDF render confirmed; typecheck clean. Live E2E/webhooks/allocation are manual/test-org steps — harness + runbook provided; no prod-wallet writes performed.)*
