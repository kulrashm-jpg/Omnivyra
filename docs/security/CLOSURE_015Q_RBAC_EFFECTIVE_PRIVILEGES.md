# CLOSURE-015Q — RBAC effective privileges and the deferred contract step

**Status: LOCAL, UNCOMMITTED.**
- **Untracked:** this report, the deferred step and its rollback (rewritten), and the new real-Postgres suite.
- **Modified, tracked:** one static unit test.
- **Not touched:** committed migration history (no migration was modified; 0003 untouched) and production.
- **Read-only:** the certification database, which is byte-identical to its state at the start of this phase (§6).
- **Not done:** no push, PR, merge or deploy.

## 1. Baseline

| Item | Value |
|---|---|
| Worktree / branch / HEAD | `C:/tmp/closure-014a` / `integration/closure-014a` / `4301771a158665e261cc00dbdb9fe253790baebd` (as expected) |
| Tree at start | 0 staged, 0 tracked changes; untracked: the 015P report (`38bc732d…`), the deferred step (`f0b4b8e0…`), its rollback (`55a14e8b…`), the 015N proposal 05 (`b39ffc49…`). Pre-change copies were saved to the scratchpad. |
| Branch operations | none (no reset, clean, stash, amend, rebase or history rewrite) |

## 2. F-1: cause and effective grants (measured, not inferred)

The privilege matrix (`has_table_privilege` / `has_sequence_privilege` / `has_any_column_privilege` for every role, plus ACLs, default ACLs, role graph, RLS and the function) was run on the **certification DB** inside `BEGIN READ ONLY`. It was then reproduced on an isolated copy (§4).

**`public.rbac_config` on cert, before this phase:**

| Role | SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER | MAINTAIN |
|---|---|---|---|---|---|---|---|---|
| **service_role** | Y | Y | **Y** | **Y** | **Y** | **Y** | **Y** | **Y** |
| authenticated / anon / authenticator / PUBLIC | – | – | – | – | – | – | – | – |
| postgres (owner), supabase_admin (superuser) | all | all | all | all | all | all | all | all |
| pg_read_all_data, supabase_etl_admin, supabase_read_only_user | Y | – | – | – | – | – | – | – |
| pg_write_all_data (predefined; **0 members**) | – | Y | Y | Y | – | – | – | – |

**Identity sequence `public.rbac_config_version_seq`:** `rwU` (USAGE, SELECT, UPDATE = `setval`) for **service_role and authenticated**.

**Clean:**
- no column ACLs;
- no members of `pg_write_all_data` or `pg_maintain`;
- authenticator's memberships in anon, authenticated and service_role are **NOINHERIT**, so it holds nothing itself;
- no application role has CREATE on `public`;
- RLS is enabled, with 0 policies.

**Cause:**
1. When `postgres` creates tables and sequences in `public`, the hosted default privileges grant service_role ALL (`arwdDxtm`). They also grant authenticated `arwdxtm` on tables and `rwU` on sequences.
2. `20261210000003` revokes PUBLIC, anon and authenticated on the **table**, and *grants* service_role SELECT, INSERT. It never revokes service_role's default ALL, and it never touches the **sequence**.
3. Throwaway replays of `baseline.sql` have no default privileges, which is why 015L–015P always showed `service_role=ar`.

**What the old deferred step would have left.** `REVOKE INSERT, UPDATE, DELETE` would have left TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on the table, and every sequence privilege. This was proven: mutant C01 is the old step, verbatim, and the suite kills it (§5).

## 3. Verified runtime path and the privileges it needs

| Operation | Code | Database role | Statement | Privilege needed |
|---|---|---|---|---|
| Read the config | `rbacService.getRbacConfig` (`ownedDbTable('rbac_config').select`) | **service_role**: supabase-js with the server secret key → PostgREST → `SET ROLE service_role`; BYPASSRLS | direct SELECT | **SELECT** |
| Read the version (stale-edit token) | `getRbacConfigVersion` | service_role | direct SELECT | **SELECT** |
| Save (versioned) | `saveRbacConfig` → `supabase.rpc('save_rbac_config')` | service_role calls; the **body runs as the owner `postgres`** (SECURITY DEFINER, `search_path=public`) | INSERT + identity `nextval`, as owner | **EXECUTE** only (granted by 0003) |
| Repair / recovery (untrusted stored document) | the same `POST /api/super-admin/rbac` → `saveRbacConfig` (requireCapability + step-up) | as save | a new head version supersedes the bad one | EXECUTE |
| Legacy fallback | the `.insert()` branch, only on PGRST202 (function missing) | service_role | direct INSERT | INSERT; **unreachable after the step**, whose precondition requires the function |

