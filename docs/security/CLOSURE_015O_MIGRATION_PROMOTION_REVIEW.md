# CLOSURE-015O — Migration Package Promotion and Review

**Status:**
- Local only and uncommitted. Nothing is staged, committed, pushed or deployed.
- **No migration was executed against any shared or production database.**
- No env or credential file was read.
- The only SQL execution was inside the identity-verified disposable `c15n-throwaway` container, in a new database `c15o` (§5).

**Date:** 2026-10-16. **Worktree:** `C:/tmp/closure-014a`.

**Promotion is not certification.** Nothing here proves certification or production readiness; §7 lists what remains.

## 1. Verified repository state

| | Start | End |
|---|---|---|
| Branch / HEAD | `integration/closure-014a` @ `03724e86` (worktree `C:/tmp/closure-014a`) | unchanged |
| Staged | 0 | 0 |
| Tracked diff | 57 files, +1971 / −344, **byte-identical to the Closure-015M final diff** (cmp) | **unchanged, byte-identical** (015O changes no tracked file) |
| Untracked | 42 | 53: 42 + 5 promoted migrations + 5 rollback companions + this report |
| 015N report / proposals | sha256 `118e248a` / `2f5fb831`, `3f4e83e5`, `9453bfa3`, `3a89da7e`, `b39ffc49` | all unchanged (proposals retained as evidence) |

**015O files:**
- **New:** five migrations, five rollbacks, this report.
- **Edited (untracked test files):**
  - `backend/tests/unit/closure015lDatabaseGuardsRbac.test.ts`: one assertion inverted for post-promotion (§5);
  - `backend/tests/realschema/closure015l_company_lifecycle_guard.test.ts`: `C15N_NO_APPLY` switch so it can test installed (promoted) objects.

## 2. Source and destination files

**Naming convention** (`scripts/check-migration-quality.js`): `^\d{14}_[a-z0-9_]+\.sql$`, versions strictly after the newest existing (`20261202000000`), unique prefixes. Rollback companions go in `supabase/migrations/rollbacks/<slug>_rollback.sql` (exempt from the idempotency rules).

| # | Source (`supabase/proposals/closure015n/`) | Destination (`supabase/migrations/`) | Destination sha256 | Rollback companion |
|---|---|---|---|---|
| 1 | `01_company_lifecycle_super_admin_guard.sql` (`2f5fb831…`) | `20261210000001_company_lifecycle_super_admin_guard.sql` | `022efb77…` | `rollbacks/company_lifecycle_super_admin_guard_rollback.sql` |
| 2 | `02_assign_super_admin_rpc.sql` (`3f4e83e5…`) | `20261210000002_assign_super_admin_rpc.sql` | `4442c8f3…` | `rollbacks/assign_super_admin_rpc_rollback.sql` |
| 3 | `03_rbac_config.sql` (`9453bfa3…`) | `20261210000003_rbac_config.sql` | `604539ee…` | `rollbacks/rbac_config_rollback.sql` |
| 4 | `04_activate_invitation_membership.sql` (`3a89da7e…`) | `20261210000004_activate_invitation_membership.sql` | `9dac46fa…` | `rollbacks/activate_invitation_membership_rollback.sql` |
| 5 | `05_rbac_config_contract_legacy_insert.sql` (`b39ffc49…`) | `20261210000005_rbac_config_contract_legacy_insert.sql` | `82f32d4d…` | `rollbacks/rbac_config_contract_legacy_insert_rollback.sql` |

**Rollback companions:**
- Written from the documented rollback notes, with warnings.
- The 01 and 04 rollbacks embed the exact baseline function bodies, extracted programmatically from `supabase/_schema/baseline.sql`.
- The 04 rollback warns that it restores a function that cannot run.

## 3. Order and compatibility

**Order:** `…0001` lifecycle guard → `…0002` governed grant → `…0003` RBAC table and versioned save → `…0004` R-16 → **deploy the application (015C–015M)** → verify (C-7) → `…0005` contract.

