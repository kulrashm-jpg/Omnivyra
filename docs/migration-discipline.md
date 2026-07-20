# Supabase Migration Discipline

This document describes how migrations are applied against the production
Supabase project this codebase deploys against, why the obvious tool
(`supabase db push`) is currently **unsafe**, and what to do instead.

> **Operator-facing.** If you are about to apply a migration, read this
> first. The 30 seconds you spend here can prevent a multi-hour
> reconciliation later.

---

## TL;DR

1. **Do NOT** run `supabase db push` (or any aggregate "apply all pending migrations" command) against production.
2. Apply each migration by hand in the Supabase SQL editor.
3. After applying, run `node scripts/verify-schema-parity.js` to confirm the columns landed.
4. All stabilization migrations are designed to be idempotent (`IF NOT EXISTS` everywhere) so re-applying a partially-applied migration is safe.

---

## Why `db push` is currently unsafe

The project carries a **migration ledger desync**: of 145 migration files
in `supabase/migrations/`, the production database has only ~4 recorded
as applied. The remaining migrations split roughly into:

- ~72 migrations whose DDL is already present in the live schema (applied
  manually or via earlier tooling, but never recorded in
  `supabase_migrations.schema_migrations`).
- ~62 migrations whose DDL is genuinely absent.
- ~8 partial states (some statements landed, others didn't).
- ~42 duplicate version prefixes (multiple files share the same
  `YYYYMMDD` stamp — e.g. `20260322_*.sql` has 12 files).

When `supabase db push` reconciles against the ledger, it tries to apply
every "absent" migration in version order. Two failure modes:

1. **Duplicate-version corruption.** Supabase CLI orders by the numeric
   version, not the filename. For a version that has 12 files, only one
   is "the" migration as far as the ledger is concerned; the others are
   silently skipped on apply but the ledger still records the version as
   complete. Net effect: 11 migrations marked done without running, with
   no diagnostic that they didn't.
2. **Already-present DDL collisions.** Migrations that lack
   `IF NOT EXISTS` will throw `relation already exists` mid-batch,
   leaving the ledger half-updated. Subsequent re-runs can't resolve
   without manual intervention.

See `docs/audit/migration-ledger-reconciliation-plan.md` for the full
reconciliation strategy (separate project).

---

## How to apply a single migration safely

1. Find the migration file in `supabase/migrations/`.
2. Open the Supabase Studio SQL editor for the production project (the
   one your `.env.local` `SUPABASE_URL` points at).
3. Paste the file's contents into a new query and run it.
4. Verify with `scripts/verify-schema-parity.js` (see below).
5. Optionally update the local ledger so subsequent reconciliation tools
   see the migration as applied:
   ```sql
   INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
   VALUES ('YYYYMMDD', 'descriptive_name', ARRAY['<sql here>'])
   ON CONFLICT (version) DO NOTHING;
   ```

All stabilization migrations authored after `20260725` use
`ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` so they're
safe to re-apply.

---

## Schema parity verifier

`scripts/verify-schema-parity.js` checks that every column the runtime
code writes to actually exists in the production DB. The column manifest
inside the script is the source of truth for "what columns are
load-bearing for the running code".

```bash
node scripts/verify-schema-parity.js
```

Exit codes:

- `0` — all required columns present.
- `1` — at least one column missing. Structured JSON on stdout, human-readable summary on stderr.
- `2` — environmental failure (missing creds, network error). Doesn't fail-loud about schema state.

The verifier runs as a soft-gate in `scripts/predeploy-check.js` by
default. To make it a **hard-gate** (block deploy on any missing
column), set `PREDEPLOY_STRICT_SCHEMA=1` in the predeploy shell.

---

## Stabilization migration provenance

The following migrations were authored during the BOLT-planner +
forensic-integrity stabilization arc. Each was applied manually via the
Supabase SQL editor.

| Version | File | What it adds | Why |
|---|---|---|---|
| 20260725 | `bolt_execution_resilience_columns.sql` | `bolt_execution_runs.lock_owner / lock_acquired_at / lock_expires_at / cancel_requested* / heartbeat_at` + `scheduled_posts.idempotency_key` | Revived from `database/_archive/skipped-migrations/20260515b_bolt_execution_resilience.sql` (archived for ledger management, not content). Required by `boltPipelineService.updateRun` and `boltExecutionLock.{acquire,extend,release}`. Without it, every heartbeat write throws silently and the abandonment sweeper fires prematurely. |
| 20260726 | `queue_jobs_result_and_error_code.sql` | `queue_jobs.result_data / error_code` | Both columns were defined only in legacy `database/step4-media-queue-tables.sql`, never as a migration. `backend/db/queries.ts:updateQueueJobStatus` writes both; missing columns silently lose terminal state. |
| 20260727 | `bolt_execution_abandonment_forensics.sql` | `bolt_execution_runs.abandonment_reason / abandonment_detected_at` | **Forensic integrity contract.** Sweepers (inline + operator) now write abandonment metadata into these columns instead of clobbering `error_message` / `raw_error_message`. Original failure cause from `persistPipelineFailure` is preserved, abandonment is layered on top, both flavours coexist on the same row. |

---

## Future migration authoring checklist

> **ENFORCED (ENG-IMPL-002).** Rules 1–2 are checked automatically by
> `npm run check:migrations` (`scripts/check-migration-quality.js`), wired into the
> `TypeScript Baseline` CI job. The check runs ONLY on migrations authored after the
> gate landed — the pre-existing files are frozen in
> `scripts/migrations/historical-baseline.txt` and never fail. Deterministic,
> read-only, no DB/network; identical locally and in CI.

When adding a new migration to `supabase/migrations/`:

1. **Use idempotent DDL (enforced).** `CREATE TABLE IF NOT EXISTS`,
   `CREATE INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`. Never bare
   `CREATE TABLE` / `CREATE INDEX` / `ADD COLUMN`. (`DROP … IF EXISTS`,
   `CREATE OR REPLACE FUNCTION`, and `DROP POLICY IF EXISTS` + `CREATE POLICY`
   are the guarded patterns for the statements that lack `IF NOT EXISTS`.)
2. **Use a unique full-timestamp filename (enforced).**
   `YYYYMMDDHHMMSS_<lower_snake_slug>.sql` — a **14-digit** timestamp, not the legacy
   `YYYYMMDD` date-only prefix (which caused the historical collisions). The prefix
   must not collide with any existing migration's version.
3. **Comment provenance.** Top-of-file block: what it adds, why (which code path
   writes/reads it), what fails if absent, and whether it supersedes an archived migration.
4. **Update `scripts/verify-schema-parity.js`.** If the new columns are load-bearing,
   add them to `REQUIRED_COLUMNS` with a severity + motivation (`BLOCKING` only if the
   write is NOT fail-open).
5. **Apply via SQL editor, not `db push`.** Until the ledger is reconciled, manual
   application is the only safe path.

**Compliant example:**
```
supabase/migrations/20260720141530_add_widget_owner.sql
```
```sql
-- Adds widget.owner_id (widgetService.assignOwner writes it).
CREATE TABLE IF NOT EXISTS public.widget (id uuid PRIMARY KEY);
ALTER TABLE public.widget ADD COLUMN IF NOT EXISTS owner_id uuid;
CREATE INDEX IF NOT EXISTS widget_owner_ix ON public.widget (owner_id);
```

**Rejected (why):** `20260720_add_widget.sql` — legacy date-only prefix ·
`20260905000000_x.sql` — collides with an existing version · a bare
`ALTER TABLE … ADD COLUMN owner_id` — missing `IF NOT EXISTS`.

---

## When `db push` becomes safe again

Two conditions must be true:

1. The ledger desync is fully reconciled (`docs/audit/migration-ledger-reconciliation-plan.md` finished).
2. No duplicate-version prefixes remain in `supabase/migrations/`.

Neither condition holds today. Re-evaluate this document when both are
satisfied.
