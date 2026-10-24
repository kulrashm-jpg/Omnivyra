# CLOSURE-015P — Release boundary and certification results

Status: **COMMITTED LOCALLY (not pushed) and APPLIED TO THE LOCAL CERTIFICATION DATABASE.**
- Production was not accessed.
- Nothing was pushed, no PR was opened, nothing was merged or deployed.
- No production migration execution is authorized by this report.
- This report is untracked: it records the commit hash, so it cannot be inside that commit.

## 1. Baseline

| Item | Value |
|---|---|
| Worktree / branch | `C:/tmp/closure-014a` / `integration/closure-014a` (gitdir `C:/virality/.git/worktrees/closure-014a`) |
| HEAD at start | `03724e86969cd9d022fd191e142e914e04963b8a` |
| Tree at start | 0 staged; 57 tracked files modified (+1971/−344), byte-identical to the 015M final diff; 53 untracked; the promoted migration hashes matched 015O |
| Provenance of the changes | 015A recorded the tree as clean at this HEAD apart from the status-audit doc. Every change since then is Closure-015 work. |
| Branch operations | none (no reset, clean, stash, amend, rebase or switch) |

## 2. Release commit

| Item | Value |
|---|---|
| **Commit** | **`4301771a158665e261cc00dbdb9fe253790baebd`** (parent `03724e86`) |
| Subject | `security(closure-015): governed SUPER_ADMIN membership, lifecycle guards, RBAC config, invitation activation` |
| Size | 115 files: 57 modified + 58 added; +16019 / −344 |
| Pre-commit scans | no raw control bytes; no JWT, `sb_secret_`, production-ref, credentialed-URL or API-key patterns; the throwaway DB password is absent from every file |
| Staging | by explicit pathspec list. The staged set was verified equal to the list, with no `index.lock`. |
| **Excluded on purpose** (still untracked) | `supabase/deferred/rbac_config_contract_legacy_insert.sql`, `supabase/deferred/rollbacks/rbac_config_contract_legacy_insert_rollback.sql`, `supabase/proposals/closure015n/05_rbac_config_contract_legacy_insert.sql` |

### 2.1 Exact file list (`git show --name-status 4301771a`)

<details><summary>115 files</summary>

