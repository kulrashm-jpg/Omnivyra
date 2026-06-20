# OMNIVYRA — COMMERCIAL SCHEMA DRIFT AUDIT & ACTIVATION (audit only)

Real sandbox execution exposed prod schema drift on `credit_purchases`. This audit maps every commercial migration, the prod-vs-code delta, the dependency order, and the **minimum, lowest-risk** activation set. **Nothing applied; no prod writes.**

## SECTION A — COMMERCIAL MIGRATION INVENTORY
| # | Name | Tables | Adds (columns / objects) | Applied? |
|---|---|---|---|---|
| 20260322 | monetization_foundation | credit_packages, credit_purchases (base), organization_credits, credit_transactions | base columns; `apply_credit_reservation` v1 | ✅ (tables/base present) |
| **20260625** | **monetization_invariant_hardening** | credit_transactions, **credit_purchases**, payment_provider_events | `credit_tx.metadata`; reference_id→text; **cp: provider, provider_event_id, provider_payment_id, fulfilled_at, fulfillment_error, updated_at** (+ fulfillment_status); UNIQUE(provider,provider_event_id); CREATE TABLE payment_provider_events; **replaces** `apply_credit_reservation`/`apply_credit_partial_confirm`/`record_payment_provider_event`; DROP `expire_org_free_credits` | ❌ **column-adds NOT applied** |
| **20260626** | **razorpay_staging_foundation** | **credit_purchases**, payment_provider_events | **cp: provider_order_id, provider_mode, amount_subunits, provider_payload**; ppe: provider_mode, signature_valid, signature_algorithm, provider_order_id, provider_payment_id; 3 indexes | ❌ **NOT applied** |
| 20260629 | invited_beta_monetization_rollout | credit_purchases, … | `beta_cohort` (+ fulfillment_status path) | ✅ (`beta_cohort`, `fulfillment_status` present) |
| 20260664 | phase2_governance_and_payment_foundation | payment_transactions, … | payment tables | ✅ (`payment_transactions` exists) |
| 20260714/20260716 | payment_provider_config[_cashfree_phonepe] | provider config | provider config | ✅ |
| 20260718 | hidden_billing_audit_and_checkout_sessions | billing_checkout_sessions, invoices, invoice_line_items | checkout sessions + invoice tables | ✅ (tables exist) |
| 20260720 | founding_member_program | organization_plan_assignments | founding cols | (n/a to top-up) |
| 20260721 | seed_topup_credit_packages | credit_packages | seed | superseded by 20260723 |
| 20260723 | pricing_config_and_canonical_packages | credit_packages, billing_fx_rates, billing_plan_pricing | sku, canonical_usd_price; FX/plan tables + seeds | ✅ **applied** |

> Note: two files share the `20260625` prefix (known repo collision) — the commercial one is **`20260625_monetization_invariant_hardening.sql`**.

## SECTION B — PROD SCHEMA vs CODE CONTRACT (probed live)
| Table | Exists | Missing columns (code writes them) | PASS/FAIL |
|---|---|---|---|
| **credit_purchases** | ✅ (0 rows) | **provider, provider_mode, provider_order_id, provider_payment_id, provider_payload, amount_subunits, fulfilled_at, fulfillment_error, updated_at** (have: id, org, package_id, plan_id, credits, amount_paid, currency, status, reference_id, created_at, fulfillment_status, beta_cohort) | ❌ **FAIL** |
| payment_provider_events | ✅ (0 rows) | likely 20260626 cols (provider_mode, signature_valid, signature_algorithm, provider_order_id, provider_payment_id) — **non-blocking** (recorder writes only base cols) | ⚠ partial |
| payment_transactions | ✅ (0) | none used by top-up flow | ✅ |
| billing_checkout_sessions | ✅ (0) | none used by top-up flow | ✅ |
| invoices | ✅ (0) | none (writes number/period/amounts/status/metadata/pdf_url — all present) | ✅ |
| invoice_line_items | ✅ (0) | none | ✅ |
| credit_packages | ✅ (3) | none (sku + canonical_usd_price present) | ✅ |
| billing_fx_rates / billing_plan_pricing | ✅ (3/3) | none | ✅ |

