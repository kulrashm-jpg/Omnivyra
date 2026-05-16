# PostgREST Schema-Cache Remediation (Phase D)

This is the operator runbook referenced by the billing schema tooling
(`billingBootstrapValidator.ts`, `verify-billing-schema.ts`,
`run-billing-migrations.ts`, `pages/api/admin/billing/health.ts`) when a
billing surface returns:

```
Could not find the table 'public.credit_action_approvals' in the schema cache
```

or PostgREST error codes `PGRST205` (table not in schema cache) /
`PGRST202` (function not in schema cache), or Postgres `42P01`
(`relation … does not exist`).

> **First, classify the failure.** There are two very different root
> causes with opposite fixes. The health endpoint does this for you —
> `GET /api/admin/billing/health` → `readiness.postgrest`:
>
> - `genuinelyMissingCount > 0` → the SQL was **never applied**. Go to
>   §2 (apply migrations), then §1 (reload cache).
> - `schemaCacheMissCount` covers all missing, `genuinelyMissingCount = 0`
>   → the SQL **is applied**, the cache is **stale**. Go to §1 ONLY. Do
>   **not** re-run migrations — they're idempotent so it's harmless, but
>   it wastes a deploy window and masks the real issue.

---

## 1. Reload the PostgREST schema cache (stale cache; SQL already applied)

PostgREST caches the database schema in memory. After DDL it must be told
to reload, or it keeps serving the old schema and 404s objects that
exist. Pick the path that matches your deployment:

### 1a. Hosted Supabase — `NOTIFY` (no downtime, preferred)

Run in the Supabase SQL editor (or any psql session against the DB):

```sql
NOTIFY pgrst, 'reload schema';
```

PostgREST listens on the `pgrst` channel and reloads within ~1s. This is
zero-downtime and the correct first action for hosted Supabase.

### 1b. Hosted Supabase — Dashboard restart (fallback)

Supabase Dashboard → **Project Settings → API → "Restart server"**, or
**Database → Restart**. Use only if `NOTIFY` did not take effect within a
minute (rare; usually means the connection issuing `NOTIFY` was pooled
away before delivery — re-run §1a on a direct, non-pooled connection).

### 1c. Self-hosted / local Supabase CLI

```bash
# CLI stack
supabase stop && supabase start          # full local restart
# or, against the running DB:
psql "$SUPABASE_DB_URL" -c "NOTIFY pgrst, 'reload schema';"
# or restart just the API container
docker restart supabase_rest_<project>
```

### 1d. Verify the cache picked up the change

```bash
# Should return 200 with an (empty) array, NOT a PGRST205 body.
curl -s -i \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "$SUPABASE_URL/rest/v1/credit_action_approvals?select=id&limit=0"
```

Then re-probe through the app's own source of truth:

```bash
npx tsx scripts/audit/verify-billing-schema.ts
# or, authenticated as FINANCE_AUDITOR:
curl -s "$APP_URL/api/admin/billing/health" | jq '.status, .readiness.postgrest'
```

`status.overall: "ok"` and `readiness.postgrest.ready: true` → resolved.

---

## 2. Missing-table diagnostics (SQL never applied)

If the object genuinely does not exist (Postgres `42P01`, or the health
endpoint reports `genuinelyMissingCount > 0`), the billing migrations
were never applied to **this** database (the classic symptom: the
migration files exist in `supabase/migrations/` but `db push` was never
run against the dev/staging DB).

### 2a. See exactly what is missing

```bash
npx tsx scripts/audit/verify-billing-schema.ts          # advisory
STRICT_BILLING_SCHEMA=true npx tsx scripts/audit/verify-billing-schema.ts
```

It prints per-object status, **partial-migration** state (some objects
from a migration present, others missing — indicates an interrupted
apply), and the exact remediation list.

### 2b. Apply only what is missing (safe runner)

