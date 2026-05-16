# Target Enterprise Credit Architecture

**Date:** 2026-05-15
**Scope:** Required architectural shape to support enterprise-scale credit consumption, multi-currency billing, payment gateways, reservations, and financial governance
**Status:** AUDIT ONLY — recommendations are advisory, no fixes applied

---

## 1. Architectural Principles for Enterprise Readiness

| Principle | Current vs Target |
|---|---|
| **Append-only ledger** | Convention ✅ / DB-enforced ❌ |
| **Single atomic mutation path** | RPC enforced ✅ |
| **Idempotency end-to-end** | DB layer ✅ / app boundaries ⚠️ (queue retries) |
| **Reservation before work** | Required ✅ in `executeWithCredits`, leaked in queue processors ⚠️ |
| **Reconciliation as financial audit signal** | Daily ✅ / continuous ❌ |
| **Multi-currency immutable snapshot** | Stored ⚠️ / immutable per-row ❌ |
| **Per-feature pricing catalog** | `action_pricing_config` ✅ |
| **Token-to-credit conversion** | `llm_model_pricing` + `apply_credit_partial_confirm` ✅ |
| **Approval chain for above-threshold actions** | ❌ |
| **Time-versioned pricing** | `effective_from` ⚠️ / `effective_to` partial |
| **Provider-agnostic payment surface** | ❌ |
| **Invoice + tax engine** | ❌ |

---

## 2. Capability Evaluation (Phase 4 of Audit Prompt)

| # | Capability | Status | Path to Enterprise |
|---|---|---|---|
| 1 | Immutable append-only ledger | **Partially-ready** — convention enforced, DB layer must add immutability trigger |
| 2 | Financial reconciliation | **Enterprise-ready** — auto reconciler exists; raise cadence to hourly |
| 3 | Multi-currency pricing | **Prototype-level** — add `currency_exchange_rates` + FX snapshot |
| 4 | Token-to-credit conversion | **Enterprise-ready** — `apply_credit_partial_confirm` handles dynamic |
| 5 | Dynamic pricing tables | **Enterprise-ready** — `action_pricing_config` + `pricingIntelligenceService` |
| 6 | Enterprise billing | **Missing** — no invoicing, no tax, no terms |
| 7 | Subscription billing | **Prototype-level** — `organization_plan_assignments` is static |
| 8 | Wallet / recharge system | **Partially-ready** — wallet exists; auto-recharge missing |
| 9 | Payment gateways | **Prototype-level** — Razorpay test only; no Stripe |
| 10 | Credit reservations | **Enterprise-ready** — HOLD/CONFIRM/RELEASE atomic |
| 11 | Long-running job accounting | **Partially-ready** — HOLD reaper protects against orphans; queue processors leak |
| 12 | Distributed worker billing safety | **Partially-ready** — idempotency at DB; not enforced at queue/worker boundary |
| 13 | Financial audit exports | **Missing** — no CSV/JSON export route |
| 14 | Approval workflows | **Missing** |
| 15 | Credit adjustment governance | **Partially-ready** — reason+enum captured; no caps or approvals |

---

## 3. Required Data Models (Phase 5)

### A. `credit_accounts` — **PARTIAL** (exists as `organization_credits`)

**Current:**

```sql
organization_credits (organization_id PK, free/paid/incentive balances + reserved_* + lifetime_*, credit_rate_usd)
```

**Missing fields for enterprise:**
- `account_status` — `active | suspended | closed | frozen`
- `closed_at` / `closure_reason`
- `parent_account_id` — for hierarchical accounts (enterprise parent + subsidiary)
- `billing_email` — distinct from primary owner email
- `time_zone` — for monthly period calculations
- `currency_preference` — display currency

**Migration complexity:** S (additive)
**Compatibility risk:** Low
**Scaling concerns:** Wallet table is keyed by org — already partitionable by org_id range if needed

### B. `credit_ledger` — **MOSTLY READY** (exists as `credit_transactions`)