- **Surface:** the only runtime files touching `rbac_config` are `backend/services/rbacService.ts` and `pages/api/super-admin/rbac.ts`. The route has only GET and POST. No direct-pg runtime path and no other route, worker or script writes it.
- **Effect of revoking direct writes:** it does **not** break saves, reads, repair or recovery. This was proven under the actual role (§5.2) and end to end through PostgREST with the real `rbacService` (§5.3).
- **Legacy INSERT and the sequence:** the legacy direct INSERT needs **no** sequence privilege. The identity column draws its value internally (proven after rollback, §5.2).

## 4. Test database: identity and isolation

Destructive suites were **never** run against `cert-supabase`. They ran on an isolated, Supabase-faithful copy.

| Item | Evidence |
|---|---|
| Containers | `c15q-db` (`public.ecr.aws/supabase/postgres:17.6.1.167`, **the image cert runs**), id `9219bac4f896…`; `c15q-rest` (`public.ecr.aws/supabase/postgrest:v16.2`, **cert's PostgREST image**). Label `purpose=closure015q-throwaway`, `restart=no`, 0 mounts (data in the writable layer). |
| Network | its own bridge network `c15q-net`; only `127.0.0.1:55436` (DB) and `127.0.0.1:55437` (REST) are published. Never on `supabase_network_cert-supabase` (asserted). |
| Identity | `system_identifier=7697232225371050041` (cert: `7684462104593874982`). Re-verified (id, label, sysid, network) before every database operation. |
| Secrets | a fresh random DB password and JWT secret, generated for the throwaway, kept in the scratchpad, never printed, absent from every artifact, deleted at cleanup. The service_role and authenticated JWTs were signed locally with the throwaway secret. **No existing credential was read or used.** |
| Copy | a read-only `pg_dump -n public -n supabase_migrations` of cert (schema, data, ACLs) restored into `c15q-db`: 839 tables (= cert), ledger 0001–0004, same row counts. 20 expected restore errors: 12 `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` (not permitted for postgres), 7 policies on `extension_*` tables that need GoTrue's `auth.jwt()`, and `schema public already exists`. |
| **Privilege fidelity** | the restore alone was **not** faithful. The target's default privileges added anon/authenticated grants at CREATE time, e.g. EXECUTE on `save_rbac_config`. An ACL sync then mirrored cert's exact ACLs onto the copy with GRANT/REVOKE: tables, views, sequences and functions in `public` and `supabase_migrations` (1042 objects), plus postgres's default privileges. After it, **0 semantic differences**, and the effective-privilege matrix (23 lines) is **identical to cert's**. |

## 5. Test results (all on the isolated copy)

### 5.1 Contract application

| Check | Result |
|---|---|
| Apply (psql, `ON_ERROR_STOP`) | exit 0 |
| Re-apply | exit 0; matrix unchanged (idempotent) |
| **service_role, table** | before: S I U D T R Tr M → after: **SELECT only** |
| service_role / authenticated, sequence | `rwU` → **none** |
| column-level writes, app roles | `service_role:INSERT,UPDATE,REFERENCES` → **none** |
| anon / authenticated / authenticator / PUBLIC, table | none → none |

### 5.2 New suite: `backend/tests/realschema/closure015q_rbac_contract_privileges.test.ts` (23 tests)

**Results:** **23/23 ×3**, run on the final test file.

**Negative control** (cert's pre-contract state, with the old step): **15 failed / 8 passed**. Every privilege and denial assertion fails. The 8 that pass are the governed-path tests, which must pass in both states.

**What it covers:**
- **Effective privileges:**
  - service_role holds exactly SELECT; the other application roles and PUBLIC hold nothing;
  - no column-level writes remain;
  - **no non-owner, non-superuser role** can write the table or use or reset the sequence, including through inheritance;
  - the function is still SECURITY DEFINER, with a non-application owner and EXECUTE for service_role only.
- **Denied as service_role (42501):**
  - INSERT, UPDATE, DELETE, TRUNCATE;
  - `LOCK … ACCESS EXCLUSIVE` (proves UPDATE, DELETE, TRUNCATE and MAINTAIN are all absent);
  - `CREATE TRIGGER`;
  - `setval` and `nextval`.

  authenticated and anon cannot read.
- **Governed path under the actual role:**
  - the first save creates v1, and reads see it;
  - a stale save gets `RBAC_CONFIG_STALE` with DETAIL = head;
  - a fresh save advances the version;
  - **of two concurrent saves of the same version, exactly one wins** (advisory lock);
  - **repair:** a governed save supersedes an untrusted stored document;
  - authenticated and anon cannot EXECUTE.
- **Post-conditions abort the whole step** (nothing changes) when:
  - an unrelated role holds direct UPDATE;
  - a role holds TRUNCATE **inherited** through membership;
  - (precondition) service_role cannot EXECUTE the save function.
- **Rollback:**
  - it re-opens **only** INSERT (`['INSERT','SELECT']`) and no sequence privilege;
  - a legacy INSERT gets an identity version;
  - UPDATE, DELETE and TRUNCATE stay denied;
  - the governed save still works;
  - it is repeatable: rollback ×2, then the contract again restores the exact ACL, and the contract once more is a no-op.

### 5.3 End-to-end runtime: the real `rbacService` → PostgREST v16.2 → DB

A throwaway service_role JWT, the same path as production's server key. A local proxy maps `/rest/v1` the way Kong does.

| Step | Contract state | Cert's pre-contract state (contrast) |
|---|---|---|
| `saveRbacConfig(expected=null)` | v1 | v1 |
| `getRbacConfigVersion` / `getRbacConfig` | v1 / 6 roles, 11 permission keys | same |
| stale save | `RbacConfigStaleError` | same |
| `saveRbacConfig(expected=v1)` | v2 | v2 |
| PostgREST direct INSERT / UPDATE / DELETE as service_role | **42501** ×3 | **ALLOWED** ×3 (the head was overwritten by a legacy row) |
| authenticated SELECT / rpc save | 42501 / 42501 | 42501 / 42501 |
| **Total** | **12/12 as expected** (and again after restoring the contract) | 8/12: the 4 differences are exactly the F-1 exposure |

### 5.4 SQL mutation: 19/19 killed

Method: each mutant was applied after a reset to cert's exact pre-state, which was verified by matrix equality. A mutant counted as killed only if a test failed.

**Contract mutants (15):**
- **C01:** the superseded 015N/015P step, verbatim.
- **Narrow revoke:** with checks (C02) and without (C03).
- **Sequence revoke missing:** with checks (C04) and without (C05).
- **SELECT grant missing:** with checks (C06) and without (C07).
- **Over-grant `SELECT, INSERT`:** with checks (C08) and without (C09).
- **Rogue-role scan:** removed (C10); ignoring UPDATE (C11); direct ACL only, i.e. blind to inheritance (C12).
- **EXECUTE precondition removed** (C13).
- **Sequence revoke missing `authenticated`:** with checks (C14) and without (C15).

**Self-defence:** 9 of the 15 refused to apply themselves through the step's own post-conditions. The step defends itself even when a statement is weakened.

**Rollback mutants (4):** GRANT ALL; INSERT + UPDATE; INSERT + sequence USAGE; no-op.

### 5.5 Existing Closure-015 suites and static gates

| Gate | Result |
|---|---|
| `closure015l` lifecycle / `closure015n` R-16 / `closure015p` direct grant, **destructive, on the Supabase-faithful copy** | **37/37, 27/27, 29/29** (first run outside a baseline.sql replay) |
| `closure015lDatabaseGuardsRbac` (updated) | 42/42 |
| `node scripts/check-migration-quality.js` | OK: 74 new, 0 violations; `supabase/migrations` unchanged (only 0003 and its rollback are RBAC files) |
| Migration-reading suites (same 42 as 015P) | 42/42, 992 passed, 1 skipped |
| `npm run typecheck` | 3/3 clean |
| `node scripts/typecheck-certification.js` | **PASS**: backend 0/0, backend-tests **256/259, net-new 0**. The first two runs FAILED with net-new identities in the new suite: casts on the `Outcome` union, and `!x.ok` not narrowing under the project's `strict: false`. Fixed with `in` narrowing helpers; no `any` or `@ts-ignore`. |
| 355-suite regression gate (015M set, placeholder env) | 15 failing suites / 53 failing tests; at test-name level **identical to 015P (0 new, 0 gone)**; 0 load failures |

## 6. Certification database: read-only

- **Before:** the matrix above, under `BEGIN READ ONLY`.
- **Source of the copy:** a read-only `pg_dump`.
- **End-of-phase re-measure:** **byte-identical** (raw ACLs, effective privileges, `rows=0`). The ledger is still 0001–0004.
- No destructive suite, probe write or DDL ran against it.

## 7. Exact deferred-artifact changes

| File | Before → after | Change |
|---|---|---|
| `supabase/deferred/rbac_config_contract_legacy_insert.sql` | `f0b4b8e0…` → **`9d691388…`** | header keeps the deferral and the C-7 gate verbatim, plus a 015Q supersession note and the verified-runtime notes; **preconditions** (table and function exist; SECURITY DEFINER; owner not an app role; the owner can SELECT+INSERT; service_role has EXECUTE); `REVOKE ALL ON TABLE … FROM PUBLIC, anon, authenticated, authenticator, service_role`, then `GRANT SELECT … TO service_role`; `REVOKE ALL ON SEQUENCE <identity seq> FROM` the same roles; **post-conditions on effective privileges** (exact service_role set; no app-role table, column or sequence privilege; **no other non-owner, non-superuser role may write or reset**, inheritance included; EXECUTE intact for service_role and absent for anon/authenticated; RLS on). Still unversioned and outside `supabase/migrations`. |
| `supabase/deferred/rollbacks/rbac_config_contract_legacy_insert_rollback.sql` | `55a14e8b…` → **`9dc8267c…`** | still `GRANT INSERT ON TABLE public.rbac_config TO service_role` only; header documents what it deliberately does **not** restore and the operational risk of restoring broad privileges (§8) |
| `supabase/proposals/closure015n/05_…` | `b39ffc49…` (unchanged) | kept byte-identical as the 015N review record; the deferred file states it supersedes it |
| `backend/tests/realschema/closure015q_rbac_contract_privileges.test.ts` | **new** `310b5c60…` | §5.2 |
| `backend/tests/unit/closure015lDatabaseGuardsRbac.test.ts` (tracked) | committed → **`9c646192…`** (+14/−4) | the deferral test now pins the new REVOKE ALL / GRANT SELECT / sequence REVOKE / post-condition text, asserts no other GRANT in the step, and asserts the rollback's only GRANT is the legacy INSERT; neither the old nor the new contract text may appear under `supabase/migrations` |

## 8. Rollback implications

The rollback restores the state 0003 *intended* (SELECT, INSERT): the legacy fallback works again and the governed path is unaffected.

**Do not restore broad privileges** (e.g. `GRANT ALL`, or re-granting the hosted default). Anyone holding the service key could then:
- **DELETE the head** → silently re-activate an older configuration (a permission downgrade or re-grant, with no save, version or audit);
- **UPDATE in place** → change permissions without a version, so stale-edit detection is blind;
- **TRUNCATE** → the application falls back to the built-in defaults;
- **`setval` lower** → every later governed save fails on the primary key (RBAC saves denied);
- **TRIGGER / REFERENCES / MAINTAIN** → attach existing functions as triggers, or block the table with locks and maintenance.

Rollback mutants R01–R04 prove the suite rejects any rollback that grants more, or less, than INSERT.

## 9. Proposal (not implemented): a forward correction before C-7

**Why it would help.** Until the deferred step runs (after deploy and C-7), cert, and production once 0001–0004 are applied, keep the F-1 exposure. The only privilege that must wait for C-7 is service_role **INSERT**, because the legacy fallback needs it. Everything else can be removed now without breaking anything:
- service_role's UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN;
- all sequence privileges of service_role and authenticated.

**Proposed shape.** A new versioned migration after 0004, e.g. `…_rbac_config_privileges_tighten.sql`:
```
REVOKE ALL ON TABLE public.rbac_config FROM service_role;
GRANT SELECT, INSERT ON TABLE public.rbac_config TO service_role;
REVOKE ALL ON SEQUENCE <identity seq> FROM PUBLIC, anon, authenticated, authenticator, service_role;
```
It would carry post-conditions analogous to the deferred step, but with INSERT allowed.

**Rollout order:** 0001 → 0002 → 0003 → 0004 → **tighten** (any time; no app dependency) → deploy → C-7 → deferred contract (which then only removes INSERT).

**Exposure while unapplied.** The pre-C-7 exposure stays as measured. The exposure is limited to the service key, which can already call `save_rbac_config`, plus `authenticated` sequence `setval`. That needs a direct database session or an exposed wrapper function; PostgREST does not expose `pg_catalog.setval`.

**Cost.** It is new versioned SQL in the release batch, so it needs owner approval, a commit, the migration checks, a cert application and its own suite (the 015Q suite can be parameterised for the "SELECT+INSERT" state).

## 10. Remaining uncertainty and blockers

- **Production default privileges are unknown.** Cert was built from a production schema dump plus migrations, and production probably matches it. The step is written so that this does not matter: it revokes ALL from every application role, and its post-conditions refuse to commit if **any** other non-owner role could still write. A different production role graph therefore aborts the step cleanly instead of leaving a gap. Production inspection remains **unauthorized** (C-1…C-9, `pg_default_acl`).
- **C-7 is an operator gate, not a SQL check.** Legacy and governed rows are indistinguishable in the data. *Option, not implemented:* make the step require an explicit session acknowledgement (e.g. `SET rbac_contract.c7_verified = 'yes'`) so it cannot be applied by accident.
- **Copy fidelity is at the privilege and schema level.** 7 RLS policies on `extension_*` tables could not be restored (GoTrue's `auth.jwt()`). They are unrelated to `rbac_config` and the tested tables.
- **Unchanged and still unauthorized:** production C-1…C-9, the production default-privilege inspection, browser passkey verification, production migrations, push/PR/merge and deploy.

## 11. Cleanup

- **Removed** (after verifying id, label, network members and 0 mounts): `c15q-rest`, `c15q-db` and the network `c15q-net`.
- **Deleted:** the throwaway secret files.
- **Untouched:** `cert-supabase` and `par-test`.

## 12. Recommended next decision

1. **Review and approve** the rewritten deferred step and rollback (§7). They stay uncommitted and deferred until C-7.
2. **Decide on §9:**
   - **Recommended: yes.** Add the forward "tighten" migration to the release batch, so the pre-C-7 window carries only the INSERT that the legacy path needs.
   - **Alternative:** accept the measured window until C-7.
3. **Authorize committing** the 015Q artifacts (suite, static test update, deferred step and rollback, this report) as a follow-up commit on `integration/closure-014a`.

Evidence is in the session scratchpad, `c15q/`:
- matrices: `cert_matrix_before.txt`, `cert_matrix_end.txt`, `copy_matrix_*.txt`, `m_*.txt`;
- copy build: `env_up*.log`, `acl_sync.log`;
- copy run: `run_copy*.log`, `q.run*.log`, `qf.run*.log`, `control.log`, `mutants/`;
- runtime: `runtime_*.json`;
- gates: `cert3.log`, `gate.clean`, `failnames.txt`, `migsuites.log`.

## Addendum (Closure-015R)

- **Committed.** The 015Q artifacts (deferred step and rollback, `closure015q` suite, static test update) were approved and committed in **`5444b0afca4cdec86753f8db3997407f1a9c2d93`** (parent `4301771a`). That commit also carries:
  - the approved forward migration `20261211000001_rbac_config_pre_c7_privilege_reduction.sql` (the §9 proposal, implemented);
  - the real-Postgres test-isolation fix.
- **Two changes to the 015Q artifacts:**
  - the deferred SQL is unchanged; it gained only a header note on its relation to the forward migration;
  - `closure015q` now snapshots and restores the `rbac_config` table and sequence ACLs.
- **Details:** `docs/security/CLOSURE_015R_PRE_C7_PRIVILEGE_REDUCTION.md`.