```
M backend/apiHandlers/company/usersShared.ts
M backend/apiHandlers/superAdmin/usersCreateShared.ts
M backend/apiHandlers/superAdmin/usersMutations.ts
M backend/apiHandlers/superAdmin/usersRead.ts
M backend/apiHandlers/superAdmin/usersShared.ts
M backend/middleware/withRBAC.ts
A backend/security/requireActivePlatformSuperAdmin.ts
M backend/services/campaignAccessService.ts
M backend/services/contentArchitectService.ts
A backend/services/invitationExpiry.ts
M backend/services/lifecycleGovernance.ts
A backend/services/onboardingInvitationAcceptance.ts
M backend/services/orgOwnershipRecoveryService.ts
M backend/services/rbacPrimitives.ts
M backend/services/rbacService.ts
M backend/services/userContextService.ts
M backend/services/userManagementService.ts
M backend/tests/integration/campaign_company_scope_fix.test.ts
M backend/tests/integration/campaign_preplanning_gate.test.ts
M backend/tests/integration/governance_lockdown.test.ts
M backend/tests/integration/governance_snapshot.test.ts
M backend/tests/integration/user_lifecycle_management.test.ts
A backend/tests/realschema/closure015l_company_lifecycle_guard.test.ts
A backend/tests/realschema/closure015n_invitation_activation.test.ts
A backend/tests/realschema/closure015p_direct_grant_guard.test.ts
M backend/tests/unit/bootstrapEnvCredential.test.ts
A backend/tests/unit/closure015cAuditAndDeleteRegression.test.ts
A backend/tests/unit/closure015cGlobalRouteContainment.test.ts
A backend/tests/unit/closure015cInviteRoleGovernance.test.ts
A backend/tests/unit/closure015dGlobalRouteStepUp.test.ts
A backend/tests/unit/closure015dIdentityLifecycle.test.ts
A backend/tests/unit/closure015dPolicyGateInvitedSuperAdmin.test.ts
A backend/tests/unit/closure015eInvitationAndCompanyStatus.test.ts
A backend/tests/unit/closure015eRolePatchStepUp.test.ts
A backend/tests/unit/closure015eSetPasswordAndArchitect.test.ts
A backend/tests/unit/closure015fRoleMutation.test.ts
A backend/tests/unit/closure015gCompanyMembershipGuards.test.ts
A backend/tests/unit/closure015hCompanyUsersTabDelete.dom.test.tsx
A backend/tests/unit/closure015hSuperAdminUsersDelete.test.ts
A backend/tests/unit/closure015iAdminUsersInvite.dom.test.tsx
A backend/tests/unit/closure015iPolicyResolution.test.ts
A backend/tests/unit/closure015jFinalReview.test.ts
A backend/tests/unit/closure015jRbacTabSave.dom.test.tsx
A backend/tests/unit/closure015kConcurrencyRbac.test.ts
A backend/tests/unit/closure015lDatabaseGuardsRbac.test.ts
A backend/tests/unit/closure015lRbacTabVersion.dom.test.tsx
A backend/tests/unit/closure015mOnboardingArchive.test.ts
M backend/tests/unit/crossOrganizationIdentityAdminBinding.test.ts
M backend/tests/unit/governanceSec002VerifySnapshot.test.ts
M backend/tests/unit/opportunitiesSec001ActionBinding.test.ts
M backend/tests/unit/opportunitiesSec002PostBinding.test.ts
M backend/tests/unit/sec91ACampaignAccess.test.ts
M backend/tests/unit/sec91W2GContentWriteRbac.test.ts
M backend/tests/unit/sec91W2GInvitedAdminOrgStatus.test.ts
M backend/tests/unit/withRbacStruct001CompanyId.test.ts
M components/super-admin/tabs/CompanyUsersTab.tsx
M components/super-admin/tabs/RbacTab.tsx
A docs/security/CLOSURE_015A_AUTHORIZATION_IMPACT_ASSESSMENT.md
A docs/security/CLOSURE_015B_CONTAINMENT_AND_TEST_PLAN_REVIEW.md
A docs/security/CLOSURE_015C_CONTAINMENT_RESULTS.md
A docs/security/CLOSURE_015D_IDENTITY_AND_STEP_UP_RESULTS.md
A docs/security/CLOSURE_015E_ROLE_AND_INVITATION_RESULTS.md
A docs/security/CLOSURE_015F_ROLE_MUTATION_RESULTS.md
A docs/security/CLOSURE_015G_COMPANY_MEMBERSHIP_GUARDS.md
A docs/security/CLOSURE_015H_F5_AND_MEMBERSHIP_POLICY_RESULTS.md
A docs/security/CLOSURE_015I_CONSOLIDATED_REVIEW.md
A docs/security/CLOSURE_015J_FINAL_REVIEW.md
A docs/security/CLOSURE_015K_CONCURRENCY_AND_RBAC_RESULTS.md
A docs/security/CLOSURE_015L_DATABASE_GUARDS_AND_RBAC_SCHEMA.md
A docs/security/CLOSURE_015M_ONBOARDING_ARCHIVE_AND_DATABASE_VALIDATION.md
A docs/security/CLOSURE_015N_MIGRATION_SEQUENCE_AND_R16.md
A docs/security/CLOSURE_015O_MIGRATION_PROMOTION_REVIEW.md
A docs/security/CLOSURE_015_SUPER_ADMIN_STATUS_AUDIT.md
M lib/platform/policyGate.ts
M pages/admin/users.tsx
M pages/api/admin/bootstrap-super-admin.ts
M pages/api/admin/revoke-super-admin.ts
M pages/api/auth/accept-invite.ts
M pages/api/auth/set-password.ts
M pages/api/company/users.ts
M pages/api/company/users/[userId]/role.ts
M pages/api/company/users/reinvite.ts
M pages/api/governance/rebuild-projection.ts
M pages/api/governance/restore-snapshot.ts
M pages/api/governance/unlock.ts
M pages/api/omnivyra/health.ts
M pages/api/onboarding/setup-company.ts
M pages/api/opportunities/refresh-slots.ts
M pages/api/super-admin/companies.ts
M pages/api/super-admin/companies/archive-abandoned.ts
M pages/api/super-admin/companies/transfer-ownership.ts
M pages/api/super-admin/free-credits/grant.ts
M pages/api/super-admin/free-credits/requests.ts
M pages/api/super-admin/rbac.ts
M pages/api/super-admin/users/create.ts
M pages/api/team/accept-invite.ts
M pages/api/users/[userId]/index.ts
M pages/api/users/[userId]/role.ts
M pages/api/users/invite.ts
M scripts/membership-validity-baseline.json
A supabase/migrations/20261210000001_company_lifecycle_super_admin_guard.sql
A supabase/migrations/20261210000002_assign_super_admin_rpc_and_direct_grant_guard.sql
A supabase/migrations/20261210000003_rbac_config.sql
A supabase/migrations/20261210000004_activate_invitation_membership.sql
A supabase/migrations/rollbacks/activate_invitation_membership_rollback.sql
A supabase/migrations/rollbacks/assign_super_admin_rpc_and_direct_grant_guard_rollback.sql
A supabase/migrations/rollbacks/company_lifecycle_super_admin_guard_rollback.sql
A supabase/migrations/rollbacks/rbac_config_rollback.sql
A supabase/proposals/closure015l/01_company_lifecycle_super_admin_guard.sql
A supabase/proposals/closure015l/02_assign_super_admin_rpc.sql
A supabase/proposals/closure015l/03_rbac_config.sql
A supabase/proposals/closure015n/01_company_lifecycle_super_admin_guard.sql
A supabase/proposals/closure015n/02_assign_super_admin_rpc.sql
A supabase/proposals/closure015n/03_rbac_config.sql
A supabase/proposals/closure015n/04_activate_invitation_membership.sql
```
</details>