```bash
# Dry run first — shows the plan, applies nothing.
npx tsx scripts/audit/run-billing-migrations.ts --dry-run

# Apply (needs a DIRECT Postgres URL — PostgREST cannot run DDL):
SUPABASE_DB_URL="postgres://…:5432/postgres" \
  npx tsx scripts/audit/run-billing-migrations.ts
```

The runner probes which migrations have missing objects, applies **only
those**, in dependency order (`20260663 → 20260664 → 20260665`), one
transaction per file, refuses any file containing destructive DDL, and
re-verifies afterward. It is idempotent — re-running is safe.

### 2c. Or the project-standard path

```bash
npm run db:push    # wraps `supabase db push` with the prod guard
```

…or paste the files, **in order**, into the Supabase SQL editor:

```
supabase/migrations/20260663_ledger_immutability_and_governance.sql
supabase/migrations/20260664_phase2_governance_and_payment_foundation.sql
supabase/migrations/20260665_phase3_fx_engine_and_contracts.sql
```

> After applying via **any** path in §2, the schema cache is now stale by
> definition — go back and do **§1 (reload the cache)**, then §1d to
> verify. Applying migrations without reloading the cache reproduces the
> exact same `PGRST205` symptom and looks like the fix "didn't work".

---

## 3. Stale RPC (`PGRST202` — function not found)

A `CREATE OR REPLACE FUNCTION` that changed the **argument signature**
(added/renamed/retyped a parameter) leaves PostgREST resolving the old
signature until the cache reloads. Symptoms: the RPC 404s, or
"Could not find the function public.fn(...) with these arguments".

1. Confirm the function and its current signature exist:

   ```sql
   SELECT p.proname,
          pg_get_function_identity_arguments(p.oid) AS args
   FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('lookup_fx_rate','required_approvals_for_action',
                        'sign_credit_action_approval','claim_job_execution',
                        'advance_job_execution','cancel_credit_action_approval',
                        'advance_payment_provider_event_state');
   ```

2. If the signature is correct in the DB but PostgREST still 404s →
   stale cache → **§1 (`NOTIFY pgrst, 'reload schema'`)**.
3. If the function is absent or has the **old** signature → the migration
   that replaces it was not applied → **§2**.
4. Callers must pass named params matching the current signature
   (`supabase.rpc('lookup_fx_rate', { p_source, p_target })`). A
   positional/》name mismatch also surfaces as `PGRST202` even with a
   warm cache and correctly-installed function.

> Only the two **read-only** RPCs (`lookup_fx_rate`,
> `required_approvals_for_action`) are live-probed by the tooling. The
> five mutating RPCs are **never called** by the prober (calling them
> would mutate data); their presence is inferred from a critical table
> created in the same migration transaction. To verify a mutating RPC
> definitively, use the `pg_proc` query above.

---

## 4. Local vs remote schema mismatch

Common when local works but staging/prod 404s (or vice-versa): the
migration was applied to one database and not the other, or a hotfix was
applied directly to one environment and never captured as a migration.

Per environment, run the **same** probe so you are comparing like with
like:

```bash
# point env at the environment you are checking
SUPABASE_URL=…  SUPABASE_SERVICE_ROLE_KEY=…  \
  npx tsx scripts/audit/verify-billing-schema.ts
```

Compare `present/missing/unverified` counts and the partial-migration
report across environments. Reconcile by applying the missing migrations
to the lagging environment via §2 — **never** by hand-patching one
environment (that re-creates the drift and breaks the next `db push`).
After reconciling, run §1 on the environment you changed.

Definitive object-level diff (run on each DB, compare output):

```sql
SELECT 'table' AS kind, table_name AS name
  FROM information_schema.tables WHERE table_schema='public'
UNION ALL
SELECT 'function', proname FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
ORDER BY 1,2;
```

---

## 5. When a Supabase restart is the right move

Prefer `NOTIFY pgrst, 'reload schema'` (§1a) — it is zero-downtime.
Escalate to a restart (§1b/§1c) only when:

