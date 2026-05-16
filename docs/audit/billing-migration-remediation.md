# Billing Migration Remediation + Overview Accuracy Fix

**Date:** 2026-05-16
**Trigger:** Grant hangs on "Submitting…" → `Could not find the table 'public.credit_action_approvals' in the schema cache`; Global Financial Overview showed raw org UUIDs and an inflated company count (26).

---

## 1. Root cause — migrations never applied (CRITICAL, operational)

`Could not find the table 'public.credit_action_approvals' in the schema cache` is a PostgREST error meaning **the table does not exist in the database the dev server points at**. The three billing migrations exist as files but were never pushed:

| File | Creates |
|---|---|
| `supabase/migrations/20260663_ledger_immutability_and_governance.sql` | `credit_action_approvals`, `credit_action_approval_signatures`, `job_execution_registry`, `billing_operations`, `admin_financial_audit_events`, `credit_untracked_actions`, immutability triggers, RPCs |
| `supabase/migrations/20260664_phase2_governance_and_payment_foundation.sql` | finance RBAC views, `org_controls` freeze/lock cols, `payment_transactions`, `billing_subscriptions`, `invoices`, `usage_billing_snapshots`, dashboard views |
| `supabase/migrations/20260665_phase3_fx_engine_and_contracts.sql` | `currency_exchange_rates`, `enterprise_contracts`, `enterprise_purchase_orders`, `billing_export_manifests`, timeline view |

The grant flow's first step is `proposeApproval()` → INSERT into `credit_action_approvals`. With the table absent, the insert fails; the "Submitting…" spinner is the failing PostgREST round-trip before the 400 surfaces. **This is not a code bug — it is unapplied schema.** No code change can create the table; the migrations must run.

### Remediation (operator action — pick one)

**Option A — Supabase CLI (canonical):**
```bash
# from c:\virality, with the dev project linked
npm run db:push
# (wraps `supabase db push` with the prod-ref guard; applies all pending
#  migrations in supabase/migrations/ in filename order)
```

**Option B — direct SQL (if CLI/link unavailable):**
Open the dev project's Supabase SQL editor and run, **in this exact order**:
1. paste + run `supabase/migrations/20260663_ledger_immutability_and_governance.sql`
2. paste + run `supabase/migrations/20260664_phase2_governance_and_payment_foundation.sql`
3. paste + run `supabase/migrations/20260665_phase3_fx_engine_and_contracts.sql`

All three are idempotent (`CREATE TABLE IF NOT EXISTS`, `DROP TRIGGER IF EXISTS … CREATE TRIGGER`, `CREATE OR REPLACE FUNCTION`) — safe to re-run.

### Verify
```sql
SELECT to_regclass('public.credit_action_approvals') IS NOT NULL AS approvals_ok,
       to_regclass('public.billing_operations')      IS NOT NULL AS billing_ops_ok,
       to_regclass('public.job_execution_registry')  IS NOT NULL AS registry_ok;
```
All three `true` → reload PostgREST schema cache (Supabase: Settings → API → "Reload schema", or it auto-refreshes within ~60s) → retry the 5,000-credit grant. It will either succeed (auto-approve below threshold) or return **202 pending_approval** (5K is on the 2-sig threshold) — not hang.

> Until the migrations are applied, every billing-console surface that reads `credit_action_approvals` / `billing_operations` (approval queue, idempotency console, financial timeline) will be empty or error. This is expected and resolves entirely once the schema exists.

---

## 2. Company names + inflated count (code fix — shipped)

**Defect:** `/api/super-admin/financial-overview` returned only `organizationId` (UI rendered `7a606a40…`) and counted **every** `organization_credits` row — including orphaned / test / soft-deleted orgs — producing the wrong "26".

**Fix** ([pages/api/super-admin/financial-overview.ts](../../pages/api/super-admin/financial-overview.ts)):
- Loads the authoritative active-company set: `companies` where `deleted_at IS NULL`.
- Builds an `id → name` map (precedence: `companies.name` → `company_profiles.name` → `company_profiles.website_url` → `'Unnamed company'` — same precedence the existing `/api/super-admin/companies` endpoint uses).
- **Excludes** wallet rows whose org is not a real active company (kills the inflation).
- Adds `companyName` to every row.
- Recomputes `aggregate.totalOrgs`, `totalAvailableCredits/Usd`, `totalReservedCredits`, `topByConsumption` **from the filtered active set** (removed the inaccurate `getPortfolioWalletAggregate` count), and adds `aggregate.totalActiveCompanies` for context.

**UI** ([components/super-admin/tabs/CreditsBillingTab.tsx](../../components/super-admin/tabs/CreditsBillingTab.tsx)): the Org column now shows the company name with the short UUID beneath it; the "Companies" metric shows the wallet-backed count with an "N active total" hint.

**Tests** ([backend/tests/unit/superAdminFinancialOverview.test.ts](../../backend/tests/unit/superAdminFinancialOverview.test.ts)): added cases proving an orphan wallet row (`org-3-orphan`) is excluded (count = 2, not 3), names resolve via `companies.name` then `company_profiles.name`, and aggregate totals sum the active set only (300, not 1299). Full suite: **17 passed** (5 overview + 8 company-isolation + 4 alert-counts).

---

## 3. Summary

| Issue | Type | Status |
|---|---|---|
| Grant hang + schema-cache error | Operational — unapplied migrations | **Action required: run `npm run db:push`** (or Option B). No code fix possible/needed. |
| Org UUIDs instead of names | Code defect | Fixed + tested |
| Inflated company count (26) | Code defect | Fixed + tested |

No billing-architecture changes. Org isolation, immutability, and replay-protection invariants untouched.