**Current:** All key fields present. Phase enum + idempotency + parent_transaction_id + category + per-category deltas.

**Missing for enterprise:**
- DB-level immutability trigger
- `fx_quote_currency` + `fx_rate_used` for multi-currency snapshot
- `tax_amount` + `tax_currency` for tax-bearing transactions
- `invoice_line_item_id` foreign key (when invoicing exists)
- `reversed_by_transaction_id` (when fraud-correction reversal is added)

**Migration complexity:** M
**Compatibility risk:** Low — additive columns only
**Financial risk if not added:** Multi-currency reconciliation impossible

### C. `credit_adjustments` — **NOT a separate table; merged into ledger**

**Recommendation:** Keep adjustments as a `transaction_type='adjustment'` row in `credit_transactions`, but add a side-table for adjustment metadata:

```sql
CREATE TABLE credit_adjustment_details (
  credit_transaction_id uuid PRIMARY KEY REFERENCES credit_transactions(id),
  adjustment_type text NOT NULL CHECK (adjustment_type IN
    ('correction','clawback','migration','goodwill','dispute_resolution','operator_error')),
  proposed_by uuid NOT NULL,
  approved_by uuid[],                    -- N-of-M approvals
  business_justification text NOT NULL,
  customer_facing_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**Migration complexity:** S
**Compatibility risk:** Low

### D. `credit_reservations` — **EFFECTIVELY EXISTS as HOLD rows in `credit_transactions`**

**Current:** A HOLD row IS a reservation. CONFIRM/RELEASE rows reference it via `parent_transaction_id`.

**Missing for enterprise:**
- View / materialized view exposing open HOLDs by `(org, age, amount)` for ops dashboard
- Explicit `expires_at` enforcement cron (currently set but not enforced beyond reaper window)
- `reservation_lease_id` for distributed-worker assignment (which worker owns this HOLD?)

**Migration complexity:** S
**Recommendation:** Create `v_credit_reservations` view:

```sql
CREATE VIEW v_credit_reservations AS
SELECT
  h.id AS reservation_id,
  h.organization_id,
  h.created_at,
  h.expires_at,
  h.free_delta + h.incentive_delta + h.paid_delta AS reserved_total,
  c.id AS confirmed_by,
  r.id AS released_by,
  CASE
    WHEN c.id IS NOT NULL THEN 'confirmed'
    WHEN r.id IS NOT NULL THEN 'released'
    WHEN h.expires_at < now() THEN 'expired_pending_reap'
    ELSE 'open'
  END AS state
FROM credit_transactions h
LEFT JOIN credit_transactions c ON c.parent_transaction_id = h.id AND c.execution_phase = 'confirm'
LEFT JOIN credit_transactions r ON r.parent_transaction_id = h.id AND r.execution_phase = 'release'
WHERE h.execution_phase = 'hold';
```

### E. `pricing_catalog` — **EXISTS as `action_pricing_config` + `llm_model_pricing`**

**Current:** Two tables. Per-action multiplier, min charge, ceiling. Per-model token rates.

**Missing for enterprise:**
- Per-plan price overrides (`pricing_catalog_overrides(plan_id, action_key, multiplier)`)
- Per-org price overrides (`pricing_catalog_overrides(org_id, ...)`) for enterprise custom pricing
- Currency variations (`action_pricing_config_by_currency`)
- `effective_to` for historical preservation

**Migration complexity:** M

### F. `currency_exchange_rates` — **MISSING**

**Required:**

```sql
CREATE TABLE currency_exchange_rates (
  id uuid PRIMARY KEY,
  base_currency text NOT NULL,
  quote_currency text NOT NULL,
  rate numeric(20,10) NOT NULL,
  source text NOT NULL,                 -- 'ECB' | 'openexchangerates' | 'manual'
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,                 -- null = current
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_currency, quote_currency, valid_from)
);