### 2.2 Core migration batch (in the commit)

| Order | File | sha256 | Change in 015P |
|---|---|---|---|
| 1 | `20261210000001_company_lifecycle_super_admin_guard.sql` | `022efb77d4eb…` | none |
| 2 | `20261210000002_assign_super_admin_rpc_and_direct_grant_guard.sql` | `1da6b58a3f7a…` | **renamed** from `…_assign_super_admin_rpc.sql`; **direct-grant restriction added** (§3.2) |
| 3 | `20261210000003_rbac_config.sql` | `604539ee9868…` | none |
| 4 | `20261210000004_activate_invitation_membership.sql` | `9dac46fa229f…` | none |

Rollbacks (`supabase/migrations/rollbacks/`):
- `company_lifecycle_super_admin_guard_rollback.sql` `2d7fce9c…`
- `assign_super_admin_rpc_and_direct_grant_guard_rollback.sql` `bcc8296b…` (**new**: restores the 0001 guard body, then drops the RPC)
- `rbac_config_rollback.sql` `90dd8e11…` (warning repointed to the deferred step)
- `activate_invitation_membership_rollback.sql` `11bf5b7e…`

The numbering is contiguous, 0001–0004. No core migration depends on the deferred step.

## 3. Owner decisions implemented

### 3.1 Decision 1: migration 05 deferred

- **Moved out of `supabase/migrations`.** `20261210000005_rbac_config_contract_legacy_insert.sql` is now `supabase/deferred/rbac_config_contract_legacy_insert.sql` (sha256 `f0b4b8e0…`). Its rollback moved with it to `supabase/deferred/rollbacks/` (`55a14e8b…`).
- **No version prefix, on purpose.** The file cannot be picked up by a migration replay. When it is promoted, it must take a version newer than every migration applied at that time.
- **Header added.** The new header states:
  - it is deferred by owner decision;
  - it may be promoted and applied **only after the application deployment is verified (C-7) to have eliminated legacy RBAC writes**;
  - which file is its rollback.

  The original rollback warning is kept.
