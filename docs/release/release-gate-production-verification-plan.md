# Release gate: production verification handoff (read-only)

## Scope

Release branch `feat/orchestration-engine-adapters`, rebased onto `main` `c4e4e9bb`.

**`main` has since moved.** It is now at `acde8b7a` (PR #350, merged 2026-10-29 04:29Z). That PR
changes three files that do not overlap with this branch, and `git merge-tree` reports no conflict.
Before any production session, rebase onto the current `main` (which needs its own authorization),
re-run the gates, and record the new SHAs here.

Stack migrations: `20261127000000` and `20261226000000` … `20261231000010`.

The gate also covers three earlier changes that are already in production:

- FIX3 `20261212000000`;
- the out-of-repo revoke of `authenticated` on the 8 Phase-A content tables;
- `close_anon` `20261026000000` (#239).

## Status

**NO-GO.** Nothing here has been run against production.

All tooling was tested only on a disposable PostgreSQL 17.6 cluster. That proves the tooling works, but
not what production contains. Running this handoff needs separate, explicit authorization from the owner.

## References

- `docs/release/orchestration-engine-adapters-migration-runbook.md`: preflight P0–P13, apply order, rollback.
- `docs/release/grants-consumer-matrix.md`: object matrix, consumer trace, facts P1–P9.
- `docs/release/applied-sql-equivalence.md`: per-candidate SQL evidence.
- `docs/release/sql-recovery-checklist.md`: owner checklist for B0.

## 0. Access to grant (and nothing else)

| # | Access | Used by | Notes |
|---|---|---|---|
| 1 | A **fresh** read-only PostgreSQL credential (§0.1) | A, B1, C1 | Never reuse the stale pooler password from `.env.local`: retries risk a lockout. |
| 2 | Supabase **Logs Explorer** read access, or Management API analytics read | C2 | A separate grant from the database role. |
| 3 | The owner's **SQL Editor history and saved snippets** | B0 | Only the owner can read these. |
| 4 | *(Optional)* `pg_read_all_stats` for the credential, or the owner running the probe as `postgres` | B0 | Without it, `pg_stat_statements` text is hidden, and the probe reports NOT INSPECTABLE. |

**Workstation rules.** These apply to every step.

- **Checkout:** use a clean checkout of the exact release commit, with `node_modules` already present.
  The verifier needs only `pg`. Do not run npm or npx.
- **No `.env.local` in the working directory.** If one is there, the verifier could take a URL from it.
- **Separate variables for the two tools:**
  - give the verifier its credential through `SCHEMA_PARITY_DB_URL`, which overrides every other
    variable and stops `.env.local` from being read;
  - give psql its connection through `PROD_READONLY_URL` plus `PGPASSWORD` (or `.pgpass`), never as a
    password inside the URL. psql prints the whole password on stderr if the URL has a malformed `%`
    escape.
- **Password:** alphanumeric, 32 characters or more.
- **TLS:** use `sslmode=verify-full&sslrootcert=<Supabase CA file>` for psql. The node verifier's
  `pg-connection-string` treats `require`/`prefer`/`verify-ca` as verify-full against Node's CA store,
  which fails closed (exit 2). Pass the CA explicitly.
- **Records:**
  - save every stdout with its UTC timestamp, the release SHA and the script hashes (§4);
  - never paste stderr anywhere;
  - a check that errors, times out, or returns no rows where rows are expected is **BLOCKED**, never PASS.

### 0.1 Issuing the credential (owner; a production write that needs its own authorization)

Run as `postgres`:

```
CREATE ROLE release_gate_ro LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  INHERIT CONNECTION LIMIT 3 VALID UNTIL '2026-MM-DD 23:59:59+00';   -- a real timestamp; INHERIT is required
ALTER ROLE release_gate_ro SET default_transaction_read_only = on;
GRANT pg_read_all_data TO release_gate_ro;
```

**If the GRANT is refused, STOP.** On PG16+, granting `pg_read_all_data` needs ADMIN on that role,
and Supabase's `postgres` is not a superuser. The fallback is explicit `GRANT USAGE` / `SELECT ON ALL
TABLES` grants. Those change the ACL of every table, so they need an owner decision. If used:

- `release_gate_ro` must be excluded from C1 and B1;
- the grants must be revoked before the role is dropped.

**Password.**

- In psql, use `\password release_gate_ro`.
- The dashboard SQL Editor has no `\password` command. There, use `ALTER ROLE … PASSWORD '<SCRAM-SHA-256
  verifier computed offline>'`. Never type a plaintext password into the editor, because its history
  keeps it.
- Hand the password over out of band.

**Teardown (owner, after the session).** `VALID UNTIL` does not end sessions that are already open, so:

1. `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'release_gate_ro';`
2. `DROP OWNED BY release_gate_ro;`
3. Revoke the fallback grants, if any were used.
4. `DROP ROLE release_gate_ro;`

**What "read-only" means here.**

- `default_transaction_read_only` is only a default. Any session can turn it off.
- The real guarantees are the ones the self-check enforces:
  - no writable tables;
  - no role membership other than `pg_read_all_data`;
  - no superuser, BYPASSRLS or CREATE.
- A session that turns the default off could still create a TEMP table, call `lo_create`, or execute a
  PUBLIC-executable SECURITY DEFINER function. The procedural safeguard is that only the fixed scripts
  below are run.

### 0.2 Step 0: credential self-check (always first)

```
psql "$PROD_READONLY_URL" -X -v ON_ERROR_STOP=1 -f scripts/release/session-readiness-check.sql > session-check.out
```

**STOP if any of these is true:**

- the exit code is non-zero. The script deliberately exits 3 when any check FAILs.
- the `overall` row is not `0 FAIL | OK`;
- `role.name` is not the issued role;
- any membership other than `pg_read_all_data` is listed.

**What it verifies:**

| Area | Check |
|---|---|
| Read-only | Read-only **before** the script's own transaction (session and role setting); fails on a missing role setting or a session that turned it off |
| Role attributes | Not superuser; no BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION |
| Memberships | None except `pg_read_all_data`, walked directly in `pg_auth_members`. Includes SET-only, NOINHERIT, ADMIN-only and nested memberships, which `has_table_privilege` cannot see but `SET ROLE` can use. |
| Write surface | Zero writable tables; zero schemas with CREATE |
| Visibility | USAGE on `public`; no public relation whose columns are hidden from `information_schema` (the cause of false "missing" parity findings) |
| Ledger and roles | The ledger exists and is readable; `anon`, `authenticated` and `service_role` exist |

**Possible false FAIL.** Check 31 (schemas with CREATE) can FAIL falsely if a schema grants CREATE to
PUBLIC, which is possible on a project upgraded from PG ≤ 14. That is an owner decision; never waive it
silently.

The self-check cannot verify that the password is fresh. The owner attests to that.

**Validation (disposable cluster only, real LOGIN roles):**

- a correct read-only role exits 0;
- each of these exits 3: SET-only writer membership, ADMIN-only membership, nested membership, missing
  read-only default, writer, `pg_write_all_data` member, visibility-limited role, superuser.

Unit contract: `backend/tests/unit/sessionReadinessCheck.test.ts`. Failure counts depend on the role
and are not fixed numbers.

## A. Schema parity

### A1: migration preflight (runbook §3.2–3.3; READ ONLY transaction, ROLLBACK)

```
node scripts/release/runbook-preflight-build.js docs/release/orchestration-engine-adapters-migration-runbook.md preflight.sql
sha256sum preflight.sql    # must be 61fcb70afbc9066cd1df1cdb6eec4620116a40a2b0359cd7afab3f8f2905bdcb, and the builder must print "sql blocks: 16"
psql "$PROD_READONLY_URL" -X -v ON_ERROR_STOP=1 -f preflight.sql > preflight.out
```

Two blocks print under `=== P11 / P11b ===`; the second is the competing-list-table check. **STOP if:**

- the exit code is non-zero, or the run times out;
- P0: `in_recovery` is not `f`, or fewer than 3 roles are present;
- P11/P11b does not return `t,2,17,3,2`;
- the competing-table check is not `t`;
- any stack object other than the `20261127000000` pair is present (a partial apply);
- any result shape differs from the runbook.

### A2: strict parity, verifier only

**Do not run `predeploy-check.js` in this session.** It fetches from GitHub, requires HEAD to equal
`origin/main`, runs `npx tsc`, and reads `.env.local`. Its parity step is exactly the command below.
Leave the full predeploy for the deploy step after the merge.

Run in a subshell with a scrubbed environment, from the repo root:

```
SCHEMA_PARITY_DB_URL="$PROD_READONLY_URL" SUPABASE_URL=http://unused.invalid SUPABASE_SERVICE_ROLE_KEY=unused \
  node scripts/verify-schema-parity.js --strict > parity-baseline.json 2> parity-baseline.stderr; echo "exit=$?"
```

After connecting, the verifier also does the following:

- forces `default_transaction_read_only=on`, sets timeouts, and records `session.role` and
  `session.tx_read_only` in its JSON. Confirm both.
- fails closed with exit 2 on a credential or connection problem. Do not retry repeatedly.
- blocks (`check_skipped`) if a check cannot run.
- never prints the password; this was tested with a sentinel password.

**What it covers for the stack:**

- 18 tables and their 208 columns, plus 5 column types;
- 45 indexes: 18 unique (BLOCKING) and 27 for query plans (WARN);
- 27 functions: existence, SECURITY DEFINER, and body markers;
- 17 triggers and 7 CHECK vocabularies;
- RLS;
- privileges:
  - anon holding anything on a stack table is BLOCKING;
  - on the 8 explicitly revoked tables, `authenticated` holding anything is BLOCKING;
  - only service_role may execute the 3 SECURITY DEFINER RPCs.

**Two runs with different meanings:**

| Run | When | Expected result |
|---|---|---|
| A-baseline | before any stack migration | Exit 1. Missing columns are BLOCKING on the 18 stack tables (206 columns) and on the 7 columns added to existing tables. Functions, triggers, CHECKs and unique indexes are absent (BLOCKING). `reap_community_ai_action_leases` exists, so expect a body-marker finding (legacy body) rather than "absent". `community_ai_actions_status_check` lacks `uncertain`. The pre-existing items listed below are also expected. Exit 0 or 3 here means the stack is already present: STOP and reconcile with preflight P2. Any `check_skipped` finding, or an anon privilege on a table that already exists, means STOP. |
| A-post | after `…000009` is applied, and again after `…000010` | Must meet the pass condition below. |

**Pre-existing items expected to keep strict mode at exit 3.** On the disposable database rebuilt at the
release tree, the run found 0 stack findings and 0 BLOCKING. It still exited 3 because of:

- 8 WARN and 16 INFO for manifest columns on `active_leads` (15 of them), `opportunity_feed_items`,
  `content_performance`, `learning_intelligence`, `learning_memory` and `content_prediction`;
- a ledger desync.

A limited read-only login and a superuser produced byte-identical results. Production has a desynced
ledger and a legacy table occupying `active_leads`, so expect these items there too. The owner must sign
off a written list of them.

**PASS for A** (A-post run on production) requires all of the following:

- `severity.blocking` = 0;
- `structural_findings` is empty;
- no `missing_columns` entry on any stack table;
- `session.tx_read_only` = `on`;
- every remaining WARN or INFO item, and the ledger desync, is matched one-for-one to the A-baseline list
  and accepted by the owner.

A new item not on the baseline list is a FAIL.

## B. Applied-SQL equivalence

### B0: recover the executed text (owner)

Follow `docs/release/sql-recovery-checklist.md`. It covers time windows, search strings, every place to
search, byte-exact export, and the metadata to record. Then run, once per exported file:

```
node scripts/release/recovery-intake.js <fix3|close_anon|revoke8> <file> --source "<list> / <name>" \
  --observed-at "<displayed timestamp + tz>" --exported-at "<UTC>" --out <file>.intake.json
```

The verdict is one of the following:

| Verdict | Meaning |
|---|---|
| `BYTE_IDENTICAL` | identical bytes |
| `IDENTICAL_AFTER_EOL_NORMALIZATION` | identical after line-ending normalization; the realistic best case for a clipboard export |
| `DIFFERENT` | differing lines are listed |
| `NO_REFERENCE_TEXT` | the revoke8 case: the recovered file becomes the record |

Rules:

- The tool never assesses semantic equivalence.
- Never reconstruct a missing text.
- A candidate with nothing recovered is recorded as **UNRECOVERABLE: exact equivalence unprovable from
  available evidence**.
- close_anon was applied with `psql -1 -f` on 2026-09-13, so an SQL Editor hit for it is unlikely.

**Optional statement-text probe.** Run this as `postgres`, or with `pg_read_all_stats`:

```
psql "$PROD_READONLY_URL" -X -v ON_ERROR_STOP=1 -f scripts/release/pg-stat-statements-probe.sql > pgss.out
```

If the probe prints `NOT INSPECTABLE`, the text could not be seen. That is never evidence that the
statement is absent. Entries are also evicted, and reset by a restart or upgrade.

### B1: production catalog fingerprint

```
node scripts/release/catalog-fingerprint-build.js --check
psql "$PROD_READONLY_URL" -X -v ON_ERROR_STOP=1 -f scripts/release/catalog-fingerprint.sql > prod.tsv
```

**What it covers:**

- the close_anon, FIX3 and revoke8 objects, in format `catalog-fingerprint/2`;
- ACLs, effective privileges (including MAINTAIN on PG17), RLS, policies, owners, function bodies, and
  view-definition hashes;
- publication membership;
- default privileges for `postgres` and `supabase_admin`.

**What it does not cover:** the stack and PR #349 objects. Those are covered by A2 and C1.

The `meta transaction_read_only` line is always `on`, because the script wraps itself in a READ ONLY
transaction. The read-only proof is Step 0, not this line.

If the credential lacks visibility, the script stops with an error; it never produces partial output.

### B2: expected database (disposable only) and comparison

Build the expected database in this order:

1. Start a fresh PostgreSQL 17.x cluster. Production is 17.6.
2. As a superuser, run `scripts/ci/schema-bootstrap.sql`.
   - Make sure a role named **`postgres`** exists and can create objects in `public`.
   - Every later step runs as `postgres`. Otherwise close_anon's `ALTER DEFAULT PRIVILEGES FOR ROLE
     postgres` affects nothing.
3. As `postgres`, install Supabase's **original** default privileges **before** restoring the baseline:
   ```
   GRANT ALL ON TABLES / SEQUENCES / FUNCTIONS TO anon, authenticated, service_role   (ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public …)
   ```
   - Derive these as production C1 S08 plus the inverse of close_anon step 6.
   - Do **not** seed S08 verbatim. It is the post-close_anon state, and seeding it would make the
     default-privilege comparison equal by construction.
   - Record any S08 row this does not explain as drift.
4. Restore `supabase/_schema/baseline.sql`. It has no ACLs and no owners, so every ACL comes from step 3.
5. Replay, in version order, every migration newer than `20260916000000` through the release base,
   including PR #349's `20261223000000/01`. Include stack files only if A-post shows them applied.
   Reason: `20261231000005` replaces `reap_community_ai_action_leases()`, one of the fingerprinted
   close_anon functions.
6. Apply the 8-table revoke:
   - if B0 recovered it, apply the text **verbatim**;
   - otherwise apply `REVOKE ALL ON <8 tables> FROM authenticated;`, labelled **HYPOTHESIS**. A B2 result
     built this way tests an assumption. It does not prove equivalence.
7. Run the fingerprint and C1 on the expected database.

Then compare:

```
psql "$EXPECTED_DISPOSABLE_URL" -X -v ON_ERROR_STOP=1 -f scripts/release/catalog-fingerprint.sql > expected.tsv
node scripts/release/semantic-compare-catalog.js expected.tsv prod.tsv --json > compare.json
# only if production objects are owned by supabase_admin and the owner accepts the equivalence in writing:
#   add  --owner-map postgres=supabase_admin
```

**How the comparator classifies differences:**

- Semantic (exit 1): owner changes, MAINTAIN grants to non-owners, ACLs, RLS, policies, function and view
  bodies, and publication membership of in-scope tables.
- `--owner-map` is the only way to declare two owners equivalent, and it prints a warning.
- `--role-map` (and `-left` / `-right`) rewrites only role positions. It refuses API roles, PUBLIC and
  merges, and lists every rewrite. Do not use it without an owner-approved reason.

**Unavoidable environment noise.** List every item and accept it in writing; nothing is suppressed
automatically.

| # | Source |
|---|---|
| N1 | Supabase-managed owners (`supabase_admin`) |
| N2 | Explicit GRANTs or REVOKEs made in production before 2026-08-13, or out of repo |
| N3 | Apply order: close_anon ran on 2026-09-13 but replays by version; FIX3 CREATE-vs-RECONCILE branch names |
| N4 | Tables created out of band |
| N5 | Other Supabase-managed default privileges (reported as `info`) |
| N6 | Ledger statements are NULL |
| N7 | Server version |

**Catalog equivalence establishes current semantic equivalence only. It cannot reconstruct or prove the
historical SQL byte-for-byte.** Only B0 can do that.

**PASS for B**, per candidate:

- B0 recorded (RECOVERED with an intake verdict, or UNRECOVERABLE);
- B2 exits 0, or every semantic difference is matched to N1–N7 and accepted by the owner in writing;
- if revoke8 used the HYPOTHESIS text, the result says so.

Historical byte equivalence that stays unprovable needs an explicit owner-approved acceptance criterion.
Without one, B cannot pass.

## C. Grants and external consumers

### C1: ACL, grant, RLS, policy, publication and dependency snapshot (READ ONLY, ROLLBACK)

```
psql "$PROD_READONLY_URL" -X -A -F $'\t' -v ON_ERROR_STOP=1 -f scripts/release/grants-acl-check.sql > grants.tsv
psql "$EXPECTED_DISPOSABLE_URL" -X -A -F $'\t' -v ON_ERROR_STOP=1 -f scripts/release/grants-acl-check.sql > expected-grants.tsv
diff expected-grants.tsv grants.tsv > grants.diff
```

The output is deterministic: the search path is pinned and every row is sorted. It covers all four
scopes: FIX3 plus the revoke, close_anon (177 tables, 37 views, 29 functions), the stack, and PR #349.

| Section | Contents |
|---|---|
| S01 | Roles. Includes memberships **held by** API roles (inherit/set/admin options) and every LOGIN role, the candidates for direct-database consumers. |
| S02–S05 | Relations, ACLs, effective privileges, column ACLs |
| S06 | Policies |
| S07 | Functions |
| S08 | Default privileges |
| S09 | Publications |
| S12 | Views and policies that depend on in-scope tables |

Filter `release_gate_ro` out of S01 and S03.

**Expected anon privileges per scope.** These replace "no anon privilege anywhere":

| Scope | Expected anon privileges |
|---|---|
| close_anon's 177 tables and 9 retargeted tables, its 37 views, the 4 FIX3 tables, the 18 stack tables, the 2 PR #349 tables | none |
| close_anon's 4 public-read tables (`blog_relationships`, `blog_series`, `blog_series_posts`, `content_type`) | SELECT, plus MAINTAIN on PG17; step 5's REVOKE list omits MAINTAIN, which the owner must review |
| the 8 Phase-A tables | recorded as found, then accepted or remediated by the owner |

The repo suggests anon may still hold DML on the 8 Phase-A tables. They predate close_anon and are in no
close_anon array. This is a prediction; only C1 can confirm it.

### C2: API logs (Logs Explorer; separate authorization)

Run `scripts/release/api-log-queries.sql` Q1–Q5b one slice at a time across the **full available
retention window**.

- **Slice bounds:** fill in `<SLICE_START_ISO>` / `<SLICE_END_ISO>` in each query. A slice cannot run
  until they are filled in.
- **Field paths:** confirm each one in the schema pane first. These include `request.search` and the
  key-type fields. The queries have never been executed.
- **Record** each slice's start, end, status and row count, including zeros.

Coverage:

- REST paths, and embedded resources through the query string;
- RPC, GraphQL and realtime;
- Postgres permission errors;
- direct logins (Q5b), which return rows only when `log_connections` is on. Record that setting.

A NULL key role is classified **unknown-key**, never anon or service_role. The server's `sb_secret_…`
key is not a JWT.

**Zero hits do not prove there are no consumers.** The logs miss:

- direct-database clients when `log_connections` is off;
- BI tools;
- anything outside the retention window;
- realtime deliveries;
- jobs that have not run recently.

### C3: realtime

- S09 must show that no in-scope table is in `supabase_realtime`.
- Optionally, count live subscriptions per entity in `realtime.subscription` (names and counts only).
  Never select `claims`.
- From the repo, `credit_transactions` is the only table the app subscribes to
  (`lib/swr/creditsRealtime.ts`).

### C4: owner confirmation, in writing

The owner confirms that none of the following use the 10 RLS-only stack tables, the 4 FIX3 tables or the
8 Phase-A tables:

- external integrations (Zapier, partner keys);
- direct database clients (psql users, scripts, workers outside this repo);
- BI tools or spreadsheets.

Nothing in the repo or the catalog can prove they are absent.

### Owner decisions (nothing implemented; grants and policies unchanged)

| Decision | Options | Evidence needed first |
|---|---|---|
| Explicit `REVOKE ALL … FROM PUBLIC, anon, authenticated` plus a service_role grant on the 10 RLS-only stack tables (`prospect_lists`, `prospect_list_members`, `prospect_campaigns`, `workflows`, `workflow_versions`, `execution_instances`, `execution_plans`, `execution_plan_steps`, `execution_tasks`, `outreach_bridge_handoffs`); optionally retarget their 6 `auth.role()` policies | new migration / leave RLS-only | C1, C2, C3, C4 |
| The same for the 4 FIX3 tables (`content_quality`, `content_block`, `content_recommendation`, `content_approval_history`) | decided separately | C1–C4; S12 dependencies |
| Record the 8-table revoke as an idempotent migration | from B0 text / from C1 ACLs | B0, then C1 |
| Anon state of the 4 public-read tables (SELECT plus MAINTAIN) and the 8 Phase-A tables | accept / remediate | C1 |

Do not revoke client access to `user_company_roles`. More than 20 policies, including FIX3's, read it.

**PASS for C** requires:

- C1 recorded and matching the per-scope expected anon state;
- C2 run across the full retention window, with every non-service_role or unknown-key hit explained;
- C3 clean;
- C4 confirmed by the owner.

## Not covered by any check

- **Extension assertions: 13 remain UNVERIFIED.** They are 6 + 6 + 1 in the extension-source suites, which
  skip when `OMNIVYRA_EXTENSION_ROOT` is unset. The 14th skipped test is the probe that checks the skip
  mechanism itself. CI never sets the root.
- **The community-link block is data-gated.** No writer produces verified identity evidence. The DB guard
  checks only the shape of the evidence JSON.
- **Deploy-time steps live in the runbook.** These are apply order, the deploy sequence, and rollback. The
  deploy sequence is web and worker together with an identical `ENCRYPTION_KEY`, then `…000010`, then
  `VACUUM FULL rpa_sessions`. Each step needs its own authorization.

## 4. Script identities

Record these hashes in the session. They are sha256 values at this commit.

| Script | sha256 |
|---|---|
| `scripts/verify-schema-parity.js` | `c14270aba69256bdd66f4d9d1fd250a12445258aa506d907fbfaf7c2020d0820` |
| `scripts/release/session-readiness-check.sql` | `68c99d6324d54a2d5ba1780105f315f2b4298c1ac0644c4e8b08e295f3a1fd10` |
| `scripts/release/runbook-preflight-build.js` | `03b839668a94cf2afaaac317308bed9371b331c54a47fb94d08d81ecfa39cda6` |
| generated `preflight.sql` | `61fcb70afbc9066cd1df1cdb6eec4620116a40a2b0359cd7afab3f8f2905bdcb` |

The full list is in the release report. Any mismatch means STOP.
