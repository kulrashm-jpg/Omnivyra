# Prospect provenance — release checklist

Operator runbook for releasing the prospect provenance programme
(contract: `docs/architecture/PROSPECT-PROVENANCE-CONTRACT.md`). Every step lists the exact
action and the evidence to keep. Do not skip a step because an earlier one "obviously" passed.

`<MIG>` below is the provenance migration file (authored by the migration workstream; it must be
`supabase/migrations/<VERSION>_<name>.sql` with `<VERSION>` 14 digits and > `20270106000000`).
`<VERSION>` and `<NAME>` are its version and name (`<NAME>` = filename without the version prefix
and `.sql`).

## Read this first: what the gate will do

- The schema-parity manifest (`scripts/verify-schema-parity.js`) now requires
  `prospect_source_contributions` (9 columns + 2 unique indexes) and
  `source_records.{source_category, platform, source_url}` at **BLOCKING**.
  **Until `<MIG>` is applied in production, the verifier exits 1 and `predeploy-check` BLOCKS
  in every mode.** This is correct and intended: code that writes provenance must not ship to a
  database that cannot store it.
- `lead_intelligence` is now covered at **WARN** (its paths are fail-open). Production has every
  covered column (verified read-only 2026-10-30), so this adds no finding.
- The `active_leads` block went from 19 INFO expectations to **6 INFO** (5 REPLACED onto
  `prospect_source_contributions`, 8 RETIRED with evidence in the file). The 6 remaining
  opportunity-workflow entries (`opportunity_type`, `status`, `owner_user_id`, `snoozed_until`,
  `status_changed_at`, `status_changed_by`) are absent in production and stay pending the lifecycle
  mapping. **While they remain, the verifier exits 3 after the migration, so
  `PREDEPLOY_STRICT_SCHEMA=1` still BLOCKS.** Do not delete or downgrade them to get a green
  result. Either the lifecycle workstream resolves them with evidence, or the release runs
  non-strict and records the 6 INFO findings as a known, named exception in the release record.
- Exit-code semantics are unchanged: exit 0 only when there are no findings and the ledger is
  clean; INFO/WARN ⇒ 3; strict turns 3 into 1; BLOCKING ⇒ 1 always.

## 0. Preconditions

| # | Action | Expected evidence |
|---|---|---|
| 0.1 | Release code is merged to `main`; work from a **fresh, clean checkout of `origin/main`** (never a feature worktree). | `git status --porcelain` empty; `git rev-parse HEAD` == `git rev-parse origin/main`. |
| 0.2 | All required checks are green on the merge commit, including **PI unit suites** (which now also runs the `piProv*` and unified-lead-view suites) and **Non-regression TypeScript baseline** (which runs the deploy-gate contract suites, including `piProvSchemaGateContract`). | GitHub checks page for the SHA. |
| 0.3 | `node scripts/check-migration-quality.js` | Exit 0. |
| 0.4 | Read `<MIG>` end to end. Confirm: every `CREATE`/`ADD COLUMN` is `IF NOT EXISTS`; RLS is enabled in the same file; `REVOKE ALL … FROM PUBLIC, anon, authenticated`; `GRANT SELECT, INSERT … TO service_role` only; no FK to a table that is not in production. | Reviewer sign-off in the release record. |
| 0.5 | Confirm the SQL Editor is open on the **production project ref `klkiseupptzbecbxwrky`** (check the URL, not the project name). | Screenshot or the URL in the release record. |

## 1. Preflight (read-only, SQL Editor)

Run each query and record its output.

```sql
-- 1a. Target objects are absent (or, on a re-run, exactly as the migration leaves them).
SELECT to_regclass('public.prospect_source_contributions') AS psc;            -- expect NULL
SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'source_records'
   AND column_name IN ('source_category', 'platform', 'source_url');           -- expect 0 rows

-- 1b. Composite-FK prerequisites: (id, tenant) unique keys.
SELECT c.relname AS table_name, i.relname AS index_name, pg_get_indexdef(x.indexrelid) AS def
  FROM pg_index x
  JOIN pg_class c ON c.oid = x.indrelid
  JOIN pg_class i ON i.oid = x.indexrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND x.indisunique
   AND c.relname IN ('canonical_leads', 'source_records', 'engagement_messages',
                     'contacts', 'lead_signals', 'opportunity_feed_items')
 ORDER BY 1, 2;
-- expect: an (id, company_id) unique on canonical_leads, (id, organization_id) uniques on
-- source_records and engagement_messages. contacts / lead_signals / opportunity_feed_items have
-- NO (id, organization_id) unique yet; <MIG> adds them.

-- 1c. Sizes of the tables that get a new unique index (id is already the PK, so the build cannot
--     fail on duplicates; size only predicts lock duration).
SELECT 'contacts' AS t, count(*) FROM public.contacts
UNION ALL SELECT 'lead_signals', count(*) FROM public.lead_signals
UNION ALL SELECT 'opportunity_feed_items', count(*) FROM public.opportunity_feed_items;

-- 1d. Ledger: the version is not recorded yet.
SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '<VERSION>';  -- expect 0 rows
```