- **Rollback cross-references updated.** The `rbac_config` rollback now reads: "if the deferred contract step has been promoted and applied, roll it back FIRST". The deferred rollback states that a destructive rollback of 0003 requires the contract step to be rolled back first.
- **Static test.** `closure015lDatabaseGuardsRbac.test.ts` now asserts:
  - the contract `REVOKE` appears in **no** file under `supabase/migrations` (including rollbacks);
  - it exists in `supabase/deferred` with the deferral header;
  - its rollback is preserved.
- **Excluded from the release commit:** the deferred file, its rollback, and the identical 015N proposal `05_…`. All three are kept as untracked, reviewed artifacts.

### 3.2 Decision 2: database-level restriction on direct application-role SUPER_ADMIN grants

**Placement: migration 0002.** 0002 already creates the governed RPC. Putting the restriction in the same migration means the RPC and the restriction arrive in one transaction. The application falls back to its direct two-statement grant only when the RPC is missing (PGRST202), which can then only happen while the restriction is also absent. The deployed ordering stays coherent in every state.

**Mechanism.** 0002 re-creates `public.guard_super_admin_membership_company()`; the trigger itself is unchanged from 0001. The new body is the 0001 body plus one refusal, which fires before the company lock is taken.

| Condition | Result |
|---|---|
| `current_user IN ('service_role','authenticated','anon','authenticator')` and `NEW.role` is SUPER_ADMIN, case- and whitespace-normalized, and the write is an INSERT (any status) | **refused**: `SUPER_ADMIN_GRANT_NOT_GOVERNED` (P0001) |
| same roles, UPDATE changing a role **into** SUPER_ADMIN | refused |
| same roles, UPDATE **activating** a SUPER_ADMIN row (invited/inactive → active; this covers the R-14 flip) | refused |
| same roles, UPDATE **moving** a SUPER_ADMIN row to another company | refused |
| revocation (role away from SUPER_ADMIN), deactivation, DELETE, no-transition updates, non-SUPER_ADMIN writes | allowed (unchanged) |
| `public.assign_super_admin` (SECURITY DEFINER, owner `postgres`), called by service_role | allowed: inside the definer, `current_user` is the owner |
| owner session (`postgres`): migrations, seeds, break-glass operator | allowed; the company-lifecycle check still applies |

**Two properties make this hold:**
1. **The guard stays invoker-rights.** SECURITY DEFINER would make `current_user` the owner for every caller and erase the distinction.
2. **The RPC's owner is not an application role.**

0002 asserts both preconditions, and that the 0001 trigger exists, in a DO block before it commits.

**Other definer paths.** Only two baseline SECURITY DEFINER functions write `user_company_roles`:
- `activate_invitation_membership`, which 0004 replaces with its own SUPER_ADMIN refusal (and which is broken on baseline in any case);
- `disable_company_cascade`, which only deactivates.

Neither path can bypass the restriction to create SUPER_ADMIN.

**Bootstrap and break-glass are preserved:**
- `bootstrap-super-admin`, in all of its promote / bootstrap / env-credential modes, already calls `assign_super_admin` (015M). No application code changed in 015P.

### 3.3 Decision 3: order

`0001 lifecycle guard → 0002 governed grant + direct-write restriction → 0003 RBAC config storage → 0004 invitation-activation repair`. The order is contiguous, and the one name change (0002) is applied consistently to the file, its rollback, the static test and this report.

## 4. Verification after the final SQL (nothing reused from earlier phases)

### 4.1 Real PostgreSQL, throwaway container `c15n-throwaway`

**Container identity.** Re-verified before every start: id `6b629cc23116…`, label `purpose=closure015n-throwaway`, `restart=no`, `127.0.0.1:55434`, its anonymous volume used only by it.

**Fresh databases** (created from `template0` the way `real-schema-ci.sh` does it):

| Database | Contents | Result |
|---|---|---|
| `c15p` | bootstrap + `baseline.sql` + replay of every migration newer than the baseline's ledgerMax | **49 ok, 0 failed**; core in order 0001→0002→0003→0004; **0005 absent** |
| `c15p_ctl` | the same replay **without 0002** (negative control) | 48 ok, 0 failed |
| `c15p_rb` | full replay, then rollbacks 0004→0001, then 0001–0004 again | every rollback and re-apply exit 0; after the rollbacks, no trigger, no RPC, no `rbac_config`, no `hard_delete_company`, and `disable_company_cascade` md5 = baseline (`f797809d…`) |