**The single blocking drift is `credit_purchases` (9 columns).** Everything `checkout/create-order`, `verify`, `completePurchase`, invoice generation, and billing center write resolves once those 9 exist. (`fulfillment_status` already present, so completePurchase's status writes already work; it's the provider/* + fulfilled_at/fulfillment_error/updated_at writes that fail.)

## SECTION C — MIGRATION DEPENDENCY ANALYSIS
- **20260626 alone is NOT sufficient.** It supplies 4 of 9 columns (provider_order_id, provider_mode, amount_subunits, provider_payload). The other 5 (provider, provider_event_id, provider_payment_id, fulfilled_at, fulfillment_error, updated_at) come from **20260625**.
- **Dependency:** 20260626's `UNIQUE(provider, provider_order_id)` index references `provider` (added by **20260625**) → **20260625 MUST precede 20260626**.
- **20260718 / later** are already applied (their tables exist); no additional commercial migration is missing.
- **Exact order:** `20260625` (column subset) → `20260626` (full).

## SECTION D — SAFE ACTIVATION PLAN (minimum set — NOT applied)
The minimum to make create-order / verify / allocation / invoice / billing-center operational is the **`credit_purchases` (+ `payment_provider_events`) column additions** from 20260625 + 20260626 — **not** 20260625's RPC/type/drop statements (which are unrelated to the column drift and riskier under the ledger desync).

```sql
-- ── Step 1: credit_purchases columns from 20260625 (column subset only) ──
ALTER TABLE credit_purchases
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_event_id text,
  ADD COLUMN IF NOT EXISTS provider_payment_id text,
  ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz,
  ADD COLUMN IF NOT EXISTS fulfillment_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_purchases_provider_event_unique
  ON credit_purchases(provider, provider_event_id)
  WHERE provider IS NOT NULL AND provider_event_id IS NOT NULL;

-- ── Step 2: all of 20260626 (already fully idempotent) ──
ALTER TABLE credit_purchases
  ADD COLUMN IF NOT EXISTS provider_order_id text,
  ADD COLUMN IF NOT EXISTS provider_mode text NOT NULL DEFAULT 'manual'
    CHECK (provider_mode IN ('manual','test','live')),
  ADD COLUMN IF NOT EXISTS amount_subunits integer,
  ADD COLUMN IF NOT EXISTS provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_purchases_provider_order_unique
  ON credit_purchases(provider, provider_order_id)
  WHERE provider IS NOT NULL AND provider_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credit_purchases_provider_mode_status
  ON credit_purchases(provider, provider_mode, status, fulfillment_status);
ALTER TABLE payment_provider_events
  ADD COLUMN IF NOT EXISTS provider_mode text NOT NULL DEFAULT 'test'
    CHECK (provider_mode IN ('test','live')),
  ADD COLUMN IF NOT EXISTS signature_valid boolean,
  ADD COLUMN IF NOT EXISTS signature_algorithm text,
  ADD COLUMN IF NOT EXISTS provider_order_id text,
  ADD COLUMN IF NOT EXISTS provider_payment_id text;
CREATE INDEX IF NOT EXISTS idx_payment_provider_events_order
  ON payment_provider_events(provider, provider_order_id, received_at DESC)
  WHERE provider_order_id IS NOT NULL;
```
All statements are `IF NOT EXISTS` → idempotent, additive, no data loss, no RPC/type change. (`fulfillment_status` is intentionally omitted from Step 1 — it already exists.)

## SECTION E — POST-ACTIVATION VALIDATION (criteria)
After applying, re-run the read-only probes:
1. `credit_purchases` → all 9 columns present (`provider … updated_at`). **PASS** when 0 missing.
2. `payment_provider_events` → 20260626 columns present.
3. Indexes present: `idx_credit_purchases_provider_event_unique`, `…_provider_order_unique`, `…_provider_mode_status`, `idx_payment_provider_events_order`.
4. Re-run `COMMERCIAL_SANDBOX_VALIDATION` against `0eda0896…` → purchase inserts; 250/500/1000 → +paid, 1 grant, 1 invoice; idempotent; reconciliation `found=0`. **PASS** = full green.

## SECTION F — DELIVERABLE
- **Missing migrations:** `20260625_monetization_invariant_hardening` (credit_purchases column subset) + `20260626_razorpay_staging_foundation` (full).
- **Required order:** `20260625` → `20260626` (provider before the provider_order index).
- **Risk assessment:**
  - Surgical column-only SQL (Section D): **LOW** — additive `IF NOT EXISTS`, no RPC/type/drop, safe on 0 rows.
  - Full `20260626`: **LOW** (pure idempotent columns/indexes).
  - Full `20260625`: **MEDIUM** — also replaces `apply_credit_reservation`/`apply_credit_partial_confirm`/`record_payment_provider_event` + retypes `reference_id` + DROPs a function; under the **ledger desync** this could regress a live RPC. **Avoid for activation;** the column subset is sufficient for top-ups.
  - **Do NOT `supabase db push`** — the ledger is desynced (≈4 of 145 recorded); a push would attempt ~140 unrelated migrations. Apply the Section-D SQL surgically.
- **Exact activation command(s):** run the Section-D SQL block in the **Supabase SQL editor** (or as a single targeted migration executed via the controlled process) against production. One transaction, idempotent.

## FINAL VERDICT: **READY TO APPLY COMMERCIAL MIGRATIONS — YES**

The missing set is identified, bounded, idempotent, and low-risk. Apply in this sequence:
1. **Section-D SQL block** (credit_purchases + payment_provider_events column-adds, order 20260625-cols → 20260626) via the Supabase SQL editor / controlled migration — **not** `db push`.
2. Re-run the Section-E probes → confirm 0 missing columns + indexes present.
3. Re-run `scripts`/the sandbox validation against `0eda0896…` → expect full green (+250/+500/+1000, 1 purchase/grant/invoice each, idempotent).
4. (Optional, separate decision) apply full `20260625` for the ledger-hardening RPCs only after verifying the current prod `apply_credit_reservation` — **not required** for top-up sales.

> No blockers to the activation itself; the only caution is to apply the **column subset**, not full `20260625`, and to **never bulk-push** under the desynced ledger.

*(Audit only. No migration applied, no prod writes. Findings probed live read-only + verified against migration source. Activation SQL is idempotent/additive.)*

---
**STOP — report only. No features implemented.**