CREATE INDEX idx_fx_lookup ON currency_exchange_rates(base_currency, quote_currency, valid_from DESC);
```

Daily cron pulls fresh rates. Per-transaction FX snapshot is then taken at HOLD/CONFIRM time and immutably stored on the ledger row.

**Migration complexity:** S
**Compatibility risk:** None — net-new

### G. `company_billing_profiles` — **MISSING**

**Required:**

```sql
CREATE TABLE company_billing_profiles (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL UNIQUE,
  billing_email text NOT NULL,
  billing_name text,                       -- legal entity
  billing_address jsonb NOT NULL,          -- {line1, line2, city, state, postal, country}
  tax_id text,                             -- VAT/GST/EIN
  tax_id_type text,                        -- 'EU_VAT'|'IN_GST'|'US_EIN'|'AU_ABN'
  currency_preference text NOT NULL DEFAULT 'USD',
  stripe_customer_id text,
  razorpay_customer_id text,
  default_payment_method_id text,
  default_payment_provider text,
  is_business boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE saved_payment_methods (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  provider text NOT NULL,                  -- 'stripe'|'razorpay'
  provider_payment_method_id text NOT NULL,
  type text NOT NULL,                      -- 'card'|'ach'|'sepa'|'upi'
  last4 text,
  brand text,
  exp_month int,
  exp_year int,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_method_id)
);
```

**Migration complexity:** M
**Compatibility risk:** None — net-new

### H. `payment_transactions` — **PARTIAL** (exists as `credit_purchases`)

**Current:**

```sql
credit_purchases (
  organization_id, package_id, plan_id, credits, amount_paid, currency,
  status, reference_id UNIQUE, provider, provider_event_id, provider_payment_id,
  fulfillment_status, fulfilled_at, fulfillment_error
)
```

**Missing for enterprise:**
- `payment_method_id` reference
- `fee_amount` + `fee_currency` (provider fees)
- `refunded_amount` + `refund_status`
- `invoice_id` foreign key (when invoicing exists)
- `tax_amount` + `tax_breakdown jsonb`
- `payment_provider` should reference `payment_providers` table (FK)

**Migration complexity:** M

### I. `usage_metering_events` — **EXISTS** but disconnected

**Current:** `usage_events` (from aiGateway) + `usage_meter_monthly` rollup + `credit_usage_log` (per CONFIRM).

**Missing for enterprise:**
- Foreign key from `usage_events` to `credit_transactions` (per Risk G-1)
- Alignment between `usage_meter_monthly` rollup and ledger sum
- Materialized view for ledger-derived monthly rollups (preferred over event-based rollup)

**Migration complexity:** M
**Recommendation:** Replace `usage_meter_monthly` with a materialized view over `credit_transactions` filtered to `execution_phase='confirm'`. Refresh hourly.

### J. `invoice_line_items` — **MISSING**

Covered in [payment-readiness-audit.md §5](./payment-readiness-audit.md#5-invoices). Required schema:

```sql
CREATE TABLE invoices (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  invoice_number text NOT NULL UNIQUE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  currency text NOT NULL,
  subtotal_amount numeric(14,2) NOT NULL,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL,
  status text NOT NULL,                       -- 'draft'|'issued'|'paid'|'past_due'|'voided'
  due_date date,
  issued_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  pdf_url text,
  fx_rate_used jsonb,                         -- snapshot if multi-currency
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoice_line_items (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  description text NOT NULL,
  quantity numeric(20,6) NOT NULL DEFAULT 1,
  unit_price numeric(20,6) NOT NULL,
  currency text NOT NULL,
  subtotal numeric(20,6) NOT NULL,
  tax_amount numeric(20,6) NOT NULL DEFAULT 0,
  tax_rate numeric(10,6),
  tax_jurisdiction text,
  reference_type text,                        -- 'credit_purchase'|'subscription'|'usage_rollup'
  reference_id text,
  metadata jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_inv_org_period ON invoices(organization_id, period_start, period_end);
CREATE INDEX idx_inv_status ON invoices(status, due_date);
CREATE INDEX idx_inv_line_invoice ON invoice_line_items(invoice_id);
```

**Migration complexity:** L (includes PDF generator, email, customer download UI)

---

## 4. Per-Model Audit Summary

| Model | Exists? | Migration complexity | Compatibility risk | Missing fields |
|---|---|---|---|---|
| `credit_accounts` (organization_credits) | YES | S | Low | account_status, parent_account_id, billing_email, time_zone |
| `credit_ledger` (credit_transactions) | YES | M | Low | DB-immutability, fx_*, tax_*, invoice_line_item_id, reversed_by |
| `credit_adjustments` | merged into ledger | S | Low | adjustment_type detail side-table |
| `credit_reservations` | merged into ledger as HOLD rows | S (view) | None | view, expires_at enforcement, lease_id |
| `pricing_catalog` (action_pricing_config) | YES | M | Low | per-plan/per-org overrides, currency variations, effective_to |
| `currency_exchange_rates` | NO | S | None | entire table net-new |
| `company_billing_profiles` | NO | M | None | entire table net-new |
| `payment_transactions` (credit_purchases) | YES | M | Low | payment_method_id, fees, refunded_amount, invoice_id, tax_amount |
| `usage_metering_events` (usage_events) | YES | M | Low | FK to credit_transactions, materialized rollup |
| `invoice_line_items` | NO | L | None | invoices + line_items net-new |

---

## 5. Architecture Diagram (text)

```
                                ┌──────────────────────────────┐
                                │  Customer / UI / API caller  │
                                └──────────────┬───────────────┘
                                               │
                                               ▼
                          ┌────────────────────────────────────────┐
                          │  Application Service (e.g. content gen)│
                          └────────────────────┬───────────────────┘
                                               │
                                ┌──────────────▼──────────────┐
                                │  creditExecutionService     │
                                │  - makeIdempotencyKey()     │
                                │  - executeWithCredits()     │
                                │  - reserveCreditsForWork()  │
                                │  - confirmCreditReservation │
                                │  - releaseCreditReservation │
                                └──────────────┬──────────────┘
                                               │
                                ┌──────────────▼──────────────┐
                                │ creditExecutionRepository   │
                                │ → Postgres RPC              │
                                └──────────────┬──────────────┘
                                               │
        ┌──────────────────────────────────────┼──────────────────────────────────────┐
        │                                      │                                      │
        ▼                                      ▼                                      ▼
┌──────────────────┐         ┌──────────────────────────┐         ┌────────────────────────┐
│apply_credit_     │         │apply_credit_partial_     │         │ Pricing engine          │
│reservation()     │         │confirm() (LLM settle)    │         │ - llm_model_pricing     │
│ FOR UPDATE       │         │                          │         │ - action_pricing_config │
│ - hold/confirm/  │         │                          │         │ - estimateLlmHoldCredits│
│   release/grant/ │         │                          │         │ - resolveLlmCost        │
│   expire         │         │                          │         │                         │
└────────┬─────────┘         └───────────┬──────────────┘         └─────────────────────────┘
         │                               │
         ▼                               ▼
┌────────────────────────────────────────────────────────┐
│  Wallet projection: organization_credits                │
│  Append-only ledger: credit_transactions (idempotent)   │
│  Per-CONFIRM telemetry: credit_usage_log                │
└──────────────────────────────┬──────────────────────────┘
                               │
                               ▼
              ┌──────────────────────────────────────┐
              │  Reconciliation cron (daily)          │
              │  Orphan HOLD reaper (hourly)          │
              │  Expiry cron (daily)                  │
              └──────────────────────────────────────┘

────────────────────  PAYMENT EDGE (TARGET STATE)  ────────────────────

┌────────────────┐          ┌────────────────┐          ┌────────────────┐
│   Stripe       │          │   Razorpay     │          │   ACH / Wire   │
└────────┬───────┘          └────────┬───────┘          └────────┬───────┘
         │                           │                           │
         ▼                           ▼                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│              Provider-agnostic webhook handler                        │
│         (/api/webhooks/[provider].ts → adapter dispatch)              │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
              ┌──────────────────────────┐
              │  payment_provider_events │  (UNIQUE provider+event_id)
              │  credit_purchases        │
              │  payment_transactions    │
              └────────────┬─────────────┘
                           │
                           ▼
                    createCredit(category='paid', ref_type='purchase')

────────────────────  BILLING / INVOICING (TARGET STATE)  ────────────────────

┌──────────────────────────┐
│ subscriptions (renew cron│
│  → grant credits)        │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐         ┌─────────────────────────────┐
│ invoices + line_items    │◄────────│ usage_meter_monthly view    │
│ + tax engine integration │         │ (derived from ledger)        │
└──────────┬───────────────┘         └─────────────────────────────┘
           │
           ▼
   PDF render + email + customer download

────────────────────  GOVERNANCE (TARGET STATE)  ────────────────────

┌──────────────────────────────────────────────────────────────┐
│ credit_action_approvals (N-of-M)                              │
│  ├─ credit_action_approval_signatures                         │
│  └─ credit_action_approval_thresholds                         │
└─────────────────┬────────────────────────────────────────────┘
                  │
                  ▼
         super_admin_audit_logs (immutable trigger)
         credit_admin_grants (immutable trigger)
         credit_transactions (immutable trigger)
```

---

## 6. Required Cron Topology (Target)

| Cron | Cadence | Purpose |
|---|---|---|
| `credit-orphan-hold-reap` | hourly | Release crashed HOLDs (exists) |
| `credit-reconciliation` | hourly for paid-heavy orgs, daily otherwise | Drift detection (exists, raise cadence) |
| `credit-expiry` | daily | Expire free/incentive (exists) |
| `subscription-renewal` | hourly | Renew at `current_period_end`, grant new credits | (new) |
| `invoice-generation` | monthly + on-demand | Generate invoice from usage rollup | (new) |
| `auto-recharge` | hourly | Check balance < threshold, charge saved method | (new) |
| `fx-rate-refresh` | daily | Pull from ECB / OXR | (new) |
| `fulfillment-retry` | hourly | Reprocess `fulfillment_status='event_recorded'` stuck rows | (new) |
| `dunning` | daily | Past-due invoice escalation | (new) |
| `pricing-intelligence` | weekly | `pricingIntelligenceService` margin review (exists) |

---

## 7. Required Service Layer Additions

| Service | Purpose | Complexity |
|---|---|---|
| `stripeService` | Mirror razorpay structure | M |
| `paymentProviderRegistry` | Adapter dispatch | S |
| `invoiceService` | Generation + line-item assembly | L |
| `pdfRendererService` | Invoice PDF | M |
| `taxService` | Integration with Stripe Tax / Avalara | L |
| `subscriptionService` | Period management + renewal | M |
| `enterpriseContractService` | Contract lifecycle | M |
| `dunningService` | Past-due retry + suspend | M |
| `approvalWorkflowService` | N-of-M approvals | M |
| `fxRateService` | Pull + cache + snapshot | S |
| `autoRechargeService` | Threshold trigger | S |
| `reversalService` | Atomic transaction reversal | M |

---

## 8. Required RPC Additions

```sql
-- Atomic transaction reversal (fraud correction)
apply_credit_reversal(
  p_org_id uuid,
  p_original_txn_id uuid,
  p_actor uuid,
  p_reason text,
  p_idem_key text
) RETURNS jsonb;

-- Atomic paid refund (when refund flow added)
apply_credit_refund(
  p_org_id uuid,
  p_original_purchase_id uuid,
  p_actor uuid,
  p_amount_credits int,
  p_provider_refund_id text,
  p_idem_key text,
  p_reason text
) RETURNS jsonb;

-- Atomic subscription credit grant (at period rollover)
apply_subscription_renewal(
  p_org_id uuid,
  p_subscription_id uuid,
  p_period_start date,
  p_period_end date,
  p_credits int,
  p_idem_key text
) RETURNS jsonb;
```

All must:
- Lock wallet `FOR UPDATE`
- Validate idempotency
- Insert ledger row(s) atomically
- Return existing row on `unique_violation`

---

## 9. Required Immutability Triggers

```sql
CREATE OR REPLACE FUNCTION raise_ledger_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger row % is immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER credit_transactions_immutable_update
  BEFORE UPDATE ON credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION raise_ledger_immutable();

CREATE TRIGGER credit_transactions_immutable_delete
  BEFORE DELETE ON credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION raise_ledger_immutable();

-- Same triggers on: super_admin_audit_logs, credit_admin_grants,
-- payment_provider_events, credit_purchases, invoices, invoice_line_items
```

For tables that need operational metadata updates (e.g. `credit_purchases.fulfillment_status`), move mutable fields to a sibling table with a 1:1 FK.

---

## 10. Required Reporting / Export Surface

| Export | Format | Purpose |
|---|---|---|
| Ledger export per org | CSV / JSONL | Customer audit |
| Reconciliation report per period | CSV | Finance close |
| Margin report per org × period | CSV | Pricing strategy |
| Tax report by jurisdiction | CSV | Compliance filing |
| Adjustment log | CSV | Audit committee |
| Approval log | CSV | Audit committee |

All exports should:
- Stream rows (no memory inflation on millions of ledger rows)
- Include checksum (sha256) for download integrity
- Log to `super_admin_audit_logs` action `ADMIN_EXPORT_*`

---

## 11. Operational Observability Targets

| Dashboard | Source | Priority |
|---|---|---|
| Live drift count by org | `creditReconciliation.reconcileAll` (continuous mode) | HIGH |
| Open HOLDs aging | `v_credit_reservations` | HIGH |
| Margin per action × week | `org_weekly_metrics` | HIGH |
| Payment fulfillment success rate | `monetization_operational_events` | HIGH |
| Cost anomalies per day | `cost_anomalies` | MEDIUM |
| Admin grant velocity per actor | `super_admin_audit_logs` | MEDIUM |
| Approval queue depth | `credit_action_approvals.status='pending'` | MEDIUM |
| Invoice past-due aging | `invoices.status='past_due'` | HIGH |
| Refund rate per provider | derived | LOW |

---

## 12. Migration Sequencing Plan (Suggested)

| Sprint | Theme | Migrations |
|---|---|---|
| 1 | Hardening | DB immutability triggers; queue processor HOLD migration |
| 2 | Governance | Approval workflow tables + thresholds |
| 3 | FX | `currency_exchange_rates` + ledger snapshot fields |
| 4 | Billing profile | `company_billing_profiles` + `saved_payment_methods` |
| 5 | Stripe | Adapter + customer linkage |
| 6 | Subscriptions | `subscriptions` + renewal cron |
| 7 | Invoicing | `invoices` + `invoice_line_items` + PDF |
| 8 | Tax | Stripe Tax integration |
| 9 | Enterprise contracts | `enterprise_contracts` + PO flow |
| 10 | Auto-recharge + dunning | Final polish |

---

## 13. What is NOT Required to Reach Enterprise

The audit identifies many gaps, but a number of capabilities are **deferable** until clear customer demand:

- Multi-account hierarchy (parent/child orgs) — defer until first enterprise asks
- Loyalty / referral programs — separate growth concern
- Cryptocurrency / non-fiat payments — clearly out of scope
- Carbon-offset / sustainability accounting — out of scope
- ML-based fraud detection on grants — phase 2

The minimum-viable enterprise architecture closes the gaps in §3 (data models) + §7 (services) + §8 (RPCs) + §9 (immutability). Other items are scaling and convenience.