| Migration | Old app × new DB | New app × old DB |
|---|---|---|
| 0001 | Safe. Disable or soft delete of a company holding an active SA → DB refusal shown as 500 by the old route (no 409 mapping); nothing changed. Old three-statement hard delete is unaffected (the trigger doesn't fire on DELETE). **Old onboarding R-14 is not closed by the DB** (§6). | Safe. Hard delete falls back to the 015K path (RACE D residual) |
| 0002 | Safe (never called) | Safe (PGRST202 → two-statement fallback) |
| 0003 | Safe. An empty table reads as defaults; old legacy inserts work and get identity versions (verified in 015N). **Refuses if `rbac_config` already exists** (`RBAC_CONFIG_ALREADY_EXISTS … use VARIANT B`): intentional, so a pre-existing table is never silently adopted with an unknown shape. | Safe (function absent → legacy path) |
| 0004 | Safe. `auth/set-password` starts working (today it always fails) | Same |
| 0005 | **Unsafe for old instances:** their legacy RBAC insert then fails (500) | Safe |

**R-16 targets the existing partial index:**
- `ON CONFLICT (user_id, company_id) WHERE status = 'active' DO NOTHING`, plus a precondition block that refuses (`R16_PRECONDITION_FAILED`) unless `idx_user_company_roles_user_company_active` exists with exactly that definition.
- No constraint or index is added (verified, §5).

**Compatibility risk created by promotion: 0005 is now in the batch-applicable set.**
- Any batch apply (`supabase db push`, a scripted "apply all pending" loop) would apply 0005 together with 0001–0004, **before** the application deploy, breaking old instances' RBAC saves.
- The repo's documented discipline (PR281: no deploy mechanism applies migrations; the operator applies each file explicitly and ledgers it) is the existing control, but it is procedural.

**Owner decision, one of:**
- **(a) Recommended: ship 0005 in a separate follow-up PR**, merged only after the deploy and C-7. The first PR carries 0001–0004 plus rollbacks.
- **(b)** Keep 0005 in this PR and add an explicit opt-in precondition (e.g. `RAISE` unless a session setting such as `app.rbac_contract_confirmed = 'on'` is set). That is a semantic change to the reviewed SQL, and `scripts/ci/real-schema-ci.sh`, which replays every migration, would then need to set it.
- **(c)** Keep 0005 as is and rely on the procedural control.

Not changed in this task (the brief forbids silent rewrites).

## 4. SQL differences introduced during promotion

Promoting byte-identically **fails the repository's migration gate**. Running the checker's own rule functions (`idempotencyViolations`, `securityViolations`) on the raw proposals gives **5 violations**; on the promoted files, **0** (`scratchpad/c15o/rules_raw_vs_promoted.log`).

Each was fixed with the smallest compliant change:

| ID | File | Change | Rule | Equivalence |
|---|---|---|---|---|
| H | all 5 | Two header comment lines (provenance + source sha256) | — | Comment only |
| A1 | 0001 | `-- search-path-ok: …` annotation above `CREATE OR REPLACE FUNCTION public.disable_company_cascade` | SECURITY DEFINER must pin `search_path`, else annotate | **Comment only.** The function keeps the baseline's unpinned settings exactly as reviewed and validated. **Pinning it is a recommended follow-up** (it would change the validated function). |
| A2 | 0001 | `REVOKE ALL ON FUNCTION public.disable_company_cascade(uuid,uuid,text) FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role;` | SECURITY DEFINER must REVOKE from client roles | Same privilege state `20261026000000_close_anon_rls_exposure` already establishes (CREATE OR REPLACE preserves privileges). Only on a database where that migration is missing does this *tighten* access. |
| A3 | 0003 | `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` | Idempotency | **Exactly equivalent:** the preceding DO block raises `RBAC_CONFIG_ALREADY_EXISTS` whenever the table exists, so the `IF NOT EXISTS` branch is unreachable |
| A4 | 0004 | `REVOKE ALL ON FUNCTION public.activate_invitation_membership(uuid,uuid,timestamptz) FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role;` | Same as A2 | Same as A2 (`set-password` uses the service-role client) |

**No function body, trigger, constraint, index or column changed.** This was proven on Postgres (§5): the installed definitions from the promoted files are **md5-identical** to those installed from the proposals for all 10 objects:
- `guard_super_admin_membership_company`, `disable_company_cascade`, `soft_delete_company`, `hard_delete_company`, `assign_super_admin`, `save_rbac_config`, `activate_invitation_membership`;
- the trigger;
- the `rbac_config` columns and constraints.

The full textual diff is in `scratchpad/c15o/promotion.diff`.

## 5. Static, migration-check and isolated validation results

| Check | Result |
|---|---|
| `node scripts/check-migration-quality.js` | **OK**: 75 new migrations valid (70 + 5), 353 frozen, ordering floor `20261026000000`, **0 violations** |
| Rule functions, raw vs promoted | Raw: 5 violations (above); promoted: 0 |
| Every suite that reads `supabase/migrations` (42 suites, e.g. `closeAnonRlsExposureMigration`, `closure014CapabilityGrantPolicy`, `dg001SerpConflictTargetContract`) | **42 / 42 suites, 990 passed, 1 skipped** |
| `node scripts/typecheck-certification.js` | **PASS**, net-new 0 |
| `npm run typecheck` | **3/3 projects clean** |

**Isolated real-Postgres validation** (`scratchpad/c15o/validate_promoted.sh` → `validate.log`):

| Step | Result |
|---|---|
| Container identity, verified before use | id `6b629cc23116…` = the 015N evidence; `exited`; label `purpose=closure015n-throwaway`; `restart=no`; `127.0.0.1:55434`; its volume used only by it → **certain**, so used. Started, then stopped again afterwards (Docker's stop timeout escalated to a kill, exit 137; harmless for a disposable DB). |
| New clean database `c15o` (template0; 0 public tables before) | bootstrap + baseline (0 unexpected errors), then **the exact `real-schema-ci.sh` replay**: 50 migrations newer than ledgerMax, **0 failed**; the promoted ones applied **in order 0001 → 0005** |
| Re-run every promoted migration | 0001, 0002, 0004, 0005: exit 0 (idempotent). **0003: refused with `RBAC_CONFIG_ALREADY_EXISTS`** (intended) |
| Installed definitions, promoted vs proposals | **IDENTICAL**, 10 / 10 objects (md5) |
| Privileges after the replay | Every SECURITY DEFINER function: EXECUTE for `postgres` + `service_role` only. `rbac_config`: RLS on, `service_role=r` (INSERT revoked by 0005). |
| `closure015l_company_lifecycle_guard` (`C15N_NO_APPLY=1`, promoted objects, nothing re-applied) | **37 / 37** |
| `closure015n_invitation_activation` (`C15N_NO_APPLY=1`) | **27 / 27** |

The disposable database password does not appear in any artefact.

**Not run in this task:**
- the full default jest regression gate: no tracked file changed; the 015M result (355 suites, 0 new failures) still describes the tracked tree;
- the R-16 and lifecycle negative controls: 015N evidence, unchanged SQL bodies;
- the SQL mutation run: 015N, 11/12 with 1 equivalent.

## 6. Direct-grant enforcement — decision required

**What confers authority:** an **ACTIVE `user_company_roles` row with role `SUPER_ADMIN`** (`hasActiveSuperAdminRow`, `principal.organizations`). `users.role` is written by revoke but no authorization check reads it as SUPER_ADMIN authority.

**Inventory of paths that can produce that row:**

| Path | Mechanism | Governed | Status |
|---|---|---|---|
| `bootstrap-super-admin` mode `promote` | `requireCapability(identity.admin.assign)` + step-up → `assignSuperAdmin` → **`assign_super_admin` RPC** (0002), fallback two-statement write while absent | Yes | The intended path |
| `bootstrap-super-admin` mode `bootstrap` (first SA, self-promote) and `env-credential` (break-glass recovery) | Same `assignSuperAdmin` → RPC; mode-specific gates in the route | Yes (the legitimate administrative recovery paths) | Kept |
| Onboarding (`setup-company`) | Was a **bypass (R-14)** | — | **Closed in the app (015M)**; not enforced in the DB |
| Invitation acceptance (`team/accept-invite`, `activate_invitation_membership`) | Role from the invitation (`invitations_role_check`), plus explicit checks (015M, 0004) | n/a | Cannot produce SA |
| Every other membership writer (invites, users/create, role PATCHes, transfer, free credits) | Refuse SUPER_ADMIN (015E–015J) | n/a | App-enforced |
| Any **service_role** direct write (a future bug or a new route) | PostgREST as `service_role` | **No** | **Not enforced in the DB today**: the 0001 trigger checks *company lifecycle*, not *who* grants |
| Operator SQL console, migrations, seeds, `scripts/cert/validate-grant-impact-query.cjs` | Direct SQL as the database owner (`postgres`) | Out of band | Legitimate (recovery, fixtures) |
| Runtime direct-pg connections (`settlementGovernanceRuntime`, `company-grounding`) | `pg` with a configured DSN (role not verified here, since env was not read) | — | Do not write memberships today |
| Legacy cookie super-admin bridge | **In-memory** SA principal, no DB row | — | Refused for writes by `platformWriteAuthority`; outside any DB restriction |

**Is a DB restriction needed?**

Today the guarantee "only the governed function grants SA" rests on the **application**. Every known writer refuses SA except `bootstrap-super-admin`, which uses the function. The database guarantees only the lifecycle invariant. A DB restriction converts the remaining class (a future service_role code path, like R-14 was) from "app review" into "refused by the database".

**Decision options:**

| Option | Mechanism | Compatibility impact | Residual |
|---|---|---|---|
| **A. No DB restriction** | Status quo after 0001–0004 | None | Any new service_role writer bug can mint SA (R-14 class) |
| **B. Role-based guard (recommended)** | Extend `guard_super_admin_membership_company`: refuse a *transition into* active SA when `current_user` is `service_role` / `authenticated` / `anon`. Inside `assign_super_admin` (SECURITY DEFINER, owned by `postgres`) `current_user` is the owner, so it passes. Operator, migration and seed sessions as `postgres` pass. | 0002 must be applied **with or before** it (the app's PGRST202 fallback writes as `service_role` and would be refused, which is correct once 0002 exists). Cert/test fixtures that insert SA as `service_role` must switch to the RPC or to `postgres`. | Principals connecting as `postgres` (operator, runtime direct-pg DSNs, if those are owner-level) bypass by design. The guarantee covers PostgREST-mediated writers, i.e. the entire application write path. |
| C. GUC-based guard | Require `current_setting('app.governed_sa_grant', true) = 'on'`, set via `SET` on `assign_super_admin` | As B, plus seeds and fixtures must set the GUC | Any SQL-capable principal can `SET` it, so it's weaker than B; it does not stop a raw SQL session |

**Tests required before adopting B** (real Postgres, disposable DB):
1. As `service_role`: direct INSERT and direct UPDATE into an active SA → refused (P0001); the app's PGRST202 fallback is refused once the guard exists.
2. As `service_role` via `assign_super_admin` → succeeds, with the lifecycle checks intact.
3. As `postgres` (migration/operator) → succeeds.
4. Revoke (SA → COMPANY_ADMIN), deactivation and no-transition updates as `service_role` → allowed.
5. The R-14 reproduction (invited SA row flipped to active as `service_role`) → refused by the DB even with the 015M app fix reverted.
6. Re-run the 015L/015N suites, the negative controls, and the bootstrap route tests; update `bootstrapEnvCredential` and cert fixtures.

Not implemented here, per the brief.

## 7. Remaining certification and production checks

1. **Cert / staging:** apply 0001 → 0004 to the cert database by explicit file (not batch), ledger them, `NOTIFY pgrst, 'reload schema'`. Run both realschema suites (`C15N_NO_APPLY=1`) and the negative controls there. Run the app's cert flow: disable/delete with and without an SA; a governed grant; an RBAC save (version 1, then a stale 409); invitation set-password.
2. **Production operator checks C-1 … C-9** (015N §6), in particular:
   - C-2: the exact partial index (0004 refuses otherwise);
   - C-5: whether `rbac_config` exists (VARIANT A vs B; 0003 refuses if it exists);
   - C-8: whether the function definitions equal the baseline (0001 and 0004 replace them wholesale).
3. **Production:**
   - 0001 → 0004 by explicit file, ledgered, during a window;
   - deploy the app;
   - verify C-7 (new RBAC rows come from `save_rbac_config`);
   - then 0005.
4. **Follow-ups (not blockers for 0001–0004):**
   - pin `search_path` on `disable_company_cascade` (A1);
   - lock in the 3 resolved type-check baseline errors (`npm run typecheck:certification:baseline` in a dedicated commit);
   - point the realschema suites' default mode at the promoted migrations instead of the proposals.

## 8. Checklist for the next authorization

- [ ] **Decide 0005 placement:** (a) follow-up PR (recommended), (b) opt-in guard, or (c) procedural only.
- [ ] **Decide direct-grant enforcement:** A (none) or **B (role-based guard; recommended)** or C. If B: author it as a new migration plus the §6 tests.
- [ ] **Authorize staging and commit** of the 015C–015O series: the tracked diff (57 files) plus untracked suites, reports, proposals, the 5 migrations and 5 rollbacks. Then the PR and its CI.
- [ ] **Authorize cert application** of 0001–0004 (explicit files) and the cert test run (§7.1).
- [ ] **Operator production evidence** C-1…C-9.
- [ ] **Authorize production application** of 0001–0004, the app deploy, C-7, then 0005.
- [ ] Browser passkey verification of step-up flows (open since 015J).
- [ ] Remove `c15n-throwaway` (`docker rm -v c15n-throwaway`) once review no longer needs it. It is stopped and holds `c15n`, `c15n_ctl` and `c15o`.
