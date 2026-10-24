# CLOSURE-015M — Onboarding, Archive and Database Validation

**Status:**
- Local only and uncommitted. Nothing is staged, committed, pushed or deployed.
- **No migration was applied to any shared or production database.**
- No env or credential file was read.
- The SQL proposals were executed **only** inside a verified, newly created, localhost-only throwaway PostgreSQL container.

**Date:** 2026-10-16. **Worktree:** `C:/tmp/closure-014a`.

## 1. Repository state

| | Start (verified) | End |
|---|---|---|
| Branch / HEAD | `integration/closure-014a` @ `03724e86` | unchanged |
| Staged | 0 | 0 |
| Tracked diff | 54 files, +1857 / −320 (byte-identical to the 015L final diff) | 57 files changed, +1971 / −344 |
| Untracked | 37 | 40 (37 + `onboardingInvitationAcceptance.ts`, `closure015mOnboardingArchive.test.ts`, this report) |
| 015L report / proposals / realschema suite | sha256 `5ac65aff` / `2f5fb831`, `3f4e83e5`, `59addb74` / `e8e91718` | report and proposals unchanged; realschema suite **extended** (§5) |

**015M source changes:**

| File | Change |
|---|---|
| `backend/services/onboardingInvitationAcceptance.ts` (new) | Governed onboarding acceptance (R-14) |
| `pages/api/onboarding/setup-company.ts` | Both activation branches use it (R-14) |
| `pages/api/team/accept-invite.ts` | Explicit invitation-role check (R-14, defence in depth) |
| `backend/services/orgOwnershipRecoveryService.ts` | Archive = disable cascade, SUPER_ADMIN guard (R-15) |
| `pages/api/super-admin/companies/archive-abandoned.ts` | Maps `SUPER_ADMIN_MEMBERSHIP` → 409 (R-15) |
| `pages/api/admin/bootstrap-super-admin.ts` | `assignSuperAdmin` calls `assign_super_admin` first (D) |
| `scripts/membership-validity-baseline.json` | One recorded finding (`bootstrap-super-admin.ts:468`, binding target; §8) |

**Tests:**

| File | Change |
|---|---|
| `backend/tests/unit/closure015mOnboardingArchive.test.ts` | New, 39 tests |
| `backend/tests/realschema/closure015l_company_lifecycle_guard.test.ts` | Extended from 16 to 37 tests; applies proposal 02 too; idempotent 03 |
| `backend/tests/unit/closure015jFinalReview.test.ts` | Archive tests adapted to R-15; the cascade mock models the deployed baseline RPC |
| `backend/tests/unit/bootstrapEnvCredential.test.ts` | Its supabase mock models the absent `assign_super_admin` (PGRST202) |

## 2. R-14 — onboarding and invitation activation

**Every path that can activate a membership:**

| Path | Mechanism | Before 015M | After |
|---|---|---|---|
| `onboarding/setup-company` Path A (public-email invitee) | Flipped the caller's **invited** row to `active` **by id** | **Bypass.** No invitation, expiry, revocation or single-use check; **any role, SUPER_ADMIN included** | `acceptInvitationViaOnboarding` |
| `onboarding/setup-company` work-email domain branch | Same blind flip | **Same bypass** | Same helper |
| `team/accept-invite` (token) | Token hash; checks revoked/accepted/expired/email; claims the invitation conditionally; activates `invitation.role` | Correct, but relied on `invitations_role_check` alone for "never SUPER_ADMIN" | + explicit invitation-role check before the claim |
| `auth/set-password` → `activate_invitation_membership` (SQL) | Role from the invitation | **R-16 (new, real-Postgres):** the function **cannot execute** against the baseline schema (`column reference "company_id" is ambiguous`; and its `ON CONFLICT (user_id, company_id)` has no matching non-partial unique index) | Unchanged; documented (needs a migration, §9) |
| `onboarding/complete`, setup-company "new company" | Insert the first registrant as COMPANY_ADMIN when no row exists | Not an invitation path | Unchanged |

