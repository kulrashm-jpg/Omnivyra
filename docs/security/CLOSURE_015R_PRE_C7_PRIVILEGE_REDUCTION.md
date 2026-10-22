# CLOSURE-015R — Pre-C-7 privilege reduction, 015Q finalization, real-Postgres test isolation

**Status: COMMITTED LOCALLY. Nothing pushed.**
- **Commit:** `5444b0afca4cdec86753f8db3997407f1a9c2d93`, parent `4301771a158665e261cc00dbdb9fe253790baebd`, branch `integration/closure-014a`.
- **Not done:** no PR, merge or deploy; no production access.
- **Certification DB:** not modified; it is still on 0001–0004.
- **This report:** untracked.

## 1. Owner decisions implemented

| # | Decision | Implementation |
|---|---|---|
| 1 | Approve the 015Q deferred contract and its rollback, subject to final validation | `supabase/deferred/…` committed. SQL unchanged since 015Q; only a header note on its relation to the forward migration was added. |
| 2 | A forward migration after 0004 reducing pre-C-7 privileges | `supabase/migrations/20261211000001_rbac_config_pre_c7_privilege_reduction.sql`, plus its rollback |
| 3 | Commit once every gate passes | commit `5444b0af` (§7) |
| (a) | Fix the real-Postgres test isolation | `closure015l` setup now driven by database state; RBAC suites restore the ACLs they find (§4) |

**Naming.** The prefix `20261211000001` was chosen on purpose. "Migration 05" / `20261210000005` already denotes the deferred contract in the 015O–015Q record, so reusing that number for a different migration would invite confusion.

## 2. Final migration order and privilege contract

`0001 lifecycle guard → 0002 governed grant + direct-grant guard → 0003 rbac_config → 0004 invitation activation → 20261211000001 pre-C-7 reduction` (independent of the app deploy) `→ deploy → C-7 → deferred contract step`.

| `public.rbac_config` | After 0003 on Supabase (cert today) | **Pre-C-7, after 20261211000001** | **Post-C-7, after the deferred step** |
|---|---|---|---|
| service_role, table | ALL (S I U D T R Tr M) | **SELECT, INSERT** | **SELECT** |
| service_role, identity sequence | USAGE, SELECT, UPDATE | **none** | none |
| authenticated, sequence | USAGE, SELECT, UPDATE | **none** | none |
| authenticated / anon / authenticator / PUBLIC, table | none | none | none |
| column-level writes | service_role INSERT, UPDATE, REFERENCES | service_role INSERT only | none |
| `save_rbac_config` | SECURITY DEFINER, owner postgres, EXECUTE service_role only | unchanged | unchanged |

**Why exactly these.** Runtime is unchanged since 015Q:
- **SELECT:** the rbacService reads, and the legacy path's newest-row read.
- **INSERT:** only the legacy fallback, when the function is missing (PGRST202); kept until C-7.
- **Sequence:** not needed. The governed save runs as the function owner, and a direct INSERT into the identity column needs no sequence privilege (proven).

**Fail-safety of the forward migration.** It is a single transaction:
- **Preconditions:** the table exists with an identity column; the function is SECURITY DEFINER, owned by a non-app role, and its owner can SELECT+INSERT; service_role has EXECUTE.
- **Post-conditions on *effective* privileges:**
  - service_role holds exactly SELECT, INSERT;
  - other app roles and PUBLIC hold nothing;
  - no column-level UPDATE/REFERENCES, and column INSERT only for service_role;
  - no sequence privileges;
  - **no unexpected non-owner, non-superuser writer, including through inheritance** (only `service_role:INSERT` is allowed);
  - EXECUTE is intact and RLS is on.

  Any violation aborts the whole migration, so nothing changes (proven, §5).

**Rollbacks:**
- Forward migration: `GRANT SELECT, INSERT` only. It re-asserts the interim contract even when applied from the post-C-7 state, and never restores the broad defaults (risks documented in the file header).
- Deferred step: `GRANT INSERT` only. It returns exactly to the interim contract (proven).

