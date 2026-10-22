# CLOSURE-015U — Final operator packet

**Purpose:** everything the release operator needs to produce the missing evidence. Nothing here has been executed against production.

**Sources** (hashes verified in 015U):

| Source | Hash |
|---|---|
| `CLOSURE_015N_MIGRATION_SEQUENCE_AND_R16.md` §6 (C-1…C-9 definitions) | `118e248a…` |
| `CLOSURE_015T_RELEASE_READINESS_REVIEW.md` | `a1ce873b…` (gitignored by `*_READINESS*.md`, preserved) |
| `CLOSURE_015S_CERTIFICATION_MIGRATION_RESULTS.md` | `9725d7a5…` |
| `CLOSURE_015Q_RBAC_EFFECTIVE_PRIVILEGES.md` | `d27e2d05…` |
| `CLOSURE_015R_PRE_C7_PRIVILEGE_REDUCTION.md` | `0b1c06b1…` |

## 0. Release unit (verified 015U)

| Item | Value |
|---|---|
| Branch / worktree | `integration/closure-014a` @ `C:/tmp/closure-014a` |
| Commits (one unit, in order) | `4301771a158665e261cc00dbdb9fe253790baebd` → **`5444b0afca4cdec86753f8db3997407f1a9c2d93`** (HEAD); base `origin/main` `5604b50b` (fully contained) |
| Published? | **No**: no upstream; no remote ref contains either commit |
| Worktree | clean (0 staged, 0 modified); untracked reports + historical proposal only |
| Must ship together | yes: CI real-schema fails on `4301771a` alone (015R §4) |

| Migration (apply in this order) | sha256 (prefix) |
|---|---|
| `supabase/migrations/20261210000001_company_lifecycle_super_admin_guard.sql` | `022efb77d4eb53b7` |
| `…/20261210000002_assign_super_admin_rpc_and_direct_grant_guard.sql` | `1da6b58a3f7a57a8` |
| `…/20261210000003_rbac_config.sql` (VARIANT A) | `604539ee9868a405` |
| `…/20261210000004_activate_invitation_membership.sql` | `9dac46fa229f639e` |
| `…/20261211000001_rbac_config_pre_c7_privilege_reduction.sql` | `51453281b3cbba04` |
| **Deferred, NOT a migration:** `supabase/deferred/rbac_config_contract_legacy_insert.sql` | `dbc310b677445255` |

## 1. Operator role and prerequisites (no person named)

The **production database operator** must be authorized by the release owner and hold:
- **Production access:** read-only SQL access to project **`klkiseupptzbecbxwrky`**. Verify it **by project ref**, never by Studio name.
- **For the migration window only:** a session as the schema owner (`postgres`). The prior rule still holds: *no deploy mechanism applies migrations; Studio does not write the migration ledger*, so the operator inserts ledger rows explicitly.
- **Deploy dashboards:** read access to Vercel (production deployment id + git SHA) and Railway (worker deployment SHA and the **auto-deploy-on-merge setting**).

The **browser tester** (§5) needs a non-production app instance and test identities. They must be arranged by the owner (§5.1).

**Rules:**
- Every preflight query runs as `BEGIN READ ONLY; … ROLLBACK;`.
- Record per check: query, output, timestamp, operator role, verdict.
- **Global stop condition:** an unexpected result → **stop, change nothing**, report to the owner.

## 2. Production preflight (read-only)

### 2.1 C-1…C-9 (criteria preserved from 015N §6; later refinements cited)