**Root cause:** onboarding treated "an `invited` row exists" as "an invitation was accepted". Invited SUPER_ADMIN rows exist (015E made them confer nothing), so onboarding turned them into **active platform authority** outside `identity.admin.assign`.

**Fix (`acceptInvitationViaOnboarding`), all checks before any mutation:**
1. The stored row must be `invited`, with a role in the invitation vocabulary (`COMPANY_ADMIN`, `CONTENT_CREATOR`, `CONTENT_REVIEWER`, `CONTENT_PUBLISHER`, `VIEW_ONLY`). SUPER_ADMIN (any casing) or any other role → **403 `INVITED_ROLE_REQUIRES_GOVERNED_GRANT`**, with an audited denial.
2. A pending invitation must exist **for this company and the caller's verified email** (setup-company already requires `emailVerified`): not revoked, not accepted.
   - none → **409 `INVITATION_REQUIRED`**;
   - all expired → **410 `INVITATION_EXPIRED`**;
   - lookup error → 503.
3. The role that becomes active is the **invitation's** role. Neither the stored row's role nor anything in the request body is trusted.
4. The invitation is **claimed** first (`accepted_at IS NULL AND revoked_at IS NULL`). A replay or a concurrent acceptance → **409 `INVITATION_ALREADY_USED`**.
5. The membership is activated with compare-and-set on **id + role + `invited`** as read. A concurrent change → **409 `STALE_MEMBERSHIP`**, and the claim is released.
6. The audit row is the token flow's `INVITATION_ACCEPTED` (`via: 'onboarding'`). Tenant isolation: the lookup is by the membership's own `company_id`.

**SUPER_ADMIN grants** remain exclusively `bootstrap-super-admin` (active platform authority, `identity.admin.assign`, step-up), now through `assign_super_admin` (§6).

**Tests (`closure015mOnboardingArchive`):**
- an invited SUPER_ADMIN (with a valid invitation);
- non-invitation roles;
- an invitation carrying SUPER_ADMIN;
- an ordinary invitation;
- a forged body (`role`, `companyId`, `status`);
- a distrusted stored role;
- no, revoked, already-accepted, expired, other-company and other-email invitations;
- replay;
- two concurrent acceptances (exactly one wins);
- a claim race;
- membership-changed races, role and status (claim released);
- lookup and claim failures;
- the work-email branch;
- the token flow (SUPER_ADMIN invitation refused; ordinary accepted);
- a source check (no blind flip remains).

**Catches the original bypass:** on the pre-015M code, **27 of 31** of these tests failed, including the invited-SUPER_ADMIN bypass test. The 4 that passed were controls.

## 3. R-15 — archive status

**Lifecycle model** (`companies_status_check`, migrations `20260640_lifecycle_governance` / `20260642_legacy_baseline_columns` and the column comments):
- `companies.status` is the **reversible operational flag**: `active` / `inactive`, plus `suspended` in the CHECK;
- `deleted_at` is the **soft-delete tombstone**;
- `'archived'` appears in no migration, no constraint and no UI filter. Only `companyLifecycleService` maps it, defensively, and it is unreachable;
- the orphan detector classifies by members and status, and has no `archived` filter.

**Evidence:** on the throwaway database, `UPDATE companies SET status='archived'` → **23514 `companies_status_check`**. Every archive call failed, both before and after 015J's R-4 fix.

**Decision:**
- An archive of an abandoned org is the established **disable**: `status = 'inactive'` via `disable_company_cascade`, the same atomic path as `PATCH /api/super-admin/companies`.
- The CHECK is **not** expanded.
- Restore is the ordinary re-enable (`PATCH status=active`).
- `force=true` also deactivates the remaining members and revokes their sessions, which is what disable does.