Stop if 1a shows the table exists with a different shape, or if 1b shows a prerequisite unique
key missing on `canonical_leads`, `source_records` or `engagement_messages`.

## 2. Apply (SQL Editor)

| # | Action | Expected evidence |
|---|---|---|
| 2.1 | Paste the **entire** content of `<MIG>` from the `origin/main` checkout into one new query and run it once. Do **not** use `supabase db push` or `npm run db:push` (the ledger is not in a state where push is safe; see `docs/migration-discipline.md`). | "Success. No rows returned" (or the file's own NOTICE lines). Any error: stop and go to section 7. Do not hand-edit and re-run partial statements. |

## 3. Verify the applied schema (read-only, SQL Editor)

```sql
-- 3a. The 18 contract columns.
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'prospect_source_contributions'
 ORDER BY ordinal_position;
-- expect exactly: id, organization_id, canonical_lead_id, contribution_role, source_category,
-- external_ref, source_record_id, platform, source_url, contact_id, lead_signal_id,
-- opportunity_feed_item_id, engagement_message_id, ingestion_run_id, observed_at, evidence,
-- source_metadata, created_at, with nullability as in the contract table.

-- 3b. source_records provenance columns: nullable text.
SELECT column_name, data_type, is_nullable FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'source_records'
   AND column_name IN ('source_category', 'platform', 'source_url');            -- expect 3 rows, text, YES

-- 3c. The two contract indexes: uniqueness and partiality are what the writer depends on.
SELECT i.relname, x.indisunique, (x.indpred IS NOT NULL) AS partial, pg_get_indexdef(x.indexrelid)
  FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
 WHERE i.relname IN ('uq_psc_org_lead_external_ref', 'uq_psc_one_originating_per_lead');
-- expect: uq_psc_org_lead_external_ref  unique, NOT partial, (organization_id, canonical_lead_id, external_ref)
--         uq_psc_one_originating_per_lead unique, partial, (canonical_lead_id) WHERE contribution_role = 'originating'

-- 3d. CHECK and FK constraints.
SELECT conname, contype, pg_get_constraintdef(oid)
  FROM pg_constraint WHERE conrelid = 'public.prospect_source_contributions'::regclass ORDER BY conname;
-- expect: the role CHECK (2 values), the source_category CHECK (the 12 contract values), the
-- external_ref CHECK, the evidence/source_metadata object CHECKs, and composite FKs to
-- companies, canonical_leads(id, company_id), source_records, contacts, lead_signals,
-- opportunity_feed_items and engagement_messages on (…, organization_id).
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid = 'public.source_records'::regclass AND pg_get_constraintdef(oid) ILIKE '%source_category%';

-- 3e. Privileges: RLS on; only service_role may read/insert; nobody may update/delete.
SELECT relrowsecurity FROM pg_class WHERE oid = 'public.prospect_source_contributions'::regclass;  -- expect true
SELECT grantee, privilege_type FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'prospect_source_contributions' ORDER BY 1, 2;
-- expect service_role: INSERT, SELECT (plus the owner). No anon / authenticated / PUBLIC rows,
-- no UPDATE / DELETE for service_role.

-- 3f. Empty on arrival.
SELECT count(*) FROM public.prospect_source_contributions;                     -- expect 0
```

## 4. Record the ledger row (SQL Editor)

Recording is what keeps the verifier's ledger classifier clean (an unrecorded file is reported as
unrecorded, not as drift; a recorded version **with no local file** is drift). Record the version
and name exactly as the filename has them, with the applied file text as the single statement:

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('<VERSION>', '<NAME>', ARRAY[$mig$<entire content of <MIG>>$mig$])
ON CONFLICT (version) DO NOTHING;

SELECT version, name, md5(array_to_string(statements, E'\n')) AS statements_md5
  FROM supabase_migrations.schema_migrations WHERE version = '<VERSION>';