**Re-running each core migration on `c15p`:** 01, 02 and 04 exit 0. 03 refuses with `RBAC_CONFIG_ALREADY_EXISTS`, as designed.

**Suites** (`C15N_NO_APPLY=1`: nothing is re-applied; the suites test the replayed objects):

| Suite | Result |
|---|---|
| `closure015l_company_lifecycle_guard` (lifecycle concurrency) | **37/37 ×3**, and 37/37 again after the 015P suite ran |
| `closure015n_invitation_activation` (R-16) | **27/27 ×3**, and 27/27 again |
| **`closure015p_direct_grant_guard` (new, execution-role distinction)** | **29/29 ×3** on `c15p`; **29/29** on `c15p_rb` after the rollback round trip |
| Negative control: `closure015p` on `c15p_ctl` | **20 failed / 9 passed.** Every one of the 15 refusal tests fails, and so do the 4 RPC tests and the installed-shape test. The 9 tests that pass are those that must behave the same with or without 0002 (allowed writes, break-glass, the 0004 refusal, the grants precondition). |
| **SQL mutation of the guard** (13 mutants on a template copy of `c15p`; clean baseline required; a mutant counts as killed only if a test fails) | **13/13 killed.** The mutants covered: dropping each application role in turn; `session_user` instead of `current_user`; each of the 4 grant branches disabled; a case-sensitive role match; active-only INSERT; two over-broad variants that refuse deactivation. Restore md5-verified (`9a4c0c65…` = `c15p`). |

The new suite switches roles for real, so `current_user` is exactly what it is behind PostgREST. It covers:
- **service_role refusals:** INSERT of an active / invited / inactive SUPER_ADMIN row; case and whitespace spellings of the role; role change into SUPER_ADMIN (active and inactive rows); the R-14 flip; re-activation; a company move; an upsert; a multi-row statement;
- **authenticated / anon / authenticator:** refused by the guard itself, with grants and RLS lifted inside a rolled-back transaction so the trigger is the only barrier;
- **still allowed:** revoke, deactivate, delete, a no-transition update, non-SUPER_ADMIN grants;
- **governed path:** `assign_super_admin` as service_role creates, promotes and re-activates, and still enforces the company lifecycle; authenticated and anon cannot execute it;
- **break-glass:** the owner may write directly, and the lifecycle guard still applies.

A fidelity note on the throwaway replay: `baseline.sql` is dumped without privileges. The suite therefore grants service_role DML on `user_company_roles`, the hosted default, so the guard is what gets exercised. A precondition test proves service_role can write the table. §6 F-1 covers the inverse effect on `rbac_config`.

### 4.2 Static gates on the final tree

| Gate | Result |
|---|---|
| `node scripts/check-migration-quality.js` | **OK**: 74 new migrations valid (70 + 4 core), 353 frozen, ordering floor `20261026000000`, **0 violations** |
| Every suite that reads `supabase/migrations` | **42/42 suites, 992 passed, 1 skipped** (015O: 990; the 2 additions are the new static tests). `tests/stability/auth/loginContract.test.ts` matches the scan but not the default jest config. |
| `npm run typecheck` | **3/3 projects clean** |
| `node scripts/typecheck-certification.js` | **PASS**: backend 0/0, backend-tests 256/259, **net-new 0** |
| Regression gate (the 015M 355-suite set, same placeholder env) | **15 failing suites / 53 failing tests**, 2 skipped, 7941 passed, **0 load failures**. At test-name level this is identical to 015M: **0 new, 0 gone**. Passing tests went from 7939 to 7941. |
| `closure015lDatabaseGuardsRbac` (updated) | 42/42 |

## 5. Certification database

### 5.1 Target verification (before any database operation)