| Behaviour | Result |
|---|---|
| Success | 200, `previousStatus` reported, status `inactive` |
| Repeat archive | Already `inactive` → 200 `idempotent`, no second cascade |
| Unauthorized (company admin) | 403 |
| Active SUPER_ADMIN, force included | **409 `SUPER_ADMIN_MEMBERSHIP`** (the protection is **not** weakened) |
| Lookup failure | 500 `DB_ERROR` (fail closed) |
| Not abandoned | 409 |
| Database guard refusal | 409 |
| Other RPC error | 500 |
| Restore | Through the enable PATCH → `active` |

**Compatibility:**
- The 015J status compare-and-set (`CONFLICT`) is replaced by the atomic RPC. Its concurrency boundary is the database guard.
- `companyLifecycleService`'s `archived` branch is now dead code (left untouched).

## 4. Throwaway PostgreSQL — identity and isolation evidence

| Check | Evidence |
|---|---|
| Docker state before | The daemon was **already running**, so nothing was auto-started. `docker ps -a` lists **no `omnivyra-worker`**, the production-connected container from the 2026-09-11 incident. Only the local `cert-supabase` stack and an exited `par-test` exist; neither was touched. |
| Container | `c15m-throwaway`, id `96e6ee92ee7d3d2c…`, image `pgvector/pgvector:pg17` (`sha256:cf134a767f47…`, local, `--pull never`), label `purpose=closure015m-throwaway`, `restart=no`, anonymous volume only |
| Network | Port `127.0.0.1:55433` only; the network is `bridge`. Env: only `POSTGRES_PASSWORD` (fresh random, redacted, never logged) and `POSTGRES_DB=c15m`; no env file. |
| Database | PostgreSQL 17.11; `system_identifier` **7697124109805277228** (a new cluster); `public` had **0 tables** before load; databases: `postgres`, `c15m`, templates |
| Load | `scripts/ci/schema-bootstrap.sql` + `supabase/_schema/baseline.sql` (1 expected error, 0 unexpected) → **823 tables**; the 45 migrations newer than ledgerMax `20260916000000` replayed, **0 failed**. This is the same recipe as `scripts/ci/real-schema-ci.sh`. |
| Re-check | Before applying the proposals, `system_identifier` and the container id/port/label were re-verified |
| Test guard | `backend/tests/realschema/setup.ts` refuses managed hosts. The control script refuses any URL other than `127.0.0.1:55433/c15m_ctl`. |

Evidence files: scratchpad `c15m/isolation_evidence.txt`, `apply_proposals.log`, `inspect.log`, `realschema_run1..4.log`, `realschema_final.log`, `control.log`, `probe_r15_r16.log`.

## 5. Real-Postgres validation — commands and results

**Installed objects** (inspected *before* any concurrency test, `inspect.log`):
- the trigger is `BEFORE INSERT OR UPDATE OF role, status, company_id`, enabled;
- `disable_company_cascade`, `soft_delete_company`, `hard_delete_company`, `assign_super_admin`, `save_rbac_config` are SECURITY DEFINER with EXECUTE for `postgres` and `service_role` only; the trigger function runs as the invoker;
- `rbac_config` has `version bigint IDENTITY(ALWAYS)` PK, `roles` and `permissions` NOT NULL with both CHECKs, RLS on, and `service_role` limited to `SELECT, INSERT`;
- `soft_delete_company` still delegates to the cascade;
- `read committed`, `deadlock_timeout = 1s`.

**Command** (W6_DB_URL built from the throwaway password file and never printed):
```
W6_DB_URL=postgres://postgres:<pw>@127.0.0.1:55433/c15m \
  node node_modules/jest/bin/jest.js --config jest.realschema.config.js --runInBand --forceExit --verbose \
  backend/tests/realschema/closure015l_company_lifecycle_guard.test.ts
```

**Results:** **37 / 37 passed, five times** (runs 1–4, plus the final run after all code changes: 37 / 37 in `realschema_final.log` and again in `realschema_final2.log` after the last test-file edit, i.e. six complete passes; the throwaway password never appears in any log).

