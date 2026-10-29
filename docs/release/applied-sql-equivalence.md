# Applied-SQL equivalence — FIX3, the 8-table `authenticated` revoke, close_anon

Release-gate record (Agent B, 2026-10-29). Scope: what can be proven about the SQL
that was applied to production for three changes, and the read-only tooling that
can later compare production's catalog with an expected database.

**Semantic equivalence is not byte identity.** A matching catalog fingerprint
proves that the objects the fingerprint covers are in the same state. It does
not prove which SQL text produced that state, and it cannot see objects outside
its coverage.

## 1. Evidence searched (no production access was used)

| Source | Result |
|---|---|
| All 674 git refs (`git log --all`, `git rev-list --all --objects`) | FIX3 path: exactly **one** blob ever (`9f72e5ab`, sha256 `58192620…d445d5`). close_anon path: exactly **one** blob ever (`ba113cb0`, sha256 `62e23719…589fc82`). |
| `git stash list` (5 stashes) | None touch either migration or any Phase-A revoke. |
| `git log --all -G` for `REVOKE … FROM … authenticated` and for the 8 Phase-A table names in `*.sql/*.md/*.txt/*.sh` | No REVOKE naming any Phase-A table on any ref. |
| PR #239 (close_anon) and PR #318 (FIX3): issue comments, review comments | No comments on either PR (API count 0). |
| CI artifacts (2,810; names: auth-integrity-artifacts, governance-*, production-build-log, typecheck-certification-report, plugin) | None is a production-apply record. |
| `docs/**` (incl. `docs/security/FIX3_*`, issue register) | FIX3 hash provenance only (below). No REVOKE text for the 8 tables. |
| Other sessions' scratchpads (`%TEMP%/claude/**`) | FIX3: 3 full copies, all `58192620…`; two Oct-12 drafts (`P56/fix3_partA.sql` `985fbf09…`, `P58/A.sql` `66e9563d…`, 744/526 lines) are early partial drafts, not the 2,971-line migration. close_anon: only the rollback file. No file contains a REVOKE of a Phase-A table. The session that applied close_anon (`49da8415…`) has no scratchpad left. |
| Worktrees under `C:/tmp/*` and `C:/virality-lanes/*` | 59 copies of FIX3, all `58192620…`; 60 copies of close_anon, all `62e23719…`. No copy of the older `2ab29a6e…` variant exists anywhere on disk. |
| Shell history (`~/.bash_history`, PSReadLine `ConsoleHost_history.txt`; no psql history file exists) | No SQL line about either migration or the revoke. |
| Production ledger (read-only run 2026-10-28 23:49, `q1_ledger.out.json` sha256 `23c8bc0a…2f64e83`) | `20261026000000`, `20261212000000` (and `20261031000000`): `statements` NULL / 0. |

## 2. Per candidate

### FIX3 — `20261212000000_content_quality_collaboration_tenant_consistent.sql`

