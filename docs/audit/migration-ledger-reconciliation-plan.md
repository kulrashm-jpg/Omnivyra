# Migration Ledger Reconciliation Plan (Guided)

**Date:** 2026-05-16 · **Target:** production `klkiseupptzbecbxwrky`
**Status:** operator-owned · **Nothing in this plan has been executed.**

You chose "ledger repair + full push (guided)". Building it surfaced a
**structural blocker** that makes a `supabase migration repair` + `db
push` reconciliation **unsafe on this repo as-is**. This document gives
you (1) the blocker, (2) the full classification, (3) the recommended
**minimal, safe** alternative that achieves the actual goal (billing
works in prod), (4) the backup checklist.

---

## 1. Structural blocker — duplicate migration versions

`supabase db push` / `supabase migration repair` key on the migration
**version** (the numeric filename prefix) and assume **one file per
version**. This repo does not conform:

- **42 version prefixes are duplicated.** Examples: `20260322` → **12**
  files, `20260320` → **9**, `20260323` → **10**, `20260329` → **6**.
- Two *different* files share version `20260658`
  (`20260658_creator_enterprise_reliability.sql` and
  `20260658_reconcile_platform_gsc_migration_history.sql`).

Consequences:

- `migration repair --status applied 20260322` marks the **version**
  applied — the CLI cannot distinguish the 12 files under it.
- `db push` tracks one entry per version; multi-file versions are
  applied/skipped non-deterministically → **partial, silent schema
  application on production**.

**Therefore a CLI ledger-repair + full push cannot be made safe here
without first restructuring the migration directory to one-file-per-
unique-version** — a large, separate, risk-bearing refactor that must
not be done as a side effect of activating billing.

## 2. Full classification (read-only, corrected prober)

Production ledger records **4** of 145 migration files. Reality
(`reconcile-migration-ledger.ts`, read-only):

| Class | Count | Meaning |
|---|---|---|
| APPLIED | 72 | every created object already exists → would be `repair`ed |
| ABSENT | 62 | no created object exists → would be pushed |
| PARTIAL | 8 | some objects exist, some don't → **manual, per-file** |
| NO_DDL | 73 | no detectable `CREATE` (ALTER/INSERT/DO-block) → **unknowable from objects** |

The ABSENT set is **not billing** — it is most of the application
(listening, intelligence, analytics, marketplace, monetization, creator,
SERP, *and* billing). Production is missing a large fraction of the
entire app schema, not a billing slice. A "full push" is effectively a
**production schema rebuild**, far beyond the stated billing objective,
and is gated behind the §1 blocker.

PARTIAL migrations (need per-file human judgement, not blanket repair):
`20260320_autonomous_system`, `20260325_activity_cost_tracking`,
`20260329_missing_tables`, `20260505_report_automation_notifications`,
`20260519_phase5_multiconnector_graph_alerts`,
`20260524_community_ai_execution_centralization`,
**`20260625_monetization_invariant_hardening`**, `20260639`.

## 3. Recommended path — minimal idempotent billing bundle (SAFE)

Achieves the user's actual goal ("billing works, no schema-cache error")
**without** touching the 130+ unrelated migrations, the duplicate-version
minefield, or the CLI ledger. Apply **direct idempotent SQL** in the
Supabase SQL editor (the migrations were authored idempotent:
`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`,
`DROP TRIGGER IF EXISTS … CREATE`).

### 3.1 Genuine prerequisites for the billing trio

`20260663` references these non-billing objects it does **not** create:

| Object | In prod? | Source |
|---|---|---|
| `credit_transactions` | ✅ present | (pre-existing) |
| `credit_admin_grants` | ✅ present | (pre-existing) |
| `super_admin_audit_logs` | ✅ present | (pre-existing) |
| `payment_provider_events` (table) | ❌ **missing** | `20260625` (PARTIAL) |
| `record_payment_provider_event` (fn) | ❌ **missing** | `20260625` |
| `action_pricing_config` | ⚠ verify | referenced by `v_pricing_catalog` |
| `omnivyra_touch_updated_at` | ⚠ verify | shared touch-trigger helper |