| # | Brief item | Real-Postgres evidence |
|---|---|---|
| 1–3 | Concurrent SA grant vs disable / soft delete / hard delete | Writer first (UPDATE and INSERT) → the lifecycle is **blocked**, then **P0001 `COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP`**; SA active; company unchanged. Lifecycle first → the grant is blocked, then **`…_NOT_ACTIVE`** (disable, soft delete) or **`…_COMPANY_MISSING`** (hard delete): **no orphan** (015K RACE D closed). Identical results through `assign_super_admin`. |
| 4 | Grant into missing / deleted / disabled / suspended | Direct INSERT **and** `assign_super_admin` both refused (P0001); nothing written |
| 5 | Ordinary operations | Invite, activate, role change, deactivate and delete in an active company. An ordinary row is accepted even in a disabled company. Disable, soft delete and hard delete without an SA all work. An inactive SA row neither blocks nor survives a hard delete. A no-transition update or the governed revoke of an SA in a disabled company is allowed. |
| 6 | Concurrent grants and lifecycle under the lock order | Two `assign_super_admin` calls into one company **do not block each other** (FOR SHARE + FOR SHARE); grant vs lifecycle serialize on the company row |
| 7 | Rollback on refusal | After a refused disable, soft delete and hard delete, the company row and **every membership row (incl. `updated_at`) are unchanged**. A hard delete blocked by a non-cascading FK (`users.active_company_id`) rolls back **everything** (23503). |
| 8 | Deadlock / retry | **Direct-writer window:** exactly **one** transaction gets **40P01**; no active SA is deactivated or orphaned either way. **Same window through `assign_super_admin`:** **no 40P01**; the RPC waits on the company first, then is refused cleanly. **Bounded retry** (max 3 on 40P01) around disable behind a committed grant: refused (P0001); invariant intact. |
| 9 | RBAC config | Empty table → a guessed version is STALE; NULL creates v1. Two concurrent first saves → the second **waits on the advisory lock**, then is STALE. Two connections editing v1 → one commits v2, the other STALE; the **latest committed row is v2** with the winner's content. Sequential saves → v1, v2, v3 with strictly increasing `updated_at`. |
| 10 | Init / recovery / invalid data | Empty table → defaults (app) and v1 on the first save. Invalid whole documents **cannot be stored** (23514, even by a direct insert). A stored row with malformed *entries* is superseded by a governed save carrying its version. |

**Negative control** (`control.js`, `c15m_ctl` = a template copy, with the guard **removed** and the baseline cascade restored):
1. writer-first vs disable → **SUPER_ADMIN deactivated**;
2. RACE D → **orphan active SA row created**;
3. grant into a disabled company → **accepted**.

All three failure modes are reproduced without the guard, which shows that the 37 passing tests demonstrate the guard rather than passing vacuously.

## 6. Trigger, function and lock-order analysis; governed grant decision

| Actor | Lock sequence |
|---|---|
| Lifecycle functions | `companies` FOR UPDATE → (check) → `user_company_roles` rows |
| Governed grant `assign_super_admin` | `companies` FOR SHARE → membership row FOR UPDATE → write (trigger re-takes FOR SHARE, already held) |
| Direct writer UPDATE | Membership row (taken before BEFORE ROW triggers) → `companies` FOR SHARE (trigger). **Opposite order to lifecycle**, hence the observed 40P01. Safe, but a liveness cost. |
| Direct writer INSERT | `companies` FOR SHARE only. No deadlock observed or possible with lifecycle. |