| Check | Evidence |
|---|---|
| Designated environment | the local `cert-supabase` Supabase stack (WRITER-CERT-002), the cert DB used by CLOSURE-012 and 014B. No other certification stack exists on this machine. |
| Container | `supabase_db_cert-supabase`, id `59f0d074f49e…`, label `com.supabase.cli.project=cert-supabase`, image `supabase/postgres:17.6.1.167`, network `supabase_network_cert-supabase`, host port 54322 |
| Connection | `docker exec … psql -U postgres` over the container's local socket. No credentials were read, typed or stored. |
| Database | `system_identifier=7684462104593874982`; databases `_supabase, postgres, storage_vectors`; not in recovery |
| Isolation | 0 foreign servers, 0 subscriptions, no `dblink`, `postgres_fdw`, `pg_net` or `http` extensions. The one logical slot is consumed by `supabase_analytics_cert-supabase` (172.18.0.7) on the stack's own network. |
| Re-check | container id, project label, system identifier and database list were re-verified **before every step**. The script stops on any mismatch. |

### 5.2 Prechecks (read-only, `BEGIN READ ONLY`)

| Check | Cert result |
|---|---|
| C-1 active duplicate memberships | **0** |
| C-2 partial index | `CREATE UNIQUE INDEX idx_user_company_roles_user_company_active … (user_id, company_id) WHERE (status = 'active'::text)`: **exact** |
| C-3 invited or inactive SUPER_ADMIN rows | **0** (there are no active SUPER_ADMIN rows either, so the bootstrap-event sub-check is vacuous) |
| C-4 active SUPER_ADMIN in non-active, soft-deleted or missing companies | **0 / 0** |
| C-5 `rbac_config` | **absent → VARIANT A** |
| C-6 invitation roles outside the vocabulary | **0**; `invitations_role_check` present |
| C-8 functions replaced wholesale | `disable_company_cascade` `f797809d…` and `soft_delete_company` `1e8fc9d7…` are **identical to a baseline-only load**. `activate_invitation_membership` is identical **after removing `\r`**: cert stores the body with CRLF line endings, because the cert DB was built from a dump on Windows. The raw md5 is `339c8031…`; with CRs stripped it is `40df3c92…`, equal to baseline. 0004 replaces it wholesale, so nothing is lost. |
| Pre-state | ledger table `supabase_migrations.schema_migrations` present with **0 rows**; no guard trigger; no `assign_super_admin`; 3 companies, 1 membership, 0 active SUPER_ADMIN |

### 5.3 Application, one migration at a time, from commit `4301771a`

Each step ran the same sequence:
1. Re-verify the target.
2. Confirm the worktree HEAD is `4301771a` and the file is unchanged from the commit.
3. Refuse if the version is already ledgered.
4. `psql -v ON_ERROR_STOP=1 < file` as `postgres`, the same role as hosted migrations.
5. Ledger `(version, name)`.
6. Record catalog state.
7. Run the probes.

Every probe is its own transaction that is never committed, and the script stopped on the first unexpected result.

| Step | Apply | Ledger | Probes |
|---|---|---|---|
| **0001** lifecycle guard | exit 0 (only NOTICE: trigger did not exist, skipping) | `20261210000001 company_lifecycle_super_admin_guard` | 5/5 PASS:<br>• disable and hard delete with an active SUPER_ADMIN → `COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP`<br>• SUPER_ADMIN into an inactive company → `SUPER_ADMIN_MEMBERSHIP_COMPANY_NOT_ACTIVE`<br>• disable without a SUPER_ADMIN → ok<br>• P1.5: service_role direct SUPER_ADMIN insert still **allowed**, the gap 0002 closes |
| **0002** RPC + direct-grant guard | exit 0 | `20261210000002 assign_super_admin_rpc_and_direct_grant_guard` | 9/9 PASS:<br>• service_role direct active / invited insert and the R-14 flip → `SUPER_ADMIN_GRANT_NOT_GOVERNED`<br>• `assign_super_admin` as service_role → ok<br>• service_role deactivation → ok<br>• authenticated EXECUTE → permission denied<br>• owner break-glass → ok<br>• RPC into an inactive company → `…COMPANY_NOT_ACTIVE`<br>• RPC grant then disable → `COMPANY_HOLDS_…` |
| **0003** rbac_config | exit 0 | `20261210000003 rbac_config` | 5/5 PASS:<br>• first versioned save → ok<br>• second save with the same expected version → `RBAC_CONFIG_STALE`<br>• service_role legacy INSERT still allowed (contract step deferred)<br>• authenticated SELECT → permission denied<br>• empty roles → `rbac_config_roles_shape` |
| **0004** invitation activation | exit 0 | `20261210000004 activate_invitation_membership` | 7/7 PASS:<br>• activation as service_role → ok<br>• other user → `INVITATION_USER_MISMATCH`<br>• reuse by another user → `INVITATION_ALREADY_ACCEPTED`<br>• inactive company → `INVITATION_COMPANY_NOT_ACTIVE`<br>• existing SUPER_ADMIN row → `INVITATION_TARGETS_SUPER_ADMIN_MEMBERSHIP`<br>• active member → `MEMBERSHIP_ALREADY_ACTIVE`<br>• same-user replay → idempotent ok |

