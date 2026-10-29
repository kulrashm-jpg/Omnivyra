# Release gate: production verification handoff (read-only)

Release branch `feat/orchestration-engine-adapters`, rebased onto `main` `c4e4e9bb`. Stack migrations:
`20261127000000` and `20261226000000` … `20261231000010`.

The gate also covers three earlier changes that are already in production:

- FIX3 `20261212000000`.
- The out-of-repo revoke of `authenticated` on the 8 Phase-A content tables.
- `close_anon` `20261026000000` (#239).

**Status: NO-GO.** Nothing here has been run against production. All tooling was tested only on a
disposable PostgreSQL 17.6 cluster, which proves that the tooling works. It does not show what
production contains. Running this handoff needs separate, explicit authorization from the owner.

References:

- `docs/release/orchestration-engine-adapters-migration-runbook.md`: preflight P0–P13, apply order, rollback.
- `docs/release/grants-consumer-matrix.md`: object matrix, consumer trace, facts P1–P9.
- `docs/release/applied-sql-equivalence.md`: per-candidate SQL evidence.

## 0. Access to grant (and nothing else)

| # | Access | Used by | Notes |
|---|---|---|---|
| 1 | A **fresh** read-only PostgreSQL credential for a direct (non-PostgREST) connection | A, B, C1 | Do not reuse the stale pooler password from `.env.local`; retries risk a lockout. See the role requirements below. |
| 2 | Supabase **Logs Explorer** read access (dashboard), or Management API analytics read | C2 | This is a separate grant from the database role. |
| 3 | The owner's **SQL Editor history and saved snippets** in the Supabase dashboard | B0 | Only the owner or operator can read these. |
| 4 | *(Optional)* a production **schema-only dump with ACLs** (`pg_dump --schema-only`, which keeps privileges by default) | B2 | Needed only if residual differences in B2 cannot be explained without it. It is a production read and needs its own authorization. |

Requirements for the database role (1):

- `default_transaction_read_only = on`;
- CONNECT on the database;
- USAGE on `public` and `supabase_migrations`;
- SELECT on `supabase_migrations.schema_migrations`;
- SELECT on the checked public tables, or membership of `pg_read_all_data`.

The last item matters: without it, `information_schema.columns` hides columns, and the parity check
reports them as false BLOCKING "absent" findings. It never reports a false pass. Catalog functions
(`has_*_privilege`, `pg_get_functiondef`) need nothing extra.

Session rules:

- The connection string lives only in the operator's shell environment. Never write it to a file,
  commit, log or chat.
- Run from a clean checkout of the exact release commit.
- Save every output with its UTC timestamp and the commit SHA.
- A check that errors, times out, or returns no rows where rows are expected is **BLOCKED**, never PASS.

### 0.1 Issuing the credential

This step is the **owner's**. It is a production write and needs its own authorization. Run it as
`postgres` in the dashboard SQL Editor:

```
CREATE ROLE release_gate_ro LOGIN;
ALTER ROLE release_gate_ro SET default_transaction_read_only = on;
ALTER ROLE release_gate_ro VALID UNTIL '<end of the verification day>';
GRANT pg_read_all_data TO release_gate_ro;
```

Then set a **fresh** password with psql `\password release_gate_ro`. The prompt keeps the password out
of SQL history. Hand the password to the operator out of band.

`pg_read_all_data` gives the role SELECT and USAGE everywhere and no write access. After the session,
run `DROP ROLE release_gate_ro;`, which is also an owner action.

Do not reuse the stale pooler password.

### 0.2 First query of the session: credential self-check

```
psql "$PROD_READONLY_URL" -X -v ON_ERROR_STOP=1 -f scripts/release/session-readiness-check.sql > session-check.out
```

The `overall` row must read `0 FAIL | OK`; on any FAIL, STOP and do not run anything else with the
credential. psql exits 0 either way, so read the `overall` row. The self-check verifies:

- read-only, both for the session and as a setting on the role;
- not a superuser, no BYPASSRLS, no CREATEROLE, CREATEDB or REPLICATION;
- not a member of `pg_write_all_data`;
- **zero writable tables** and zero schemas with CREATE;
- USAGE on `public`;
- **no public relation whose columns are hidden** from `information_schema`, the cause of false "missing"
  findings in parity;
- the ledger exists, its schema is usable and it is readable;
- the `anon`, `authenticated` and `service_role` roles exist.

It cannot verify that the password is fresh; the owner attests to that.

Validated on the disposable cluster with four simulated credentials:

| Simulated credential | Result |
|---|---|
| Correct read-only role | 0 FAIL |
| Read-only role without catalog visibility | 3 FAIL (906 relations with hidden columns, ledger schema and table unreadable) |
| Writer | 3 FAIL |
| Superuser | 7 FAIL |

## A. Schema parity

Commands:

```
# A1  Migration preflight (runbook §3.2–3.3). It runs in a READ ONLY transaction and ends with ROLLBACK.
node scripts/release/runbook-preflight-build.js docs/release/orchestration-engine-adapters-migration-runbook.md preflight.sql
psql "$PROD_READONLY_URL" -X -v ON_ERROR_STOP=1 -f preflight.sql > preflight.out

# A2  Strict parity. The script reads SUPABASE_POOLER_DB_URL, then SUPABASE_DB_URL, then DATABASE_URL.
#     Point the variable at the fresh read-only credential.
PREDEPLOY_STRICT_SCHEMA=1 node scripts/predeploy-check.js
node scripts/verify-schema-parity.js --strict > parity.json      # same check, machine-readable
```

What strict mode does:

- It **blocks** on connection failure, missing credentials, a skipped check (a missing role or an
  unreadable ledger), any catalog query error, warnings (exit 3), and unknown exit codes.
- It never prints the password embedded in the URL. This was tested with a sentinel password across
  refused, unresolvable and wrong-password connections.

What the stack checks cover:

- 18 tables and their 208 columns, plus 5 column types;
- 45 indexes: 18 unique (BLOCKING) and 27 query-plan (WARN);
- 27 functions, checking existence, SECURITY DEFINER, and body markers (for example, the lease reaper must
  write `uncertain` and must not write `failed`);
- 17 triggers and 7 CHECK vocabularies;
- RLS on every stack table;
- privileges:
  - `anon` holding anything on a stack table is BLOCKING;
  - on the 8 explicitly revoked tables, `authenticated` holding anything is BLOCKING;
  - only `service_role` may execute the 3 SECURITY DEFINER RPCs.

**Two runs with different meanings:**

| Run | When | Expected result |
|---|---|---|
| A-baseline | before any stack migration | Stack objects are reported absent (exit 1). Record which **pre-existing** manifest entries fail: those are drift that predates this release and must be explained before anything is applied. Anything stack-related that is already present means a partial earlier apply; STOP and review it against runbook §3.3. |
| A-post | after `…000009` is applied, and again after `…000010` | Exit 0 under strict mode. Any BLOCKING finding means STOP, and roll back by runbook §9. |

**Known pre-existing items that keep strict mode at exit 3.** On the disposable database rebuilt at the
release commit, the strict run found **0 stack findings and 0 BLOCKING**. It still exited 3, for two
reasons that predate this release:

- 8 WARN and 16 INFO for manifest columns on `active_leads` (15), `opportunity_feed_items`,
  `content_performance`, `learning_intelligence`, `learning_memory` and `content_prediction`;
- a ledger desync.

Production has a known desynced ledger and a legacy table that occupies the name `active_leads`, so
expect the same there. Strict predeploy therefore blocks until the owner either fixes those items or
signs off on a written list of them.

PASS for A requires all of the following from the A-post run on production:

- `severity.blocking` = 0;
- `structural_findings` empty. It lists every non-column finding: stack tables, indexes, functions,
  triggers, CHECKs, RLS, privileges and `check_skipped`.
- no `missing_columns` entry on any of the 18 stack tables;
- every remaining WARN or INFO item, and the ledger desync, matched one-for-one against the A-baseline
  list and accepted by the owner.

A new WARN or INFO item that is not on the baseline list is a FAIL.

## B. Applied-SQL equivalence

**B0: recover the text (owner, dashboard).** Search SQL Editor history and saved snippets for:

| Candidate | Search terms | Compare with (sha256 of the committed file) |
|---|---|---|
| FIX3 | `content_quality`, `content_approval_history`, `FIX3`, `omnivyra_touch_updated_at` | `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5` |
| 8-table revoke | `REVOKE`, `authenticated`, `brand_memory`, `publication_lineage` | No committed text exists. The recovered text becomes the record. |
| close_anon | `close_anon`, `REVOKE ALL`, `ALTER DEFAULT PRIVILEGES` | `62e2371990ee020d255c9415bf3a76a7063e64f874b42d92364d3d37a589fc82` |

Export each recovered text **exactly**:

- Copy the full editor buffer, or use the snippet's download option, straight into a new file.
- Do not reformat it, trim whitespace, or let an editor normalise line endings.
- Record the source: a history entry or a saved snippet, with its name.
- Record any timestamp the dashboard shows, and who ran it if shown.

Never fabricate or reconstruct a missing text, in particular the 8-table revoke.

To compare, run `sha256sum <file>` on each saved text. Then run
`diff <(tr -d '\r' < recovered.sql) <(tr -d '\r' < supabase/migrations/<file>)`. Record whether the
texts are **byte-identical**, identical only after normalising line endings and whitespace, or
different (with the differing statements). If nothing is recovered, the record reads: *exact
equivalence is unprovable from available evidence.*

An unchanged file in Git does not show that it was executed as committed.

**B1: production catalog fingerprint.**

```
node scripts/release/catalog-fingerprint-build.js --check          # SQL matches the migration's object lists
psql "$PROD_READONLY_URL" -X -v ON_ERROR_STOP=1 -f scripts/release/catalog-fingerprint.sql > prod.tsv
grep -P '^meta\tsession\ttransaction_read_only\ton$' prod.tsv      # must match, or discard the run
```

**B2: expected snapshot and comparison.** Build the expected side on a disposable database (never on
production):

1. Replay `origin/main` migrations using the real-schema recipe (`scripts/ci/real-schema-ci.sh`).
2. Before the replay, apply the Supabase roles and production's default privileges, taken from the C1
   snapshot section S08.
3. Then apply the 8-table revoke as recovered in B0, or as described in memory if nothing was recovered.

Then compare:

```
psql "$EXPECTED_DISPOSABLE_URL" -X -v ON_ERROR_STOP=1 -f scripts/release/catalog-fingerprint.sql > expected.tsv
node scripts/release/semantic-compare-catalog.js expected.tsv prod.tsv --role-map <expected_owner>=<prod_owner>
```

The comparator exits 0 when the catalogs are equal and 1 when they differ semantically, meaning
differences in ACLs, RLS, policies, function bodies, constraints, indexes, triggers, default privileges
or object existence. Owner names, server metadata and MAINTAIN-only ACL differences count as noise.
`--role-map` was verified on the disposable cluster: mapped grantees compare equal, and a real
difference still exits 1.

**Catalog equivalence cannot establish byte-for-byte identity of the historical SQL.** Only B0 can do that.

PASS for B requires, per candidate:

- B0 recorded, as recovered with a byte verdict or as "unprovable";
- B2 exiting 0, or every semantic difference explained and accepted in writing by the owner.

## C. Grants and external consumers

```
# C1  ACL / grant / RLS / policy / publication snapshot (READ ONLY transaction, ROLLBACK)
psql "$PROD_READONLY_URL" -X -v ON_ERROR_STOP=1 -f scripts/release/grants-acl-check.sql > grants.out
```

**C1** covers:

- roles (S1) and relations (S2);
- `aclexplode`, with grantee 0 shown as PUBLIC (S3);
- effective privileges for anon, authenticated, service_role and PUBLIC (S4);
- column ACLs and policies;
- functions and `proacl`;
- `pg_default_acl` (S8) and `pg_publication_tables` (S9).

All four scopes are included: FIX3 plus the revoke, close_anon (all 177 tables, 37 views and 29
functions taken from the migration), the stack, and PR #349.

**C2: API logs.** In Logs Explorer, run `scripts/release/api-log-queries.sql` Q1–Q5, one day-slice at
a time, across the **full available retention window**. The queries cover:

| Query | Traffic |
|---|---|
| Q1–Q3 | user-token REST, RPC and GraphQL traffic |
| Q4 | realtime |
| Q5 | Postgres permission errors and client-role sessions |

Rules for running them:

- These queries have never been executed. Confirm each field path in the schema pane first. A query
  error or NULL role column is a schema mismatch, not evidence.
- Record each slice's start, end and row count, including zeros.
- **Zero hits do not prove there are no consumers.** The logs miss direct-database clients, BI tools,
  anything outside retention, realtime deliveries, and jobs that have not run recently.

**C3: realtime publication.** C1 section S9 must show that no in-scope table is in `supabase_realtime`.
From the repo, `credit_transactions` is the only table the app subscribes to
(`lib/swr/creditsRealtime.ts`). Production membership is unknown until S9 is run.

**C4: owner confirmation, in writing.** The owner confirms that none of the following use the 10
RLS-only stack tables, the 4 FIX3 tables or the 8 Phase-A tables:

- external integrations (Zapier, partner keys);
- direct database clients (psql users, scripts, workers outside this repo);
- BI tools or spreadsheets.

**Recommendations.** These are owner decisions; nothing has been implemented, and grants and policies
are unchanged.

1. **The 10 RLS-only stack tables:**
   - add an explicit `REVOKE ALL … FROM PUBLIC, anon, authenticated` plus
     `GRANT SELECT, INSERT, UPDATE, DELETE … TO service_role`, in a new migration;
   - optionally retarget their 6 `auth.role()`-keyed policies to `service_role`.

   The 10 tables are `prospect_lists`, `prospect_list_members`, `prospect_campaigns`, `workflows`,
   `workflow_versions`, `execution_instances`, `execution_plans`, `execution_plan_steps`,
   `execution_tasks` and `outreach_bridge_handoffs`.

   Prerequisites: C1, C2, C3 and C4.
2. **The 4 FIX3 tables:** the same pattern, decided separately (also after C1–C4). The 4 tables are
   `content_quality`, `content_block`, `content_recommendation` and `content_approval_history`.
3. **The 8-table revoke:** record it as an idempotent migration so that replays and fresh environments
   match production. Do this after B0 recovers the exact text, or after C1 shows the resulting ACLs
   if no text can be recovered.

PASS for C requires:

- C1 recorded with no anon privilege on any in-scope table;
- C2 run across the full retention window, with every non-service_role hit explained;
- C3 clean;
- C4 confirmed by the owner.

## Not covered by any check

- The 14 browser-extension assertions remain **UNVERIFIED**. No extension checkout exists and none of
  the checks above can verify them.
- Apply order, the deploy sequence (web and worker together with an identical `ENCRYPTION_KEY`, then
  `…000010`, then `VACUUM FULL rpa_sessions`) and rollback live in the runbook. Each of those steps needs
  its own authorization.
