# Payment & Billing Readiness Audit

**Date:** 2026-05-15
**Scope:** Readiness for Stripe / Razorpay / subscriptions / invoices / taxes / multi-currency / enterprise contracts
**Status:** AUDIT ONLY

---

## 1. Overall Readiness Summary

| Capability | Status | Production-blocking? |
|---|---|---|
| Razorpay (test mode) | **PARTIAL** | Yes — live keys are explicitly rejected |
| Stripe | **MISSING** | Yes |
| Webhook handler framework | **PARTIAL** | Provider-agnostic abstraction missing |
| Subscription state | **PARTIAL** | No period bounds, no renewal job |
| Invoices | **MISSING** | Yes for B2B / enterprise AR |
| Tax (GST / VAT / sales tax) | **MISSING** | Yes for global rollout |
| Multi-currency | **PARTIAL** | Stored but no FX engine |
| Auto-recharge | **MISSING** | UX nice-to-have, not blocking |
| Enterprise contracts | **MISSING** | Yes for $50K+ deals |
| Refunds | **PARTIAL** | `refund` type exists; flow does not |
| Wallet | **PRESENT** | OK |
| Pricing engine | **PRESENT** | OK |
| Plan tiers | **PRESENT** | OK |
| Quota enforcement | **PRESENT** | OK |
| Margin intelligence | **PRESENT** | OK |

---

## 2. Razorpay Integration

### 2.1 Service: [backend/services/payments/razorpayStagingService.ts](../../backend/services/payments/razorpayStagingService.ts)

**Purpose:** Test-mode-only order creation, webhook verification, fulfillment

**Key functions:**

| Function | Lines | Purpose |
|---|---|---|
| `createRazorpayStagingCreditOrder()` | 173+ | Create order + pending `credit_purchases` row |
| `handleRazorpayStagingWebhook()` | 383+ | Receive webhook, verify, mark event |
| `verifyAndFulfillRazorpayStagingPayment()` | — | Manual operator verify |
| `verifyRazorpayWebhookSignature()` | 105 | HMAC-SHA256 webhook |
| `verifyRazorpayPaymentSignature()` | 113 | HMAC-SHA256 payment confirm |
| `completePurchase()` | — | Calls `createCredit` to grant ledger |

### 2.2 Constraints (production-blocking)

- **Live keys rejected at line 76:** `if (value.startsWith('rzp_live_')) throw Error`
- **Beta-flag gated:** access controlled by monetization control flags
- **No customer self-service:** all Razorpay flows are super-admin-routed
- **Subunit handling:** INR / USD / JPY zero-decimal cases handled at [line 94](../../backend/services/payments/razorpayStagingService.ts)

### 2.3 Webhook Layer

- Route: [pages/api/webhooks/razorpay-staging.ts](../../pages/api/webhooks/razorpay-staging.ts)
- Raw-body signature verification ✅
- Status codes: 200 (processed/duplicate), 202 (ignored), 401 (bad sig), 400 (other)
- Dedup at DB: `payment_provider_events (provider, provider_event_id)` UNIQUE

### 2.4 Findings

| ID | Severity | Finding |
|---|---|---|
| RZP-1 | HIGH | Production payment path does not exist. Building live-mode requires KYC/PCI scoping. |
| RZP-2 | HIGH | No customer-facing checkout — all Razorpay actions are super-admin endpoints (B2B admin loading credits manually) |
| RZP-3 | MEDIUM | No retry-on-failure cron for stuck `fulfillment_status='event_recorded'` rows |
| RZP-4 | MEDIUM | No saved-card / customer record; one-shot charge model only |
| RZP-5 | LOW | Webhook idempotency relies on Razorpay providing stable `provider_event_id`; spot-check coverage in test suite needed |

### 2.5 Remediation Path