- **Applied SQL text: NOT FOUND.** No apply record, no ledger text (statements NULL; the ledger row was inserted by hand).
- Committed text: sha256 `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5`, the only version on any ref (f56572826, PR #318 head c02dc55d, merge e8ea5afd, origin/main).
- A historical variant `2ab29a6e…` exists only as a recorded hash (FIX3_ISSUE_REGISTER, Phases 90–97); it differs by comments only (non-comment sha256 `2da81396…` equal). No file with that hash survives.
- **Byte-for-byte equivalence: NOT established.** The original applied text is missing. Even if it were the committed file, FIX3 uses dynamic `EXECUTE` (9 sites) and CREATE-vs-RECONCILE branches (OD-11: `set_content_updated_at` vs `omnivyra_touch_updated_at`), so the same text can produce different end states on different starting catalogs. Hence a catalog comparison is the useful check.
- Reported separately by the owner (2026-10-28; not independently verified): the verifier `_fix3_tenant_consistent/verification.sql` returned no rows (structural checks only).

### 8-table `authenticated` revoke (brand_memory, content, content_asset, content_memory, content_originality, content_revision, content_variant, publication_lineage)

- **SQL text: NOT FOUND anywhere** — not on any git ref, stash, PR, CI artifact, doc, scratchpad, worktree or shell history. The only record is the owner's statement in memory note `project_fix3_verified_prod_20261028` ("authenticated revoked … service_role keeps CRUD").
- **Byte-for-byte equivalence: cannot be posed** — there is no committed SQL to compare against. Only the resulting catalog state can be checked.

### close_anon — `20261026000000_close_anon_rls_exposure.sql`

- **Applied SQL text: NOT FOUND** as a separate artifact. Applied 2026-09-13 21:03:48Z with `psql -1 -f` (memory `project_prod_rls_anon_exposure`); commit 5417d879 is 20:51:31Z the same day, i.e. before the apply; PR #239 merged 21:26:37Z. Ledger `statements` NULL.
- Committed text: sha256 `62e2371990ee020d255c9415bf3a76a7063e64f874b42d92364d3d37a589fc82`, the only version on any ref (PR head 5417d879, merge 2dc891c03, origin/main d51360b0).
- **Byte-for-byte equivalence: NOT established.** It is plausible that the applied file was the committed one (single version ever; commit precedes apply), but the working-tree file at apply time was never hashed. Mitigating evidence of the result, not the text: the migration self-verifies (step 7 aborts the transaction otherwise) and the post-apply verifier passed 23/23 with 214/214 anonymous REST refusals (memory).

## 3. Tooling (this branch)

| File | Purpose |
|---|---|
| `scripts/release/catalog-fingerprint.sql` | READ-ONLY catalog fingerprint (generated). |
| `scripts/release/catalog-fingerprint-build.js` | Generator; derives the close_anon object lists from the migration file itself. `--check` fails if stale. |
| `scripts/release/semantic-compare-catalog.js` | Compares two fingerprints; exit 0 equal / 1 semantic diff / 2 bad input. `--json`, `--role-map from=to`. |
| `backend/tests/unit/semanticCatalogCompare.test.ts` | 15 tests (comparator + generator drift + read-only shape). |

### Fingerprint coverage

Wrapper: `BEGIN TRANSACTION READ ONLY`, `statement_timeout 60s`, `lock_timeout 2s`, `idle_in_transaction_session_timeout 120s`, `search_path = pg_catalog, pg_temp` (all names schema-qualified), `ROLLBACK`. Catalog reads only; no temp objects. Output is one TAB-separated fact per line, sorted `COLLATE "C"`; no OIDs; owner only under property `owner`, and `<owner>` inside ACLs.

| Object set | Facts |
|---|---|
| close_anon: 177 tables, 29 owner-rights + 8 invoker views, 9 retargeted-policy tables, 4 public-read tables (derived from the migration) | exists, relkind, RLS + FORCE RLS, reloptions (security_invoker), owner, ACL per grantee incl. PUBLIC (NULL ACL expanded by `acldefault`), column ACLs, `has_table_privilege` × 7 privileges for anon / authenticated / service_role / PUBLIC, all policies (permissive, sorted roles, cmd, qual, with_check, md5), policy count |
| close_anon: the 11 retargeted `{public}` policies | presence + full policy facts above (roles show the retarget) |
| close_anon: 29 SECURITY DEFINER functions (by signature) | exists, `md5(pg_get_functiondef)`, prosecdef, volatility, leakproof, language, result type, proconfig, owner, proacl per grantee, `has_function_privilege` EXECUTE for the four roles |
| close_anon: steps 5b/6 | every `pg_default_acl` row exploded per grantee + row count; list of public tables where anon/authenticated hold TRUNCATE (expected `<none>`); count of public tables with RLS off |
| FIX3: content_quality, content_block, content_recommendation, content_approval_history, + content, user_company_roles | all relation facts above, plus columns (type, NOT NULL, default, identity, generated, collation; column order as noise), constraints (`pg_get_constraintdef`, validated, deferrable), indexes (`pg_get_indexdef`, valid/ready/live), triggers (`pg_get_triggerdef`, enabled) |
| FIX3: `set_content_updated_at()` and `omnivyra_touch_updated_at()` (both OD-11 variants) | function facts above; `exists=false` for the absent variant |
| revoke8: the 8 Phase-A tables | relation, ACL, effective-privilege and policy facts |
| Ledger (if `supabase_migrations.schema_migrations` exists) | presence, name, statement count, md5 of statements for 20261026000000 and 20261212000000 |

Not covered: data, sequences, other schemas, objects not listed, `auth.uid()` itself, grants made after the fact to other roles not in the four checked (they still appear in the ACL facts for covered objects).

### Comparator classification

- **semantic**: any added/removed/changed fact in rel (except owner / acl_is_default), acl, colacl, eff, policy, col, con, idx, trg, fn, fnacl, defacl, global.
- **noise**: `meta` (server version, read-only flag), `owner`, `acl_is_default`, `column_order`, ACL differences consisting only of `MAINTAIN` (PostgreSQL 17+).
- **info**: `ledger`, `scope`. A warning is raised if either side was not read-only or the candidate scope differs.

### Validation performed (disposable cluster 127.0.0.1:55441 only)

1. `w6_fp` fingerprinted twice: byte-identical outputs (4,184 facts, sha256 `73c23a73…f9a6e422`). `w6`, `w6_parity`, `postgres` data untouched.
2. `w6_fp_a`, `w6_fp_b` created `TEMPLATE w6_fp`; `w6_fp_a` fingerprint byte-identical to `w6_fp`.
3. `w6_fp_b` mutated (6 semantic + 1 noise change): GRANT SELECT, INSERT on `content` TO authenticated; ALTER POLICY `content_block_company_rw` USING (true); CREATE OR REPLACE `omnivyra_touch_updated_at()` body; DISABLE RLS on `feature_flags`; GRANT EXECUTE `security_get_secret(uuid)` TO anon; ALTER DEFAULT PRIVILEGES … GRANT SELECT ON TABLES TO anon; ALTER TABLE `content_quality` OWNER TO postgres.
4. Comparator a vs b: exit 1, **11 semantic** facts, all from the six mutations (ACL + effective privilege on content; policy qual + md5; function def_md5; relrowsecurity; fnacl + effective EXECUTE; defacl grant + row count; global rls_disabled_count) and **1 noise** (the owner change). a vs a: exit 0, nothing reported.
5. Both copies dropped.

Limitation: `w6_fp` is not a production-shaped ACL baseline (no service_role grants on most tables), so it validates the tooling, not production expectations.

## 4. Later read-only production commands (require separate authorization)

Run as a read-only-capable role, from a clean checkout of this commit, never echoing the connection string:

```sh
node scripts/release/catalog-fingerprint-build.js --check
psql "$PROD_READONLY_URL" -X -v ON_ERROR_STOP=1 -f scripts/release/catalog-fingerprint.sql > prod.tsv
grep -P '^meta\tsession\ttransaction_read_only\ton$' prod.tsv   # must match
```

Expected side: apply origin/main migrations to a disposable database restored from a production-shaped schema-only dump **with ACLs** (roles anon/authenticated/service_role/postgres present), then the 8-table revoke as intended, then:

```sh
psql "$DISPOSABLE_URL" -X -v ON_ERROR_STOP=1 -f scripts/release/catalog-fingerprint.sql > expected.tsv
node scripts/release/semantic-compare-catalog.js expected.tsv prod.tsv --role-map <expected_owner>=<prod_owner>
```

Optional read-only text evidence, if `pg_stat_statements` is installed. Use `scripts/release/pg-stat-statements-probe.sql`, which first checks visibility: without `pg_read_all_stats` (or running as `postgres`) other users' query text is hidden and the probe prints NOT INSPECTABLE — never "absent" (the raw query below would silently match nothing). (utility statements such as `DO` blocks may be retained verbatim if `track_utility` is on; eviction may have removed them):

```sql
BEGIN TRANSACTION READ ONLY;
SELECT md5(query), length(query), calls
  FROM extensions.pg_stat_statements
 WHERE query LIKE '%close_anon_rls_exposure%' OR query LIKE '%FIX3-%'
    OR (query ILIKE '%revoke%' AND query ILIKE '%authenticated%' AND query ILIKE '%brand_memory%');
ROLLBACK;
```

A match of an md5 with the md5 of the corresponding statement in the committed file would be per-statement byte evidence; absence proves nothing.

## 5. Smallest step to close each gap

| Candidate | Gap | Smallest closing step |
|---|---|---|
| FIX3 | applied text missing; state unverified | Owner checks Supabase Dashboard → SQL Editor history/snippets for the run (the verifier's "Success. No rows returned" is SQL-Editor output) and saves the text; sha256 it against `58192620…`. Independently, run the production fingerprint and compare. |
| revoke8 | SQL never recorded anywhere | Owner recovers the statement from SQL Editor history and commits it as a documented, idempotent migration (or records it in docs); the fingerprint `acl`/`eff` facts for the 8 tables verify the resulting state. |
| close_anon | apply-time file never hashed | Run the production fingerprint against an expected database; for text, the `pg_stat_statements` query above. If neither yields text, record byte equivalence as permanently unprovable and rely on semantic equivalence plus the 2026-09-13 verifier results. |
