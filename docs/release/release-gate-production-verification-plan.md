# Release gate: consolidated read-only production verification plan

Scope: release branch `feat/orchestration-engine-adapters` (stack migrations `20261127000000` and
`20261226000000` … `20261231000010`), plus the three grant/SQL candidates that the gate also covers:
FIX3 `20261212000000`, the out-of-repo `authenticated` revoke on the 8 Phase-A content tables, and
`close_anon` `20261026000000` (#239).

**Nothing in this document has been run against production.** Every check below was built and tested
only on a disposable PostgreSQL 17.6 cluster, which proves the tooling works, not what production
contains. The session that runs it needs separate, explicit authorization from the owner.

Detail lives in:

- `docs/release/orchestration-engine-adapters-migration-runbook.md` — deploy order, preflight P0–P13, rollback.
- `docs/release/grants-consumer-matrix.md` — object matrix, consumer trace, effective privileges, P1–P9.
- `docs/release/applied-sql-equivalence.md` — per-candidate evidence for applied SQL.

## 0. Session rules

- One operator, one read-only session. The connection string is held by the operator in an env var
  (`PROD_READONLY_URL` below, and `SUPABASE_POOLER_DB_URL` for the parity script). Never paste it into
  a file, a commit, a log, or a chat.
- The role must have `default_transaction_read_only=on`. Every SQL file also wraps itself in
  `BEGIN TRANSACTION READ ONLY … ROLLBACK`; check that the session reports `transaction_read_only = on`
  before trusting any result.
- Run from a clean checkout of the exact commit being released (after it is rebased onto the current
  `origin/main`), so the manifests match the migrations that will ship.
- Save every output with its UTC timestamp and the commit SHA. A check that errors, times out, or
  returns no rows where rows are expected is **BLOCKED**, never PASS.

## 1. Checks, permissions, and pass conditions

| # | Check | Command | Permissions | Pass condition |
|---|---|---|---|---|
| 1 | Migration preflight (runbook §3.2–3.3, P0–P13) | §2.1 | CONNECT; USAGE on `public`, `supabase_migrations`; SELECT on `supabase_migrations.schema_migrations`; aggregate SELECT on the tables the preflight counts | Every P-check matches the runbook's expected result; no STOP condition |
| 2 | Strict schema parity | §2.2 | As 1, plus SELECT (or `pg_read_all_data`) on checked public tables — without it, columns are hidden and report as false BLOCKING | Before migrations: the stack's objects are reported absent and nothing else is BLOCKING. After migrations: exit 0 under `PREDEPLOY_STRICT_SCHEMA=1` |
| 3 | Catalog fingerprint + semantic compare | §2.3 | CONNECT and catalog reads only; SELECT on the ledger table for the ledger facts | Comparator exit 0 against the expected database, or every semantic difference explained and accepted in writing by the owner |
| 4 | ACL / grant snapshot | §2.4 | CONNECT and catalog reads only | Facts P1, P2, P4 (matrix §7) recorded; no anon privilege on any in-scope table; stack tables match the coverage expectations |
| 5 | Supabase API-log review | §2.5 | Logs Explorer (dashboard) or Management API analytics read access — a separate grant from the DB role | Every day-slice of the full retention window run and recorded; non-service_role hits on in-scope objects explained. Zero hits are **necessary, not sufficient** |
| 6 | Applied-SQL text recovery | §2.6 | Owner's dashboard access (SQL Editor history); optional `pg_stat_statements` read | A recovered text hashes to the committed file, or the gap is recorded as permanently unprovable |

Extension (browser) behaviour: the 14 extension assertions remain **UNVERIFIED**; no extension
checkout exists on the build machine and none of the checks above can verify them.

## 2. Exact commands

### 2.1 Migration preflight

```
node scripts/release/runbook-preflight-build.js docs/release/orchestration-engine-adapters-migration-runbook.md preflight.sql
psql "$PROD_READONLY_URL" -X -v ON_ERROR_STOP=1 -f preflight.sql > preflight.out
```

Compare each `=== P… ===` section with the runbook's expected result.

### 2.2 Strict schema parity

```
export SUPABASE_POOLER_DB_URL   # operator sets it in the shell; never written down
PREDEPLOY_STRICT_SCHEMA=1 node scripts/predeploy-check.js
# or the verifier alone:
node scripts/verify-schema-parity.js --strict
```

Under strict mode, connection failure, missing credentials, a skipped check (missing role,
unreadable ledger) and any catalog query error all block. Before the stack's migrations are applied,
the stack entries are expected to fail; that run is a baseline, not a pass.

### 2.3 Catalog fingerprint and semantic comparison

```
node scripts/release/catalog-fingerprint-build.js --check
psql "$PROD_READONLY_URL" -X -v ON_ERROR_STOP=1 -f scripts/release/catalog-fingerprint.sql > prod.tsv
grep -P '^meta\tsession\ttransaction_read_only\ton$' prod.tsv
psql "$EXPECTED_DISPOSABLE_URL" -X -v ON_ERROR_STOP=1 -f scripts/release/catalog-fingerprint.sql > expected.tsv
node scripts/release/semantic-compare-catalog.js expected.tsv prod.tsv --role-map <expected_owner>=<prod_owner>
```

The expected side must be a disposable database restored from a production-shaped schema dump
**with ACLs**, plus the committed migrations and the intended revoke. Building it needs a schema-only
dump of production, which is itself a production read that needs authorization.

Semantic equivalence does not prove byte identity of the SQL that was applied.

### 2.4 ACL / grant snapshot

```
psql "$PROD_READONLY_URL" -X -v ON_ERROR_STOP=1 -f scripts/release/grants-acl-check.sql > grants.out
```

### 2.5 API-log review

Run `scripts/release/api-log-queries.sql` Q1–Q5 in Logs Explorer, one day-slice at a time over the
full retention window. First confirm each field path in the Logs Explorer schema pane: the queries
have never been executed. Record each slice's start, end and row count, including zeros.

Zero hits do not prove that no consumer exists. Logs miss:

- direct-database clients;
- traffic outside the retention window;
- realtime deliveries;
- anything that has not run recently.

### 2.6 Applied-SQL text

The owner checks Supabase Dashboard → SQL Editor history and saved snippets for:

- the FIX3 run;
- the Phase-A revoke;
- the 2026-09-13 close_anon run.

Hash each recovered text with `sha256sum` and compare it with:

- FIX3: `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5`;
- close_anon: `62e2371990ee020d255c9415bf3a76a7063e64f874b42d92364d3d37a589fc82`.

The optional `pg_stat_statements` query is in `docs/release/applied-sql-equivalence.md`.

## 3. Owner decisions that no query answers

- Whether to add an explicit `REVOKE ALL … FROM PUBLIC, anon, authenticated` (plus a service_role
  grant) on the 10 RLS-only stack tables and the 4 FIX3 tables (matrix §4).
- Whether to record the Phase-A revoke as a migration, once its text is known.
- Confirmation that there are no out-of-repo consumers (BI, spreadsheets, Zapier, partner keys,
  manual SQL users) of the in-scope tables.