1. Convert `razorpayStagingService` → `razorpayService` + `razorpayServiceMode` parameter (`test` | `live`)
2. Remove live-key block; gate live mode behind feature flag + KYC verification
3. Add customer profile linking (`razorpay_customer_id` on `company_billing_profiles`)
4. Add hosted checkout page
5. Add fulfillment retry cron (covers RZP-3)

---

## 3. Stripe Integration

### 3.1 Current State

- **Zero Stripe code paths.**
- Only references found:
  - Legacy comment in [backend/services/creditRevoke.ts](../../backend/services/creditRevoke.ts) ("future Stripe refund webhook + dedicated 'refund' phase")
  - External API instrumentation list ([backend/services/externalApiInstrumentation.ts:31](../../backend/services/externalApiInstrumentation.ts))
  - Snapshot intelligence ([pages/api/intelligence/snapshot.ts:6](../../pages/api/intelligence/snapshot.ts)) — detects **customer-owned Stripe stores**, not Virality's own Stripe

### 3.2 Findings

| ID | Severity | Finding |
|---|---|---|
| STR-1 | HIGH | Stripe SDK not present; greenfield buildout required |
| STR-2 | HIGH | US/EU enterprise customers expect Stripe — Razorpay-only excludes major markets |
| STR-3 | MEDIUM | When added, must follow provider-agnostic pattern to avoid hard-coding Razorpay assumptions everywhere |

### 3.3 Remediation Path

1. Add `payment_providers(id, key, name, capabilities, is_active)` table
2. Generalize webhook handler: `pages/api/webhooks/[provider].ts` → dispatches to provider adapter
3. Add `payment_provider_credentials` (service-role only, no client SELECT)
4. Implement Stripe adapter (`backend/services/payments/stripeService.ts`) mirroring `razorpayStagingService` shape
5. Add Stripe customer linkage to `company_billing_profiles`
6. Implement subscription support (Stripe is the natural fit for `subscription` primitives)

---

## 4. Subscription State

### 4.1 Current State

[database/pricing_plans.sql](../../database/pricing_plans.sql):

```sql
CREATE TABLE organization_plan_assignments (
  organization_id uuid NOT NULL UNIQUE,
  plan_id uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid NULL
);
```

### 4.2 Missing Primitives

| Missing | Impact |
|---|---|
| `current_period_start`, `current_period_end` | No way to detect renewal due dates |
| `auto_renew_enabled` | Cannot offer auto-renewal vs manual |
| `cancel_at_period_end` | No graceful downgrade flow |
| `trial_ends_at` | No trial expiry tracking |
| `provider_subscription_id` | Cannot link back to Stripe/Razorpay subscription |
| `status` (active/past_due/canceled/paused) | Cannot represent lifecycle |
| Renewal cron | No automatic credit grant at period rollover |

### 4.3 Findings

| ID | Severity | Finding |
|---|---|---|
| SUB-1 | HIGH | No subscription lifecycle model — plan is permanent until manually changed |
| SUB-2 | HIGH | Credit allotments are not refreshed monthly — current state implicitly assumes manual top-ups |
| SUB-3 | MEDIUM | No proration logic for mid-period plan changes |

### 4.4 Remediation Path

1. Add `subscriptions` table with period bounds + provider linkage
2. Add `subscription_events` audit table (status transitions)
3. Add monthly renewal cron: at `current_period_end`, create new period + grant `pricing_plans.monthly_credit_allotment` via `createCredit(category='paid', ref_type='subscription_renewal')`
4. Handle provider webhook events (`invoice.paid`, `customer.subscription.deleted`, etc.) → state update

---

## 5. Invoices

### 5.1 Current State

**MISSING.** No `invoices` or `invoice_line_items` tables. No PDF generation. No delivery mechanism.

### 5.2 Required for Enterprise

| Required | Reason |
|---|---|
| `invoices(id, org_id, period_start, period_end, currency, total_amount, tax_amount, status, due_date, paid_at)` | B2B AR |
| `invoice_line_items(invoice_id, description, quantity, unit_price, currency, tax_amount, reference_type, reference_id)` | Line-item billing detail |
| PDF generator | Customer download / email |
| Email delivery | Standard B2B flow |
| Reference back to `credit_transactions` | Audit / dispute |