```

Expected evidence: one row; `name` == `<NAME>` (otherwise the verifier reports a name mismatch);
keep the `statements_md5` value in the release record. Do **not** touch the three historical
version-map rows (20260525141657, 20260525223113, 20260601022203).

## 5. Strict predeploy (fresh `origin/main` checkout, production credentials in that shell)

```bash
PREDEPLOY_STRICT_SCHEMA=1 node scripts/predeploy-check.js
```

Expected evidence: the `schema_parity.check` JSON line. Keep it. Read it as follows:

| `severity` / `ledger_desync_detected` | Meaning | Predeploy result |
|---|---|---|
| `blocking: 0, warn: 0, info: 0`, `false`, `status: "ok"` | Everything applied, ledger clean, workflow entries reconciled | `schema parity: OK`; continue |
| `blocking: 0, warn: 0, info: 6`, `false` | Expected **today**: only the 6 active_leads workflow expectations (pending lifecycle mapping) | Strict: BLOCKED (exit 1). Non-strict: `OK WITH 1 UNVERIFIED GATE`; record the 6 named INFO findings as the known exception |
| any `blocking > 0` naming `prospect_source_contributions` / `source_records.*` / `uq_psc_*` | `<MIG>` not (fully) applied | BLOCKED. Return to section 2/3 |
| `ledger_desync_detected: true` | Orphan or version-map violation (or the ledger could not be read) | Strict: BLOCKED. Investigate `ledger_probe`; never "fix" by deleting rows |

`missing_columns` and `structural_findings` must not contain any entry other than the ones the
table above expects.

## 6. Render parity and deploy

| # | Action | Expected evidence |
|---|---|---|
| 6.1 | Render parity runs inside predeploy-check (`node scripts/verify-render-parity.js`). | `render parity: OK`. A `SKIPPED (sharp unavailable)` must be run inside the worker image instead. |
| 6.2 | Deploy the **same SHA** to both runtimes: Railway auto-deploys `main` (the worker); Vercel is manual (`vercel --prod` from the same clean checkout, or `npm run deploy:prod`). | Railway deployment SHA == release SHA; Vercel deployment id recorded. |
| 6.3 | Confirm the live build: `GET /api/health/version`. | Its `build` SHA == release SHA (this is the only trustworthy SHA). |
| 6.4 | Post-deploy Vercel render probe: `npm run verify:vercel-render-parity`. | PASS, `ok=true`, `inkRatio>0`. |
| 6.5 | Tag: `git tag -a deploy/omnivyra-<stamp> <sha>` as printed by predeploy-check. | Tag pushed. |

## 7. Post-deploy verification (read-only, SQL Editor, after the first ingestion runs)

```sql
-- At most one originating contribution per lead (the partial unique index enforces it; this proves it).
SELECT canonical_lead_id, count(*) FROM public.prospect_source_contributions
 WHERE contribution_role = 'originating' GROUP BY 1 HAVING count(*) > 1;      -- expect 0 rows

-- Every contribution is tenant-consistent with its lead.
SELECT count(*) FROM public.prospect_source_contributions p
  JOIN public.canonical_leads l ON l.id = p.canonical_lead_id
 WHERE l.company_id <> p.organization_id;                                       -- expect 0

-- Coverage by category (grows as ingestion paths run; no category outside the vocabulary).
SELECT source_category, contribution_role, count(*) FROM public.prospect_source_contributions
 GROUP BY 1, 2 ORDER BY 1, 2;
```

## 8. Rollback

| Situation | Action | Evidence |
|---|---|---|
| Application regression, schema fine | Roll back **code only**: `vercel promote <previous deployment>` (or `vercel rollback`) and revert/redeploy the worker commit. The table and columns are additive; the previous code never reads or writes them. | `/api/health/version` shows the previous SHA. |
| `<MIG>` failed part-way in step 2 | Do not re-run fragments. Re-run 1a/3a–3e to see what landed; the migration is idempotent (`IF NOT EXISTS`), so after fixing the cause the whole file is re-applied. | Before/after query outputs. |
| Schema must be removed **and `prospect_source_contributions` has 0 rows** | Apply the rollback file from `supabase/migrations/rollbacks/` (authored with `<MIG>`): drop the table, the three `source_records` columns and their CHECK, and only the `(id, organization_id)` unique indexes that `<MIG>` created. Then `DELETE FROM supabase_migrations.schema_migrations WHERE version = '<VERSION>';`. The verifier will then BLOCK again (by design) until the code is rolled back too. | 1a returns NULL / 0 rows again; ledger row gone. |
| Table has rows | **Do not drop it.** The rows are append-only provenance evidence. Roll back code only, and leave the schema in place. | Row count recorded before and after. |