**Totals:** **26/26 probes PASS.** A residue check after every step found 0 probe users, companies, invitations or memberships, and 0 `rbac_config` rows.

**Final state:**
- the ledger holds exactly the four core versions;
- **every installed definition is md5-identical to the `c15p` replay** where 37 + 27 + 29 real-Postgres tests passed (`activate_invitation_membership` `dd3ff285`, `assign_super_admin` `4e081f3e`, `disable_company_cascade` `ae24b2d7`, `guard_super_admin_membership_company` `9a4c0c65`, `hard_delete_company` `9020481c`, `save_rbac_config` `2682223b`, `soft_delete_company` `1e8fc9d7`);
- the contract REVOKE is **not** applied;
- `NOTIFY pgrst, 'reload schema'` was sent.

## 6. Deviations and findings

- **D-1. The realschema suites were not run against the cert DB.**
  - *Why:* they are written for disposable databases (`TRUNCATE rbac_config`, `ALTER TABLE … DROP CONSTRAINT`, temporary triggers on `users`, re-applying SQL, fixture rows left in place).
  - *Replacement evidence:* 26 rolled-back probes covering the same behaviours, plus definition identity between cert and the replay where the suites passed (same PostgreSQL major version, 17).
  - *Option:* a pg_dump-to-throwaway copy of cert can host the full suites if the owner wants that.
- **D-2. 0002 was renamed** (`…_assign_super_admin_rpc.sql` → `…_assign_super_admin_rpc_and_direct_grant_guard.sql`), together with its rollback, so the name describes the content.
- **D-3. The restriction is broader than "active" alone.** "Create or activate" is implemented to also refuse an application role inserting an *invited or inactive* SUPER_ADMIN row and changing a role into SUPER_ADMIN while not active. Either would otherwise stage a later activation. Revoke, deactivate and delete are unaffected.
- **F-1 (new, owner decision). On Supabase, `rbac_config` gives service_role ALL privileges, not SELECT and INSERT.**
  - *Cause:* the cert DB has Supabase's default privileges: tables `postgres` creates in `public` grant ALL to service_role, and `arwdxtm` to authenticated. 0003 revokes anon and authenticated (proven: P3.4 is denied) and *grants* service_role SELECT and INSERT, but never revokes the default ALL. The effective service_role privileges on cert are SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER. The throwaway replay has no default privileges, which is why every earlier run showed `service_role=ar`.
  - *Impact today:* low. The application only reads and appends, and the service key already holds `save_rbac_config`. But the stated design ("service_role SELECT, INSERT; history append-only") does not hold on hosted Supabase.
  - *Impact on the deferred step:* the deferred 05 `REVOKE INSERT, UPDATE, DELETE` would still leave TRUNCATE (wipe → built-in defaults), REFERENCES and TRIGGER.
  - *Recommendation, not applied:*
    - (a) Change the deferred contract step to `REVOKE ALL ON public.rbac_config FROM service_role; GRANT SELECT ON public.rbac_config TO service_role;`, with its rollback re-granting `INSERT`. This is uncommitted, so it is a review-only change.
    - (b) Optionally, before production, add `REVOKE ALL … FROM service_role` ahead of 0003's GRANT. That changes committed SQL already applied to cert, so it needs a new commit, re-validation and a cert re-apply.