### 5.3 Findings

| ID | Severity | Finding |
|---|---|---|
| INV-1 | HIGH | No invoicing → cannot serve B2B accounts that require POs |
| INV-2 | HIGH | No tax-line capability → blocks EU/UK/IN/AU markets |
| INV-3 | MEDIUM | Without invoice → credit purchases lack a customer-facing financial document |

### 5.4 Remediation Path

1. Add invoice schema
2. Add line-item generator from `credit_transactions` + `credit_purchases` + `subscriptions`
3. Add headless renderer (Puppeteer/Playwright or Stripe Hosted Invoices) for PDF
4. Add delivery (Resend/SES/SendGrid)
5. Add downloadable invoice route in customer dashboard

---

## 6. Tax Handling

### 6.1 Current State

**ZERO tax logic.** No fields. No service. No external integration.

### 6.2 Required

- VAT (EU/UK)
- GST (IN, AU, CA)
- US sales tax (state + local)
- Reverse charge mechanism for B2B EU
- Tax exemption certificates (US)

### 6.3 Findings

| ID | Severity | Finding |
|---|---|---|
| TAX-1 | HIGH | No tax → cannot legally sell in most jurisdictions |
| TAX-2 | XL | Tax compliance is jurisdictional and complex — outsourcing recommended |

### 6.4 Remediation Path

1. Integrate Stripe Tax (preferred if Stripe is added) or Avalara or TaxJar
2. Add `tax_jurisdiction` resolution on customer at purchase time
3. Store calculated tax on `invoice_line_items.tax_amount` + `tax_rate` + `tax_jurisdiction`
4. Surface tax breakdown on customer invoices
5. Add tax reporting export for finance

---

## 7. Multi-Currency

### 7.1 Current State

- `pricing_plans.currency` stored (default `'USD'`)
- `credit_purchases.currency` stored
- Razorpay tests use **INR**; subunit conversion handled for **USD**/**INR**/**JPY** ([razorpayStagingService.ts:94](../../backend/services/payments/razorpayStagingService.ts))
- **No exchange rate table**
- **No FX snapshot on transactions**

### 7.2 Findings

| ID | Severity | Finding |
|---|---|---|
| FX-1 | MEDIUM | No `currency_exchange_rates` table |
| FX-2 | MEDIUM | `credit_transactions.usd_equivalent` computed at spot rate without preserving the FX used |
| FX-3 | HIGH | Multi-currency reporting unreliable — finance cannot reconcile $X spent vs ₹Y collected |

### 7.3 Remediation Path

```sql
CREATE TABLE currency_exchange_rates (
  id uuid PRIMARY KEY,
  base_currency text NOT NULL,           -- 'USD'
  quote_currency text NOT NULL,
  rate numeric(20,10) NOT NULL,
  source text NOT NULL,                  -- 'ECB' | 'openexchangerates'
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,                  -- null = current
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_currency, quote_currency, valid_from)
);
```

1. Daily cron pulls rates from ECB/OXR
2. At purchase / transaction time: snapshot `fx_rate_used`, `fx_quote_currency` onto the row
3. Reporting reads snapshotted rate (immutable per row), not the current rate

---

## 8. Auto-Recharge

### 8.1 Current State

[backend/services/creditAlertService.ts](../../backend/services/creditAlertService.ts) defines an `auto_topup` enum value but no implementation — alert only.

### 8.2 Findings

| ID | Severity | Finding |
|---|---|---|
| AR-1 | MEDIUM | Customers depleting credits must manually purchase; common UX friction |
| AR-2 | LOW | No `auto_recharge_threshold` / `auto_recharge_amount` config on org |

### 8.3 Remediation Path

