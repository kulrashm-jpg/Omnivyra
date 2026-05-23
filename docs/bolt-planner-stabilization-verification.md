# BOLT Planner Stabilization — Schema Verification

Two new migrations land columns the running code already writes:

- `supabase/migrations/20260725_bolt_execution_resilience_columns.sql` — `bolt_execution_runs.lock_owner / lock_acquired_at / lock_expires_at / cancel_requested* / heartbeat_at` (+ `scheduled_posts.idempotency_key`)
- `supabase/migrations/20260726_queue_jobs_result_and_error_code.sql` — `queue_jobs.result_data / error_code`

Both are fully idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

## Why not `db push`

Per the existing migration ledger (4 of 145 applied, duplicate-version prefixes upstream), `supabase db push` is keyed on version and may re-attempt already-applied migrations in unpredictable order. Apply each new migration **directly** in the Supabase SQL editor against the project referenced by `.env.local` (which IS production for this codebase).

## Apply procedure

1. Open Supabase Studio → SQL Editor → New Query
2. Paste the **entire contents** of `20260725_bolt_execution_resilience_columns.sql`. Run.
3. Verify with the query block in §A below. Expect 7 rows.
4. Paste the entire contents of `20260726_queue_jobs_result_and_error_code.sql`. Run.
5. Verify with §B. Expect 2 rows.
6. Verify the indexes landed with §C. Expect 4 rows.

If any verification step returns fewer rows than expected, the migration partially applied — re-run the file (idempotent) and re-verify.

## §A. `bolt_execution_runs` columns

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'bolt_execution_runs'
  AND column_name IN (
    'lock_owner',
    'lock_acquired_at',
    'lock_expires_at',
    'cancel_requested',
    'cancel_requested_at',
    'cancel_requested_by',
    'heartbeat_at'
  )
ORDER BY column_name;
```

Expected: 7 rows.

## §B. `queue_jobs` columns

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'queue_jobs'
  AND column_name IN ('result_data', 'error_code')
ORDER BY column_name;
```

Expected: 2 rows — `error_code` (character varying) and `result_data` (jsonb).

## §C. Indexes

```sql
SELECT schemaname, indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_bolt_execution_runs_lock_expires',
    'idx_bolt_execution_runs_heartbeat',
    'idx_queue_jobs_error_code',
    'idx_queue_jobs_status_error_code'
  )
ORDER BY indexname;
```

Expected: 4 rows.

## §D. Post-apply smoke

After running the migrations, trigger a BOLT run. With heartbeats now landing, the abandonment sweeper will no longer fire prematurely. If a run still fails, `bolt_execution_runs.raw_error_message` will hold the **real** failure cause — record it before any further code changes.

```sql
SELECT id, status, current_stage, failed_stage,
       LEFT(error_message, 80)  AS user_message,
       LEFT(raw_error_message, 200) AS raw_cause,
       heartbeat_at, lock_expires_at, updated_at
FROM bolt_execution_runs
WHERE company_id = '<your-company-uuid>'
ORDER BY created_at DESC
LIMIT 5;
```

If `error_message` shows the generic "technical glitch" wording while `raw_error_message` is `NULL` or also generic, the sweeper overwrote the real error — Phase 2 of the stabilization (sweeper overwrite guards, see this same commit) addresses that.