| ID | Check | Evidence | Pass | Fail / stop |
|---|---|---|---|---|
| C-1 | `SELECT user_id, company_id FROM user_company_roles WHERE status='active' GROUP BY 1,2 HAVING count(*)>1` | rows | **empty** | any row |
| C-2 | `pg_get_indexdef('public.idx_user_company_roles_user_company_active'::regclass)` | text | `UNIQUE … (user_id, company_id) WHERE (status = 'active'::text)` | missing or different (0004 refuses: `R16_PRECONDITION_FAILED`) |
| C-3a | invited or inactive `SUPER_ADMIN` rows (R-14 exposure) | count + rows | 0, or each explained | unexplained row → owner review |
| C-3b | active SA rows lacking a bootstrap security event | active SA rows LEFT JOIN `capability_audit_log` ON `principal_user_id = user_id AND decision = 'super_admin_bootstrap_completed'` | each active SA has an event or a recorded explanation (e.g. created by SQL before event logging) | unexplained → owner review |
| C-4 | active SA rows in non-active, soft-deleted or **missing** companies | count + rows | 0 | any row → owner review |
| C-5 | `to_regclass('public.rbac_config')` and its columns | result | **absent → VARIANT A** | present → **stop** (0003 refuses `RBAC_CONFIG_ALREADY_EXISTS`; VARIANT B needs an owner decision) |
| C-6 | invitations outside the invitation vocabulary; `invitations_role_check` present? | constraint def + count of roles outside `COMPANY_ADMIN, CONTENT_CREATOR, CONTENT_REVIEWER, CONTENT_PUBLISHER, VIEW_ONLY` | constraint present; 0 rows | otherwise → owner review |
| C-7 | (after the deploy, before the deferred contract) `SELECT version, updated_at FROM rbac_config ORDER BY version DESC LIMIT 5`: new saves come from `save_rbac_config` | **§4** (rows alone cannot decide it) | §4 E1–E6 all pass | any failure → deferred contract **forbidden** |
| C-8 | `pg_get_functiondef` of `disable_company_cascade`, `soft_delete_company`, `activate_invitation_membership` equals the baseline | `md5(replace(pg_get_functiondef('<sig>'::regprocedure), E'\r', ''))` | `f797809dd1a8c428f5b0ecef0b725ed6` / `1e8fc9d7c458f7254c1b70d03703ae6d` / `40df3c928bf9764bfde0600e2fd260c5` | mismatch → **stop** (0001/0004 would overwrite a changed body) |
| C-9 | seeds/scripts that insert or activate SA rows directly must target active companies | inventory of production-run seeds, scripts and operator SQL writing SA memberships | all identified; target active companies; **run as the owner**, because since 0002 a service_role write is refused with `SUPER_ADMIN_GRANT_NOT_GOVERNED` | unknown writer → owner review |

**C-3 column question:**
- **Resolved from repository source.** The writer is `SecurityAuditService.ts:144-163`, which writes `capability_audit_log.decision` / `principal_user_id` / `resource_id`. `baseline.sql` defines `decision text NOT NULL` and `principal_user_id uuid`. The deployed `origin/main` bootstrap emits the event (`mode=promote`, `mode=env-credential`, `bootstrap`).
- **Still to confirm on production:** that the table has these columns (`\d capability_audit_log`). If it does not, mark C-3b **UNRESOLVED** and stop.

### 2.2 Additional preflight items (P-1…P-8; from 015T §3.2, grounded in 015P–015S evidence; not part of the C-1…C-9 definitions)

| ID | Item | Evidence | Pass (cert reference) | Fail / stop |
|---|---|---|---|---|
| P-1 | Target identity | project ref; `system_identifier`; `current_database()`; `version()` | ref `klkiseupptzbecbxwrky`; PG 17.x | any doubt |
| P-2 | Ledger / schema compatibility | `supabase_migrations.schema_migrations` (max version, any `202612*`); presence of `trg_guard_super_admin_membership_company`, `assign_super_admin`, `hard_delete_company`, `save_rbac_config` | none of the release versions or objects present | partial presence → stop |
| P-3 | `rbac_config` table, columns, indexes, constraints | as C-5 | absent | present → C-5 |
| P-4 | **Default privileges and role inheritance** | `pg_default_acl` for owners `postgres` and `supabase_admin` in `public`; `pg_auth_members` for `authenticator`, `service_role`, `authenticated`, `anon`; **members of `pg_write_all_data` and `pg_maintain`**; `rolsuper`/`rolbypassrls` of the app roles | cert: postgres defaults give service_role ALL (`arwdDxtm`) and authenticated `arwdxtm` on new tables and `rwU` on sequences; authenticator memberships NOINHERIT; 0 members of `pg_write_all_data`/`pg_maintain` | any other role that would inherit writes on new tables → **20261211000001 will abort** (`RBAC_PRIVILEGE_REDUCTION_POSTCONDITION`). Owner decides before migrating |
| P-5 | Effective privileges after 0003 (during the window) | 015Q matrix (`has_table_privilege` / `has_sequence_privilege` for every role) | service_role ALL; sequence `rwU` service_role and authenticated | — |
| P-6 | `save_rbac_config` (after 0003) | `prosecdef`, owner, `proconfig`, ACL | SECURITY DEFINER; owner `postgres`; `search_path=public`; EXECUTE service_role only | deviation → stop before 20261211000001 |
| P-7 | Governed save usable | after the deploy: §4 | — | — |
| P-8 | **Deployed commits and deploy triggers** | Vercel production deployment id + SHA; Railway worker SHA; **Railway auto-deploy-on-merge setting (dashboard; NOT in repo: `railway.json` declares no trigger)**; `vercel.json` has `git.deploymentEnabled=false` (manual web deploy) | both planes on the `origin/main` lineage (`5604b50b`), an ancestor of `5444b0af` | not an ancestor → redo the compatibility analysis against the real deployed code |