1. Add `auto_recharge_config(org_id, enabled, threshold_credits, recharge_amount_credits, saved_payment_method_id)`
2. Daily/hourly cron checks balance < threshold → triggers charge via saved payment method
3. Audit each auto-recharge as `credit_purchases` with `reference_type='auto_recharge'`
4. Hard-cap: max N auto-recharges per month to prevent runaway

---

## 9. Enterprise Contracts

### 9.1 Current State

**No enterprise contract primitive.** Enterprise plan in [pages/pricing.tsx](../../pages/pricing.tsx) routes to "contact sales" — no DB representation.

### 9.2 Findings

| ID | Severity | Finding |
|---|---|---|
| ENT-1 | HIGH | No way to represent NET30/NET60 payment terms |
| ENT-2 | HIGH | No PO (purchase order) capture |
| ENT-3 | MEDIUM | No custom-priced contracts (each enterprise typically has bespoke pricing) |
| ENT-4 | MEDIUM | No multi-year commitments / total contract value tracking |

### 9.3 Remediation Path

```sql
CREATE TABLE enterprise_contracts (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  contract_number text NOT NULL UNIQUE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  total_value_usd numeric(14,2) NOT NULL,
  payment_terms text NOT NULL,                          -- 'NET30' | 'NET60' | 'ANNUAL_UPFRONT'
  total_credit_allotment integer,
  custom_pricing jsonb,                                 -- per-action overrides
  signed_contract_url text,
  signed_by_org text,
  signed_by_virality uuid REFERENCES users(id),
  status text NOT NULL,                                 -- 'draft'|'pending_signature'|'active'|'expired'|'terminated'
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE enterprise_purchase_orders (
  id uuid PRIMARY KEY,
  contract_id uuid NOT NULL REFERENCES enterprise_contracts(id),
  po_number text NOT NULL,
  amount_usd numeric(14,2) NOT NULL,
  issued_at date NOT NULL,
  invoice_id uuid REFERENCES invoices(id),
  paid_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'
);
```

1. Add the schema above
2. Generate invoice at billing cycle start
3. Mark `paid_at` when wire transfer / ACH confirmation arrives
4. Auto-grant credits proportional to invoice payment (or upfront for ANNUAL_UPFRONT)

---

## 10. Refunds

### 10.1 Current State

- `credit_transactions.transaction_type = 'refund'` exists as enum value (never used)
- Comment in [creditRevoke.ts](../../backend/services/creditRevoke.ts): "future Stripe refund webhook + dedicated 'refund' phase"
- `creditRevoke` handles **free/incentive clawback** — explicitly not paid refunds (per service design)

### 10.2 Findings

| ID | Severity | Finding |
|---|---|---|
| REF-1 | HIGH | No automated paid-credit refund flow — requires ops + direct DB |
| REF-2 | MEDIUM | No payment-gateway refund integration |
| REF-3 | MEDIUM | No customer-initiated refund request route |

### 10.3 Remediation Path

1. Add `apply_credit_reservation(phase='refund')` mirror that allows paid_balance decrement with audit
2. Wire to Razorpay/Stripe refund webhooks
3. Add customer-facing refund request route (super-admin approval required)
4. Generate negative `invoice_line_items` row

---

## 11. Provider Event Stream

### 11.1 [supabase/migrations/20260627_monetization_operational_observability.sql](../../supabase/migrations/20260627_monetization_operational_observability.sql)

`monetization_operational_events` table tracks each step of payment flows (order create, webhook recv, verify, fulfill) with severity (INFO/WARN/ERROR/CRITICAL).

### 11.2 Strengths

- ✅ Structured event log
- ✅ Linked to `purchase_id` + `provider_*` IDs
- ✅ `alert_ready` flag for paging
- ✅ `customer_safe` flag to discriminate dispatchable errors from internal ones

### 11.3 Findings

| ID | Severity | Finding |
|---|---|---|
| MOE-1 | LOW | Good foundation; alert-routing rules not encoded |
| MOE-2 | LOW | No dashboard for super-admins to view this stream |