- `NOTIFY` was issued but `curl` (§1d) still returns `PGRST205` after a
  minute (pooled connection ate the notification — first retry §1a on a
  **direct** connection).
- The PostgREST process is in a bad state for unrelated reasons
  (connection-pool exhaustion, OOM) — a restart also clears the cache.
- Local CLI stack where `supabase stop && supabase start` is simply the
  fastest reset.

A restart is **not** a substitute for applying missing migrations — if
the SQL was never run, a restart changes nothing (the objects still do
not exist). Always classify with the health endpoint first (§ top).

---

## 6. Post-remediation verification checklist

1. `curl … /rest/v1/<table>?select=id&limit=0` → `200` (not `PGRST205`).
2. `npx tsx scripts/audit/verify-billing-schema.ts` → `OK — all critical
   billing schema objects present.`
3. `GET /api/admin/billing/health` (FINANCE_AUDITOR) →
   `status.overall: "ok"`, every `readiness.*.ready: true`,
   all `migrations[].state: "applied"`.
4. Boot validator log line `billing_bootstrap_ok` on next process start
   (no `billing_bootstrap_critical_missing`).
5. Retry the original user action (e.g. credit grant) — no
   "Submitting…" hang, no schema-cache error.

If any opaque object (trigger/index) is still `unverified` after the
cache reload, run its `verifySql` (from the health endpoint
`triggers[].verifySql`) for a definitive `information_schema` /
`pg_indexes` check.

---

## 7. The "phantom present" stale-cache trap (verified on production)

A PostgREST schema cache can be stale in the **dangerous direction**: it
keeps advertising a table that does **not** exist. Verified on
production `klkiseupptzbecbxwrky`:

```
HEAD-COUNT  (.select('*',{count:'exact',head:true}).limit(0))  → error: null
REAL FETCH  (.select('*').limit(1))                            → PGRST205
            "Could not find the table '…' in the schema cache"
```

A head/count request is answered from cached metadata **without
resolving the relation**, so an absent table reads as "present". This
silently masked 21 missing critical tables and would have *falsely
certified* a broken production as healthy.

**Rules going forward:**

- Schema verification MUST use a relation-touching read
  (`select('*').limit(1)`), never `head:true`+count. This is fixed in
  `billingSchemaSpec.ts::probeTable` and regression-covered.
- A `head:true` "success" is **not** proof a table exists. If a head
  probe passes but a real fetch returns `PGRST205`, the cache holds a
  phantom — reload it (§1) **and** verify the relation actually exists
  via direct SQL:

  ```sql
  SELECT to_regclass('public.<table>');   -- NULL ⇒ genuinely absent
  ```

- After dropping/recreating objects, always reload the cache; a phantom
  entry will otherwise serve head/count requests indefinitely.

## 8. Migration-ledger desynchronization

Symptom: `verify-billing-schema.ts` (corrected) shows objects missing,
but `supabase db push` either does nothing or tries to (re)create
objects that already exist and fails.

Diagnose — compare the ledger to the filesystem and to reality:

```sql
SELECT count(*) FROM supabase_migrations.schema_migrations;          -- recorded
SELECT to_regclass('public.companies'), to_regclass('public.credit_transactions');
```

```bash
ls supabase/migrations/*.sql | wc -l                                  -- on disk
```

If recorded ≪ on-disk **and** core tables exist, the ledger does not
reflect how the DB was built. **Do not `db push`** — it will attempt
every "pending" migration over a populated DB. Remediation is a
deliberate operator task:

1. Back up / PITR-snapshot production first.
2. Baseline the ledger: mark already-present migrations as applied
   (`supabase migration repair --status applied <version>` per migration
   whose objects exist) so `db push` targets only genuinely-missing ones.
3. Then `db push` (or hand-apply the missing chain in version order) in
   a maintenance window, then reload the cache (§1).

This is referenced by [`billing-migration-execution-report.md`](./billing-migration-execution-report.md)
and [`billing-production-schema-activation.md`](./billing-production-schema-activation.md).