## 3. Effective-role evidence

- **Certification DB, read-only.** The matrix at the start of 015R is identical to 015Q's: service_role holds ALL, and service_role and authenticated hold `rwU` on the sequence. At the end of 015R it is **byte-identical** to the start.
- **Isolated Supabase-faithful copy** (`c15r-db`):
  - the same `supabase/postgres:17.6.1.167` and `postgrest:v16.2` images as cert, on its own network `c15r-net`, bound to 127.0.0.1;
  - sysid `7697300859229913134` (cert: `7684462104593874982`);
  - built by read-only dump plus exact ACL sync: 1042 objects plus default privileges, **0 differences**;
  - pre-state matrix **identical** to cert's.

  Transitions measured on it:
  - cert state → interim: service_role `S I U D T R Tr M` → `S I`; sequence `rwU` → none for service_role and authenticated; column writes → service_role INSERT only.
  - interim → contract: `S I` → `S`.
  - contract rollback → **exactly** the interim matrix.

## 4. The test-isolation defect and its fix (approved option a)

**Defect** (pre-existing in `4301771a`):
- In CI default mode, `closure015l`'s `beforeAll` re-applied the 015L proposal `01_…`.
- That replaced the 0002 guard with its pre-015P body, so `closure015p` failed 29/29 in the shared database.
- Evidence is kept in the stopped container `c15r-ci` (§8).

**Fix 1: `closure015l` setup is driven by verified database state.** It reads definition md5s of the guard, `hard_delete_company`, `assign_super_admin`, `save_rbac_config`, the trigger and the table.
- **All present:** test what is installed and **apply nothing**.
- **None present:** apply the proposals, the original operator path. If `C15N_NO_APPLY=1` forbids applying, refuse.
- **Partial:** refuse with an explicit error.

Three **setup-isolation tests** run last in the file:
- the decision followed the observed state;
- installed mode → every definition and the trigger are byte-for-byte unchanged, while proposals mode → objects were created from nothing;
- the guard's governed state is exactly as found in installed mode, and the 015L body in proposals mode.

`closure015p` was **not** changed to re-apply 0002.

**Fix 2: no order-dependent privilege state (found during this phase).** The final tier showed that `closure015q` could leave the deferred contract applied, so the shared database ended in a privilege state depending on suite order. No test failed. `closure015q` and `closure015r` now snapshot the exact ACLs of the table and its sequence before anything runs. They restore them afterwards over a dedicated connection, because `setup.ts` closes the shared client first; the first attempt failed loudly on exactly that. Each suite now leaves raw ACLs md5-identical.

## 5. Test results (final files)

**A. CI-mode real-Postgres tier** (fresh replay as `real-schema-ci.sh` does it, in a new disposable `pgvector/pgvector:pg17` container `c15r-ci2`, 127.0.0.1 only, sysid `7697296732840673318`; default mode, no `C15N_NO_APPLY`):