## 3. Migration and deployment sequence

### 3.1 Required migration order

**0001 → 0002 → 0003 → 0004 → 20261211000001**, one file at a time:
1. `psql -v ON_ERROR_STOP=1 < <file>` as owner;
2. ledger `(version, name)`;
3. `NOTIFY pgrst, 'reload schema'` after 0002, 0003 and 0004, which create functions;
4. **stop on the first error**: inspect read-only, no improvised repair.

After 20261211000001, verify with the 015S strict checks:
- service_role table privileges = `INSERT,SELECT`;
- no sequence privileges for service_role or authenticated;
- anon, authenticated, authenticator and PUBLIC hold nothing;
- the all-role scan finds no other writer.

### 3.2 Compatibility facts (from code; the 015N table predates 015P/015R)

| Window | Effect | Evidence |
|---|---|---|
| Old app (`origin/main`, presumed deployed) × 0002 | **Super-admin bootstrap/promote outage**: all three modes write SA rows directly as service_role, which 0002 refuses (`SUPER_ADMIN_GRANT_NOT_GOVERNED`). Fails closed (500) until the new web app is deployed. Same window: old onboarding activation of an invited SA (R-14) is refused, which is intended | `origin/main:pages/api/admin/bootstrap-super-admin.ts:491-507`; no other old-app SA writer (repo grep) |
| Old app × 0001 | disable / soft delete of a company holding an active SA → refused → 500 (fails closed) | 015N §4 |
| Old app × 0003 / 20261211000001 | safe: the old app only SELECTs and `.insert()`s `rbac_config` | `origin/main:backend/services/rbacService.ts:125, 154` |
| Old app × deferred contract | **unsafe** (the legacy insert fails) | 015N §4 |
| New app × old DB | safe: PGRST202 / `FUNCTION_MISSING` fallbacks | `rbacService.ts:373-444`; `lifecycleGovernance.ts:200`; `bootstrap-super-admin.ts:489-505` |
| Merge to `main` | **may deploy the Railway worker immediately** (setting unverified, P-8). Compatible: new code × old DB is safe. The web plane is manual | `railway.json`, `vercel.json` |

### 3.3 Options

| | (a) Migrations → deploy | (b) Deploy → migrations |
|---|---|---|
| Sequence | preflight → merge (auth.) → 0001–0004 → 20261211000001 → web deploy (+ worker if not already) → C-7 → deferred contract | preflight → merge (auth.) → web + worker deploy → 0001–0004 → 20261211000001 → C-7 → deferred contract |
| Window | bootstrap/promote unavailable from 0002 until the web deploy (fails closed; break-glass = owner SQL) | none functional; **DB-level guards absent** until the migrations land (only the app-level fixes protect R-14 and the lifecycle; RACE D residual) |
| Security posture during window | DB closes R-14 and the lifecycle races even for the old app | depends on application code only |
| Evidence | every step tested on cert (015P/015S) and on isolated copies (015Q/015R) | new app × old DB proven by the fallback paths (015N/015O) |

**Recommendation: (a), with the window kept short.**
- Apply the migrations, then deploy the web app immediately.
- Freeze super-admin grants for the duration; use owner SQL for any emergency.

**Why (a):**
- The only cost is a fail-closed outage of a rare administrative operation.
- (b) would run production without the database guards that Closure-015 exists to add.

**Owner decision D-2 confirms or overrides this.**

## 4. Before the deferred contract can be considered (C-7 evidence)

Rows alone cannot distinguish legacy from governed saves (015Q §10). **All** of the following must pass:

| E | Evidence | Pass |
|---|---|---|
| E1 | Vercel production and Railway worker SHAs contain `4301771a` (lineage of `5444b0af`); no older deployment still serves traffic | recorded SHAs + promotion complete |
| E2 | `save_rbac_config` present, SECURITY DEFINER, EXECUTE service_role only; PostgREST schema reloaded | catalog (P-6) |
| E3 | One RBAC save through the deployed UI by an active SUPER_ADMIN after passkey step-up: **the POST response has a numeric `version`** (`rbacService.ts:436`; the legacy path returns `version: null`, `:482`) | numeric `version` |
| E4 | The newest `rbac_config.version` equals E3's `version` | equal |
| E5 | A save with a stale `expectedVersion` → **409 `rbac_config_stale`** (`pages/api/super-admin/rbac.ts:42-43`; only the governed path detects staleness) | 409 |
| E6 | The C-7 source query output (last 5 rows) recorded | recorded |