### 11.4 Remediation Path

1. Surface stream in super-admin dashboard
2. Auto-page on `severity='CRITICAL' AND alert_ready=true`

---

## 12. Pricing Engine (already production-ready)

### 12.1 Strengths

- ✅ `llm_model_pricing` is source-of-truth for LLM cost ([20260515_pricing_engine.sql](../../supabase/migrations/20260515_pricing_engine.sql))
- ✅ `action_pricing_config` supports per-action multiplier, min charge, ceiling
- ✅ `estimateLlmHoldCredits` provides conservative pre-flight ceiling
- ✅ `apply_credit_partial_confirm` settles actual cost without race
- ✅ `pricingIntelligenceService` enforces margin window (20%–60%) with bounded adjustment rate

### 12.2 Findings

| ID | Severity | Finding |
|---|---|---|
| PE-1 | LOW | No version history of pricing changes — when did GPT-4o input rate change from X to Y? |
| PE-2 | LOW | No price-change preview / "shadow run" before activating |

### 12.3 Remediation Path

1. `effective_from` already supports point-in-time pricing → add `effective_to` for historical preservation
2. Add `pricing_change_proposals` table for review-before-activate

---

## 13. Quota Enforcement (already production-ready)

[backend/services/costGovernanceService.ts](../../backend/services/costGovernanceService.ts):

- ✅ Per-category budgets with soft/hard ceilings
- ✅ Decision enum (`allowed`/`warned`/`denied`/`overage_approved`)
- ✅ Rolling 30-day window
- ✅ `cost_anomalies` table flags pricing drift

### 13.1 Findings

| ID | Severity | Finding |
|---|---|---|
| QE-1 | MEDIUM | Quota is in *cost* dimensions; not directly linked to user-facing *credit* balance limits |
| QE-2 | LOW | No customer-facing quota dashboard |

---

## 14. Capability Matrix vs Enterprise Requirements

| Capability | Enterprise Need | Status |
|---|---|---|
| Multi-gateway payments | Stripe + Razorpay + ACH/wire | ❌ Stripe missing; ACH/wire absent |
| Subscription billing | Recurring + proration + trials | ❌ Missing |
| Metered billing | Usage-based invoice at period end | ⚠️ Has usage_meter; no invoice rollup |
| Invoicing + PDF | Customer + finance | ❌ Missing |
| Tax (multi-jurisdiction) | EU VAT, IN GST, US sales tax | ❌ Missing |
| Refunds | Provider-initiated + admin-initiated | ⚠️ Partial |
| Multi-currency | Quote + collect + report | ⚠️ Stored, no FX |
| Auto-recharge | Threshold-driven | ❌ Missing |
| Enterprise contracts | NET30/NET60, PO, MSA | ❌ Missing |
| Saved payment methods | Card-on-file | ❌ Missing |
| Customer billing portal | Self-service | ⚠️ Super-admin only |
| Dunning | Failed payment retry / suspend | ❌ Missing |

---

## 15. Phased Roadmap to Enterprise Readiness

### Phase 1 (P0) — Foundation
- Add Stripe adapter (mirror Razorpay structure)
- Generalize webhook handler & provider abstraction
- Subscriptions table + monthly renewal cron
- Saved payment methods + auto-recharge

### Phase 2 (P0) — Invoicing
- Invoices + line items + PDF generation
- Customer-facing invoice download
- Integrate Stripe Tax (Avalara as fallback)

### Phase 3 (P1) — Multi-Currency
- `currency_exchange_rates` + daily FX cron
- FX snapshot on `credit_purchases` + `credit_transactions`
- Multi-currency reporting

### Phase 4 (P1) — Enterprise
- `enterprise_contracts` + PO model
- Custom pricing per contract
- Dunning / suspend on past-due

### Phase 5 (P2) — Polish
- Customer self-service billing portal
- Refund self-service request flow
- Operational observability dashboard