**Decision: ADOPT `assign_super_admin`** (`bootstrap-super-admin.assignSuperAdmin` now calls it first). All five conditions in the brief are met, with evidence:
1. **Authorization boundary:** `requireCapability(identity.admin.assign)` + step-up still gate the route (403 for a company admin; the function is not called). EXECUTE is service_role only (verified ACL).
2. **Consistent lock order:** company, then membership, the same as lifecycle.
3. **Avoidable deadlock removed:** the same interleaving produced 40P01 with a direct UPDATE and **no 40P01** with the RPC (§5 #8).
4. **Same invariant:** 6 RPC race tests plus 4 forbidden-lifecycle tests pass.
5. **No bypass via direct writes:** the trigger applies to every writer.

**Not claimed:**
- Deadlocks are eliminated **only for the governed path.** Any direct UPDATE that turns an existing row into an active SA can still hit 40P01, safely.
- The database does not enforce *who* may grant SA (the R-14 class). That is closed in the application (§2). The optional GUC enforcement from 015L §2.4.1 remains an owner decision.

**Compatibility:**
- Function absent (PGRST202 / 42883) → the old two-statement path, unchanged.
- Company refused → 409 `company_not_active` / `company_missing`, with no fallback.
- Any other function error → 500, with no fallback.

## 7. `rbac_config` schema and migration review

| Topic | Finding / decision |
|---|---|
| Stale edits and ordering | Verified on real Postgres (§5 #9). The advisory xact lock serializes savers across connections; the identity column and strictly increasing `updated_at` keep read order = version order = commit order. |
| `updated_by` FK | **No FK, by evidence.** No application path hard-deletes `public.users` (deletion is soft, `is_deleted`, plus anonymization that keeps the id). The repo's audit identity convention (`audit_logs.actor_user_id`) has no FK. An FK would either block user deletion or, with `SET NULL`, erase the audit identity. The `uuid` survives deletion and anonymization; the who-and-when also lands in `audit_logs` (`SUPER_ADMIN_RBAC_UPDATE`). |
| Direct write paths | Exactly one: `saveRbacConfig`'s legacy `ownedDbTable('rbac_config').insert` (015J), used only when `save_rbac_config` is absent. No other code references the table (repo-wide grep). |
| Removal of the legacy path | **Not removed.** It keeps deployments without the migration working (and is harmless where the table is absent: the save fails, the read uses defaults). |

**Compatibility sequence:**

| Step | Action | State after |
|---|---|---|
| 0 | Current: no table | Reads → defaults; saves → 500 |
| 1 | Apply `03_rbac_config.sql` | Old app: legacy inserts get identity versions automatically (no stale detection yet). New app: RPC path. **Either order with step 2 is safe.** |
| 2 | Deploy the app (015J–015M) | GET returns `version`; POST stale-checked |
| 3 | Verify saves carry versions (operator query) | — |
| 4 | `REVOKE INSERT ON public.rbac_config FROM service_role` | Only the governed function can write; the legacy path then fails closed (500), unreachable once step 2 is live |

## 8. Gates, known failures and regression

| Gate | Result |
|---|---|
| Focused: `closure015mOnboardingArchive` (+ `membershipValidityDetector001`) | **39 / 39** (64 / 64 with the detector suite) |
| Pre-fix comparison (4 source files swapped to 015L, restored and sha256-verified, tree byte-identical) | 27 / 31 failed (the suite before the 8 later tests: governed-grant adoption, SUPER_ADMIN invitation, deactivation race) |
| Earlier suites after adaptation (015J, 015K, 015L, `closure013PlatformTierWriteSiblings`, `bootstrapEnvCredential`, `sec91W2EClientIpAdoption`) | 782 / 782 and 668 / 668 |
| Mutation (hardened: clean baseline, KILLED = a failing test, sha256-verified) | **24 / 24 killed.** Full run: 23 / 24 (baseline 30 suites / 1455 tests, clean). **M7** (activation not conditional on `status = invited`) **survived**; a test was added for a membership *deactivated* between read and activation; M7 re-run alone: **KILLED** (baseline 1456 tests, clean). M1–M15 R-14, M16–M21 R-15, M22–M24 governed-grant adoption. |
| Gate (015L set + touching + 015M = 355 suites; 015J/015K placeholder env) | 355 suites: **15 failing suites / 53 failing tests**, 2 skipped, 7939 passing, **0 load failures** |
| `typecheck-certification.js` | **PASS**: backend 0/0; backend-tests 256/259, **net-new 0**. The first gate run FAILED with 1 net-new identity (TS2339 in the new real-Postgres retry helper). Fixed with a cast, then re-run: PASS. |
| `check-migration-quality.js` | **OK**: 70 new valid, 353 frozen, 0 violations. No migration added; the proposals stay outside `supabase/migrations`. |
| `npm run typecheck` | **3/3 projects clean** |

**Regression versus Closure-015L (same placeholder env, by test name): 0 new failures, 0 newly passing.** The 53 failures are the same set as 015L, 015K and the pre-015J tree, including the real pre-existing `governance_performance_guard` overlap bug (015K §6).

The first 015M gate run showed **2 new failures** in `membershipValidityDetector001` (repository scan). Root cause: the detector classifies a membership query by searching for a status check within 1600 characters after it. The governed `assign_super_admin` block inserted into `bootstrap-super-admin.assignSuperAdmin` pushed the existing `row.status === 'active'` branch out of that window, so the byte-identical org-binding lookup at line 468 (previously SAFE only by proximity) became SUSPICIOUS.

It was **recorded in `scripts/membership-validity-baseline.json`** with a reason (it picks the company a *governed* grant is bound to and authorizes nothing), a caveat, a would-become-a-defect condition and an owner. The comment was not shortened to game the window. Re-run: passing.

## 9. Remaining blockers and operator checks

**New findings:**

| ID | Finding | Status |
|---|---|---|
| **R-16** | `activate_invitation_membership` (used by `auth/set-password`) fails on the baseline schema: (a) `company_id` is ambiguous between an OUT parameter and the table column; (b) `ON CONFLICT (user_id, company_id)` has no matching unique index (the only one is partial, `WHERE status='active'`). Unless production differs from the baseline, invitation activation through set-password returns 500 every time. | Not fixed (needs a migration). Owner decision; operator verify `pg_get_functiondef` in production. |
| R-17 | `companyLifecycleService` still maps the unreachable `'archived'` | Cosmetic; left |

**Operator checks (production, read-only):**
1. `pg_get_functiondef` of `disable_company_cascade`, `soft_delete_company`, `activate_invitation_membership`; `companies_status_check`; `to_regclass('public.rbac_config')`.
2. Invited SUPER_ADMIN rows (`role ILIKE 'super_admin' AND status = 'invited'`): exposure to the R-14 bypass before this fix. Active SA rows created without a matching `super_admin_bootstrap_completed` security event (possible past R-14 abuse).
3. Archive attempts (security events `archive_abandoned_org`) that failed with 23514 (R-15 impact).
4. Seeds and scripts that insert SA rows directly must target active companies (the trigger refuses otherwise).

**Proposed migration execution sequence** (each step needs explicit authorization):
1. Copy `01`, `02`, `03` into dated migrations (unique 14-digit versions; PR281 discipline: applied **and** ledgered).
2. Apply to a **cert/staging** database; run `backend/tests/realschema/closure015l_company_lifecycle_guard.test.ts` there (W6_DB_URL to that disposable or cert DB) and the negative control.
3. Deploy the app (015C–015M) — compatible before or after step 4.
4. Apply to production in a maintenance window: `01` (trigger + functions) → `02` → `03`. `NOTIFY pgrst, 'reload schema'`.
5. Smoke-test: disable a company with no SA (ok); with an SA (409); a governed grant (201); an RBAC save (version 1).
6. `REVOKE INSERT ON public.rbac_config FROM service_role` (§7 step 4).
7. Rollback per file (each file documents it). Dropping the trigger or functions restores the race; dropping `rbac_config` loses saved configs.

**Remaining release blockers:**
1. Nothing is committed (015C–015M).
2. Migration authorization and the sequence above.
3. R-16 decision.
4. Browser passkey verification of step-up flows (unchanged).

**Throwaway database:** `c15m-throwaway` was **stopped** (not deleted, so it can be inspected); its databases `c15m` and `c15m_ctl` exist only in its anonymous volume. Remove it with `docker rm -f -v c15m-throwaway`. Nothing else in Docker was touched.