**Then:**
- the deferred contract is promoted as a **new, separately reviewed migration** with a version above every applied migration, applied individually;
- the final state is verified (015Q): service_role SELECT only; governed save, stale 409 and repair work; legacy INSERT → 42501.

**Not provable from logs.** The legacy fallback emits no log, so its absence cannot be shown from logs. E3 and E5 are production writes performed by the authorized operator.

## 5. Real-browser passkey test (not yet run)

### 5.1 Prerequisites the owner must arrange or authorize

1. **A non-production app instance** (cert stack or equivalent), started by someone permitted to load its configured environment. This review may not read it.
   - `WEBAUTHN_RP_ID=localhost` and `WEBAUTHN_RP_ORIGIN=http://localhost:3000`: one host string everywhere.
   - `SESSION_COOKIE_SECRET` of at least 32 characters.
2. **Test identities:**
   - **A:** an active platform SUPER_ADMIN with an enrolled passkey and a canonical `omnivyra_session`;
   - **B:** an invited (non-active) SUPER_ADMIN;
   - **C:** a tenant or viewer user;
   - **D:** an active SUPER_ADMIN without a passkey.

   No seed creates these.
3. **A dedicated browser profile**, never the user's existing sessions: Chrome with a platform authenticator or security key, or the DevTools WebAuthn virtual authenticator (CTAP2, internal, resident key, UV on). Keep the UA, language and cookie set stable: the trusted-device fingerprint is `djb2(UA | Accept-Language | cookie names)`.
4. **Read-only DB access** to `stepup_sessions`, `trusted_devices`, `webauthn_challenges`, `auth_sessions` and `capability_audit_log`. The audit log is the only place the step-up denial reason is visible; the wire code is always `401 STEP_UP_REQUIRED`.

### 5.2 Evidence for every journey

- a HAR (status, `code`, `x-omnivyra-correlation-id`);
- a UI screenshot;
- DB rows filtered by correlation id;
- the object's state before and after.

### 5.3 Journeys

| # | Case | Expected | Fails if |
|---|---|---|---|
| J1 | A enrolls a passkey | 201; listed | — |
| J2 | A: RBAC save without step-up | 401 `STEP_UP_REQUIRED` → prompt → verify 201 (cookie rotated) → trust 201/409 → retry with a new Idempotency-Key → 200 with a numeric `version` → success text | success before the 2xx; `version` null |
| J3 | A: second elevated action within 10 min | no prompt; 2xx | prompt or 401 |
| J4 | A: after 10 min / step-up row expired (non-prod) | 401 → prompt; audit `STEP_UP_EXPIRED` | succeeds without a ceremony |
| J5 | A cancels the prompt | "Step-up was cancelled…"; no change | any success UI or change |
| J6 | A: untrusted device (change language or a cookie) | 401 → prompt (audit `TRUSTED_DEVICE_REQUIRED`) → re-trust revives the row → 2xx. **Check UI-3:** a "trust failed / 409" message after a successful trust | write without trust |
| J7 | A: revoke device / logout | step-up sessions revoked; next action prompts | old step-up accepted |
| J8 | B: any platform write | 403 `PLATFORM_SUPER_ADMIN_REQUIRED`, no prompt | prompt or 2xx |
| J9 | C: platform write | 403 `CAPABILITY_NOT_HELD` / `PLATFORM_SUPER_ADMIN_REQUIRED` | 2xx |
| J10 | D: write | "Step-up is not available… Enroll a passkey" | false success |
| J11 | A: CompanyUsersTab create admin / resend invite / user status / role / delete; `/admin/users` invite / role / remove | prompt (if needed) → 2xx; success only after 2xx | success on 4xx |
| J12 | A: provider credential add/edit/delete; platform OAuth save. **Check UI-2:** the provider toggle flips, then reverts | prompt → 2xx | lasting false success |
| J13 | A: replay a captured verify payload / reuse a challenge | 401 `CHALLENGE_REJECTED` / `COUNTER_REPLAY` | accepted |
| (J-UI-1) | A: company disable / delete from the UI | **known gap**: error alert, no prompt (pre-existing) | — (record only) |

## 6. Release decision state

All of the following are outstanding:
- the C-1…C-9 and P-1…P-8 production evidence;
- the real-browser J1–J13 evidence;
- the owner decisions in `CLOSURE_015U_OWNER_DECISION_REGISTER.md`.

No security or validation failure is open in the release unit: all local, certification and isolated-copy gates passed (015P–015S).

# **BLOCKED — OPERATOR EVIDENCE REQUIRED**
