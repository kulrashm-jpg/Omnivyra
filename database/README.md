# database/ — DEPRECATED

> **DO NOT add new SQL here. The canonical schema source-of-truth is [supabase/migrations/](../supabase/migrations/).**
>
> CI guard `scripts/check-no-database-folder.js` will fail any PR that adds a `*.sql` file directly under `database/`.

## What lives here now

```
database/
├── README.md                              ← this file
└── _archive/
    ├── legacy_database/                   317 historical *.sql + a few *.md
    └── dangerous/                           7 destructive scripts (DO NOT EXECUTE)
```

## How we got here

Until 2026-05-04 this folder held ~314 SQL files used as a parallel "schema source" applied via direct `psql`/`SQL Editor` execution. That parallel source caused production drift, broken replays, and runtime fallbacks like `console.warn("Run database/X.sql")` baked into backend services.

Phase A–C of the Database & Migration Governance work replaced that pattern:

| Phase | Outcome |
|---|---|
| A | Audited 167 references and identified 13 runtime-fallback sites pointing at `database/*.sql`. Reports → `supabase/_snapshot/database_audit_diff_2026-05-03.md`, `supabase/_snapshot/database_runtime_dependency_report_2026-05-03.md`. |
| B0 | Reconstructed 29 missing canonical migrations from `supabase_migrations.schema_migrations.statements`. |
| B1 | Quarantined 167 untracked 8-digit migrations to `supabase/migrations/_quarantine/legacy_untracked/`. Generated `supabase/migrations/00000000000000_baseline_schema.sql` (26 base tables). |
| C  | Created 4 `*_fix_*.sql` migrations in `supabase/migrations/` to bring this folder's still-required objects into the canonical set; rewrote every backend "Run database/X.sql" warning to point at the canonical migration; archived the entire folder under `_archive/`. |

## How to add a schema change today

1. Create a new file in `supabase/migrations/` named `YYYYMMDDHHMMSS_<slug>.sql`.
2. Make it idempotent (`CREATE … IF NOT EXISTS`, `DO $$ … $$` for constraints, `CREATE OR REPLACE FUNCTION`).
3. Apply via Supabase CLI (`supabase db push`) or via the migration runner.
4. Do NOT add the SQL to this folder.

## If you need to look up an old script

Browse `_archive/legacy_database/` (read-only). If the object still exists in production but is not represented in `supabase/migrations/`, file a follow-up to fold it into a canonical migration before relying on it.

## Dangerous scripts

`_archive/dangerous/` holds 7 destructive scripts (`reset-and-apply-schema.sql`, `cleanup-database.{ps1,sh}`, `clear-campaign-data.ps1`, `setup-super-admin.ps1`, `cleanup-unnecessary-tables.sql`, `campaign-management-clean-schema.sql`). They were previously runnable from the repo root; archiving prevents accidental execution. Do not move them back; do not invoke them.