| Check | Result |
|---|---|
| Replay | 50 ok / 0 failed; 0001→0004 then 20261211000001; deferred contract absent; re-runs exit 0 |
| Whole tier (33 suites) | **33/33 suites, 671/671 tests**, on 3 separate fresh or re-used databases and 5 full runs |
| `closure015l` | 40/40 (37 + 3 isolation tests); `closure015p` **29/29** |
| After the tier | guard still contains `SUPER_ADMIN_GRANT_NOT_GOVERNED`; guard, `activate_invitation_membership` and `assign_super_admin` md5s and rbac privileges **identical** to post-replay (so 015N's re-apply of its proposal 04 does not downgrade) |
| Order independence | second full tier on the same DB 33/33; forced orders 015L→015P, 015P→015L→015P, 015Q→015R, 015R→015Q all pass; state identical after every run |
| Proposal path | fresh DB without 20261210*/20261211*: 015L 40/40 (proposals mode), then 40/40 again (installed by proposals) |
| Partial install | refused: "closure015l: the guard objects are PARTIALLY installed" |

**B. Supabase-faithful isolated copy** (all destructive runs):

| Check | Result |
|---|---|
| Forward migration apply / re-apply | exit 0 / exit 0, matrix unchanged |
| `closure015r` (27 tests) | **27/27 ×3** (interim intact afterwards) |
| Real PostgREST + real `rbacService`, interim | **12/12**: versioned save v1, stale refused, v2; reads; **legacy direct INSERT allowed (by design pre-C-7)**; direct UPDATE/DELETE 42501; authenticated SELECT and rpc save 42501 |
| Deferred contract on interim | exit 0; `closure015q` **23/23 ×3**; PostgREST **12/12** (INSERT now 42501) |
| Contract rollback | returns **exactly** to the interim matrix |
| `closure015l` / `015n` / `015p`, default mode on the copy | 40/40, 27/27, 29/29; guard still governed |
| Negative control A (015R suite on the cert state) | 10 failed / 17 passed (every privilege and denial assertion fails) |
| Negative control B (015Q suite on interim, no contract) | 7 failed / 16 passed |

**Denied in the interim contract (42501, as service_role):**
- UPDATE, DELETE, TRUNCATE;
- `LOCK … ACCESS EXCLUSIVE`;
- CREATE TRIGGER;
- `setval` / `nextval` for service_role **and** authenticated.

authenticated and anon can neither read nor insert.

**C. SQL mutation** (each mutant applied after a reset to the matrix-verified cert state; killed only on a failed test):

| Set | Result |
|---|---|
| Forward migration (15) + its rollback (5) | **20/20**: 19 by the real-Postgres suite; `N15_not_transactional` survives it (node-pg sends a file as one implicit transaction) and is **killed by the static test** (swap, test, restore with sha256 verified) |
| Deferred contract (15) + rollback (4), from the **cert state** | **19/19** (defence in depth when the forward migration is absent) |
| Same 19, from the **interim** state | 14/19. The 5 survivors (C02 narrow revoke, C04/C05 no sequence revoke, C14/C15 sequence revoke missing authenticated) are **equivalent in the chain**: they only weaken revocations the forward migration has already done, and the final state is identical. All 5 are killed from the cert state. |

Self-defence: 9 of the 15 forward-migration mutants (and 9 of the 15 contract mutants from the cert state) were refused by the SQL's own post-conditions.

**D. Static gates (final tree)**

| Gate | Result |
|---|---|
| `check-migration-quality.js` | OK: 75 new (74 + 1), 0 violations |
| `closure015lDatabaseGuardsRbac` | 43/43 (+1: the forward migration follows 0004, grants exactly SELECT, INSERT, is transactional, and its rollback only re-grants that) |
| Migration-reading suites (43 files, 42 jest suites) | 42/42, 993 passed, 1 skipped |
| `npm run typecheck` | 3/3 clean |
| `typecheck-certification.js` | **PASS**: backend 0/0, backend-tests 256/259, net-new 0 |
| 355-suite regression gate | 15 failing suites / 53 failing tests: **0 new, 0 gone** vs 015P/015Q; 0 load failures; 7942 passed |

## 6. Assertion changes (none weakened)

- **Contract-absence check.** The forward migration shares the contract's `REVOKE ALL ON TABLE …` line, so the static "contract is never in `supabase/migrations`" check now pins only what the contract has:
  - its SELECT-only grant;
  - `RBAC_CONTRACT_POSTCONDITION` / `_PRECONDITION`;
  - the old narrow revoke;
  - and, newly, that no migration's **SQL** revokes INSERT on `rbac_config`. Comments are ignored, because 0003's VARIANT B documentation mentions it.
- **One assertion strengthened.** The 015L isolation test no longer passes vacuously in any mode.

## 7. Commit

- **Commit:** `5444b0afca4cdec86753f8db3997407f1a9c2d93`
- **Parent:** `4301771a158665e261cc00dbdb9fe253790baebd`
- **Changes:** 8 files, +1206 / −12.

```
M backend/tests/realschema/closure015l_company_lifecycle_guard.test.ts
A backend/tests/realschema/closure015q_rbac_contract_privileges.test.ts
A backend/tests/realschema/closure015r_rbac_pre_c7_privilege_reduction.test.ts
M backend/tests/unit/closure015lDatabaseGuardsRbac.test.ts
A supabase/deferred/rbac_config_contract_legacy_insert.sql
A supabase/deferred/rollbacks/rbac_config_contract_legacy_insert_rollback.sql
A supabase/migrations/20261211000001_rbac_config_pre_c7_privilege_reduction.sql
A supabase/migrations/rollbacks/rbac_config_pre_c7_privilege_reduction_rollback.sql
```

**Before staging:**
- the staged set was verified equal to the reviewed list;
- no control bytes, credential patterns or throwaway secrets in any file;
- the deferred contract is absent from `supabase/migrations`;
- the 015N proposal is byte-identical (`b39ffc49…`).

**Final worktree:** HEAD `5444b0af`, 0 staged. Untracked: the 015P, 015Q and 015R reports, and `supabase/proposals/closure015n/05_…` (historical record, deliberately uncommitted).

## 8. Disposable resources (retained until review)

| Resource | State | Purpose |
|---|---|---|
| `c15r-ci` (`b6aa66a6c7ad`) | stopped | evidence of the original 015P failure: its `w6` DB holds the downgraded guard |
| `c15r-ci2` (`5b4d06aeca0b`) | stopped | CI-mode replays: `w6`, `w6final`, `w6final2`, `w6p`, `w6p2` |
| `c15r-db` (`df521f00a730`), `c15r-rest` (`fba4e8d92ad1`), network `c15r-net` | stopped | the Supabase-faithful copy (final state: interim contract) |

All are labelled `purpose=closure015r-throwaway`, bound to 127.0.0.1, `restart=no`. Volumes are anonymous and container-owned (none for `c15r-db`/`c15r-rest`). The throwaway passwords and JWT secrets were deleted from the scratchpad and appear in no artifact.

**Removal once reviewed:** `docker rm -f -v c15r-ci c15r-ci2 c15r-db c15r-rest && docker network rm c15r-net`, after re-checking each id and label. `cert-supabase` and `par-test` were not touched.

## 9. Remaining release blockers (unchanged; none authorized)

1. **Production checks:**
   - C-1…C-9;
   - production `pg_default_acl` / role graph. The forward migration and the contract abort cleanly on an unexpected writer, but the result must be seen on production.
2. **Application on cert and production:**
   - applying `20261211000001` to **cert** needs a separate authorization; cert is still on 0001–0004 and shows the F-1 grants;
   - production migration of 0001–0004 and 20261211000001: an operator action, by explicit file, ledgered, then `NOTIFY pgrst`.
3. **Release path:**
   - push / PR / merge / deploy of `integration/closure-014a` (`4301771a` + `5444b0af`);
   - then C-7, then promote the deferred contract with a fresh version.
4. **Browser passkey (WebAuthn) verification** of the step-up flows.
5. **Carried over:**
   - the `governance_performance_guard` check/set race;
   - pinning `disable_company_cascade`'s `search_path`;
   - locking the 3 resolved type-check baseline errors (`npm run typecheck:certification:baseline`, dedicated commit);
   - the 53 pre-existing test failures.
6. **The CI real-Postgres job on `4301771a` alone** would have failed (§4). The fix is in `5444b0af`, so ship them together. Whether that CI job currently runs (it may be secret-gated) was not checked.

**Evidence** (session scratchpad, `c15r/`):
- tier runs: `ci_replay.log` (original failure), `ci_tier2.log`–`ci_tier5.log`;
- copy runs: `run_copy.log`, `run_copy_pass1.log`, `contract_broad*.log`;
- isolated-copy matrices: `m_*.txt`;
- read-only cert matrices: `cert_matrix_start.txt`, `cert_matrix_end.txt`;
- mutants: `mutants/`, `n15_static.log`;
- gates: `migsuites.log`, `typecheck.log`, `cert_final.log`, `gate.clean`, `failnames.txt`.
