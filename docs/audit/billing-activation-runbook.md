# Billing Activation Runbook (Minimal Bundle)

**Artifact:** [`billing-activation-bundle.sql`](./billing-activation-bundle.sql)
(1467 lines, generated 2026-05-16) · **Target:** production
`klkiseupptzbecbxwrky` · **Executor:** operator (not automated)

This is the contained, idempotent path that makes billing operational
**without** the unsafe full ledger push. Rationale, classification and
why the full push is blocked: see
[`migration-ledger-reconciliation-plan.md`](./migration-ledger-reconciliation-plan.md).

## What the bundle contains

| Section | Content | Source |
|---|---|---|
| 1 | `payment_provider_events` table + index + `record_payment_provider_event` fn | verbatim from `20260625` lines 39‑56, 58‑100 (the only 2 objects `20260663` needs that are absent) |
| 2 | full ledger immutability + governance | `20260663` verbatim |
| 3 | full governance + payment foundation | `20260664` verbatim |
| 4 | full FX engine + contracts | `20260665` verbatim |
| 5 | `NOTIFY pgrst, 'reload schema';` | cache reload |

**Provably self-contained:** all **11** external objects the bundle
references but does not create were verified PRESENT in production
(`action_pricing_config`, `credit_admin_grants`, `credit_cost_config`,
`credit_purchases`, `credit_transactions`, `omnivyra_touch_updated_at`,
`org_controls`, `pricing_plans`, `super_admin_audit_logs`,
`usage_events`, `user_company_roles`). No hidden prerequisite.

**Safety:** idempotent throughout (`IF NOT EXISTS` / `OR REPLACE` /
`DROP TRIGGER IF EXISTS … CREATE`); destructive-DDL scanned clean
(no DROP TABLE / TRUNCATE / DELETE / DROP COLUMN / DROP SCHEMA);
re-running any section is a safe no-op. Only the rest of `20260625`
(already present in prod) is deliberately NOT re-run, avoiding any
non-idempotent statement against existing objects.

## Pre-flight (mandatory)

- [ ] **Backup taken**: Supabase Dashboard → Database → PITR / on-demand
      backup. Record the restore-point timestamp here: `__________`.
- [ ] `pg_dump` of `supabase_migrations.schema_migrations`,
      `credit_transactions`, `credit_admin_grants`,
      `super_admin_audit_logs`.
- [ ] Maintenance / low-traffic window confirmed.
- [ ] Baseline capture (expect failure — proves the gap):
      `npx tsx scripts/audit/verify-billing-schema.ts`
      → `overall: critical_missing, present: 0`.

## Dry-run certification

The full bundle + prelude was executed against production inside a
transaction and **rolled back** (`scripts/audit/dryrun-billing-bundle.ts`)
→ **applies end-to-end with zero errors**. Two real defects were found
and fixed during this:

1. `action_pricing_config` lacked `updated_at` (needed by
   `v_pricing_catalog`) → additive fix in the prelude.
2. Bug in `20260665` FX identity-seed (`AS t` → `AS b(t)`) — fixed at
   source in the migration file; the bundle is regenerated from it.

Re-verify any time before applying: `npx tsx
scripts/audit/dryrun-billing-bundle.ts` → expect `✅ DRY-RUN CLEAN`.

## Apply (Supabase SQL editor — in order)

> **Step 0 first**, then SECTION 1 → check → 2 → check → 3 → check → 4 →
> check → 5. **Stop on the first error** (later sections depend on
> earlier ones). Each section is internally idempotent; a clean re-run
> of a section is safe. If a partial state is unacceptable on error,
> restore from the pre-flight backup.

0. [ ] **PRELUDE** — run `docs/audit/billing-schema-alignment-prelude.sql`
       (additive `ADD COLUMN IF NOT EXISTS`; aligns pre-existing tables)
1. [ ] SECTION 1 applied, no error
2. [ ] SECTION 2 applied, no error
3. [ ] SECTION 3 applied, no error
4. [ ] SECTION 4 applied, no error
5. [ ] SECTION 5 (`NOTIFY pgrst, 'reload schema'`) applied

## Verify (post-apply)

- [ ] `npx tsx scripts/audit/verify-billing-schema.ts`
      → **`overall: ok`**, `present: 26`, `missing: 0`.
- [ ] `GET /api/admin/billing/health` (authenticated FINANCE_AUDITOR)
      → HTTP 200, `status.overall: "ok"`, every `readiness.*.ready:
      true`, all `migrations[].state: "applied"`.
- [ ] Phantom-cache guard: `SELECT to_regclass('public.credit_action_approvals');`
      returns non-NULL (proves it's a real relation, not a stale cache
      entry — see postgrest-schema-remediation.md §7).
- [ ] Retry the original user action (credit grant) — completes with no
      "Submitting…" hang and no `PGRST205` error.

## Billing-flow activation tests (Phase D — after verify is green)

Run against the app with the schema live:

1. grant credits → immutable ledger row created, balance updated
2. revoke credits → ledger row, audit event
3. approval flow → `credit_action_approvals` + signature stored
4. freeze / unfreeze (`org_controls`)
5. ledger visibility (super-admin console)
6. company billing portal (org-isolated)
7. export generation (manifest SHA-256)
8. idempotency recovery (stuck-state console)
9. anomaly panel
10. reconciliation check (`v_reservation_health`,
    `v_billing_operations_health`)

Expected: immutable ledger entries, approvals stored, balances updated,
exports generated, audit events emitted, **no hanging requests, no
PGRST205, no missing-table errors**.

## On success

Re-issue [`billing-production-schema-activation.md`](./billing-production-schema-activation.md)
→ expected verdict **READY FOR FULL GA** (billing scope). The
repo-wide migration-ledger desync (§ reconciliation plan) remains a
separate, tracked remediation and does not block billing once this
bundle is applied and verified.