> Operator must confirm `action_pricing_config` and
> `omnivyra_touch_updated_at` exist in prod
> (`SELECT to_regclass('public.action_pricing_config');` and the
> `pg_proc` check). If absent, include their defining DDL ahead of the
> billing files. The two confirmed-missing prerequisites
> (`payment_provider_events`, `record_payment_provider_event`) are both
> idempotent in `20260625` (lines 39 `CREATE TABLE IF NOT EXISTS`,
> 58 `CREATE OR REPLACE FUNCTION`) — they can be extracted and run
> standalone, or run the whole `20260625` file (it is idempotent
> throughout).

### 3.2 Ordered apply (in a maintenance window, on a backed-up DB)

```
1. supabase/migrations/20260625_monetization_invariant_hardening.sql   (idempotent; supplies payment_provider_events + record_payment_provider_event)
2. supabase/migrations/20260663_ledger_immutability_and_governance.sql  (vetted idempotent)
3. supabase/migrations/20260664_phase2_governance_and_payment_foundation.sql
4. supabase/migrations/20260665_phase3_fx_engine_and_contracts.sql
5. NOTIFY pgrst, 'reload schema';
```

Each file is idempotent and non-destructive (the safe runner's
destructive-DDL scan already cleared 20260663/64/65; `20260625` uses
`IF NOT EXISTS`/`OR REPLACE`). Re-running is a no-op. Note `20260663`
line 193 `INSERT INTO public.credit_action_approval_thresholds …` — a
**fresh** apply is correct; if you ever re-run, confirm that INSERT is
`ON CONFLICT DO NOTHING` or truncate-safe (review before a second run).

### 3.3 Do NOT use `db push` for this

`db push` would attempt all 141 "pending" versions and hit the §1
duplicate-version corruption. The SQL-editor route bypasses the broken
ledger entirely and changes nothing outside billing + its prerequisite.

### 3.4 Ledger note

After a successful SQL-editor apply, optionally record the four versions
so future tooling sees them — **only if** you accept the version
collisions: `INSERT INTO supabase_migrations.schema_migrations(version)
VALUES ('20260625'),('20260663'),('20260664'),('20260665') ON CONFLICT
DO NOTHING;`. This is cosmetic for these specific versions; it does not
fix the repo-wide §1 problem.

## 4. Verification (after apply)

```bash
npx tsx scripts/audit/verify-billing-schema.ts        # corrected prober → expect overall: ok, 26 present
```
`GET /api/admin/billing/health` (FINANCE_AUDITOR) → `overall: ok`, all
readiness `true`. Then Phase D billing-flow tests
(grant/revoke/approval/freeze/ledger/portal/export/idempotency/anomaly/
reconciliation).

## 5. Pre-execution backup checklist (mandatory, operator)

- [ ] Supabase Dashboard → Database → **PITR / on-demand backup taken**;
      note the restore point timestamp.
- [ ] `pg_dump` of at least: `credit_transactions`, `credit_admin_grants`,
      `super_admin_audit_logs`, `payment_provider_events` (if any),
      `supabase_migrations.schema_migrations`.
- [ ] Confirm maintenance window / low-traffic period.
- [ ] Confirm `action_pricing_config` + `omnivyra_touch_updated_at`
      presence (§3.1); stage their DDL if missing.
- [ ] Dry-read: run §4 verify BEFORE apply to capture the baseline.
- [ ] Apply §3.2 steps 1–4 **one file at a time**, checking for errors
      between each (stop on first error — later files depend on earlier).
- [ ] Step 5 `NOTIFY pgrst, 'reload schema';`.
- [ ] Re-run §4 verify → confirm `overall: ok`.
- [ ] Rollback path: if a step errors, it is within one file; restore
      from the PITR point if any partial state is unacceptable. The
      billing files are transactional-safe when run as a single batch
      per file in the SQL editor.

## 6. Why not the full reconciliation you selected

The full repair+push is (a) blocked by §1 duplicate versions (CLI
unsafe), (b) ~10× the scope (whole-app schema rebuild, not billing),
(c) includes 8 PARTIAL + 73 NO_DDL migrations that cannot be
classified by object inspection and need per-file human review. Doing it
safely is a separate migration-history-remediation project. The §3
minimal bundle delivers the billing objective now with a contained,
reversible, idempotent change.