- **F-2 (informational).** Default function privileges on Supabase also give `authenticated` EXECUTE on the trigger function `guard_super_admin_membership_company`. That has no effect: trigger functions cannot be called directly. The SECURITY DEFINER functions all revoke PUBLIC, anon and authenticated explicitly, and that was verified on cert.
- **Pre-existing, untouched:** `supabase_vector_cert-supabase` is in a restart loop (it was already looping before this phase).

## 7. Cleanup

- **Removed:** `c15n-throwaway` after the identity re-check (id, state, label, mount list, and a volume with only this user). Its volume `1d3bab27…` was labelled `com.docker.volume.anonymous` and went with the container (`docker rm -v`).
- **Also removed:** the scratchpad file holding the throwaway password, which is now moot. The password appears in no artifact.
- **Untouched:** the `cert-supabase` stack (its DB now holds 0001–0004), `par-test`, all images and all other volumes.

## 8. Remaining blockers (separate from this phase's results)

**A. Operator checks C-1…C-9 on PRODUCTION** (ref `klkiseupptzbecbxwrky`; not accessed here):
- C-1 / C-2: no active duplicates; the exact partial index (0004 refuses otherwise).
- C-3 / C-4: no invited or inactive SUPER_ADMIN rows; active SUPER_ADMIN rows only in active companies; each active SUPER_ADMIN has a bootstrap security event.
- C-5: `rbac_config` absent (VARIANT A), or VARIANT B if it exists (0003 refuses on an existing table).
- C-6: invitation roles within the vocabulary.
- C-7: after the application deploy, new `rbac_config` rows come from `save_rbac_config`. This gates the deferred contract step.
- C-8: compare function definitions **after normalising line endings** (lesson from cert).
- C-9: seeds and scripts that write SUPER_ADMIN rows directly must run as the owner, not service_role (now enforced), and must target active companies.
- **Default privileges on production:** check `pg_default_acl` for `public` (F-1).

**B. Browser passkey verification.** The UI step-up flows have unit and DOM tests only, with no real-browser WebAuthn run: RBAC save, company disable/delete, role and invite mutations, the provider-credential step-up. This needs an operator in a browser against cert or staging.

**C. Production release blockers:**
1. Owner decision on F-1 (adjust the deferred step; optionally 0003).
2. Push `integration/closure-014a` @ `4301771a`, open a PR, review and merge. None of this is authorized yet.
3. Production migration authorization: 0001→0004 individually, ledgered, `NOTIFY pgrst`. **No deploy mechanism applies migrations**, so it is an operator action against ref `klkiseupptzbecbxwrky`.
4. App deploy (web and worker), then C-7, then promote and apply the deferred contract step as its own reviewed change.
5. App-level cert flow on the cert stack (now possible: 0001–0004 are live there):
   - disable and delete with and without a SUPER_ADMIN;
   - bootstrap governed grant;
   - RBAC save, version 1 then a stale 409;
   - invitation acceptance via onboarding and set-password.
6. Carried over:
   - the `governance_performance_guard` check/set race (pre-existing, 27fec12d);
   - pinning `disable_company_cascade`'s `search_path` (annotated, follow-up);
   - locking in the 3 resolved type-check baseline errors (`npm run typecheck:certification:baseline`, dedicated commit);
   - the 53 baseline test failures (unchanged; not caused by Closure-015).

## 9. Evidence locations

Session scratchpad, `c15p/`:
- `validate.log` (replay, installed state, suites, control, round trip);
- `rerun015p.log` (final 015P suite ×3, control, round trip);
- `mutants.log` (13/13);
- `migsuites.log`, `typecheck.log`, `cert.log`, `gate.clean`, `failnames.txt`;
- `cert/cert_apply.log` with `cert/probe_*.{sql,out,err}` and `cert/apply_*.out`;
- `cert_precheck.txt`, `c8_baseline.log`, `commit_name_status.txt`.
