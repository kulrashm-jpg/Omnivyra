# CLOSURE-015J — Final Privileged-Membership and Configuration Review

**Status:** local only and uncommitted. Nothing is staged, committed, pushed, deployed or migrated. There was no production access and no database, Redis or BullMQ operation. No env or credential file was read.

**Date:** 2026-10-16.

**Worktree:** `C:/tmp/closure-014a`, branch `integration/closure-014a`. HEAD is `03724e86`; this was verified, and HEAD is unchanged by this phase.

## 1. Repository state

| | |
|---|---|
| Branch / HEAD | `integration/closure-014a` @ `03724e86` (verified at start and end) |
| Staged | 0 files |
| Tracked diff (015C … 015J combined) | 53 files, +1488 / −310 |
| 015J tracked changes | 27 files (23 source + 4 existing test fixtures), +1097 / −220 |
| 015J new files | `backend/tests/unit/closure015jFinalReview.test.ts` (90 tests), `backend/tests/unit/closure015jRbacTabSave.dom.test.tsx` (2 tests), this report |
| Untracked total | 29 (earlier-phase suites + reports, DEEPTECH docs, these files) |
| Earlier reports | 015A–015I unchanged (sha256 prefixes: 015E `7321db46`, 015F `0a106b2c`, 015G `26e9121f`, 015H `50ec7223`, 015I `21d7ed3f`) |
| Control bytes / CR | none in any 015J-changed or new file (`grep -laP`) |

**015J source files:**

| Area | Files |
|---|---|
| R-4 archive | `pages/api/super-admin/companies/archive-abandoned.ts`, `backend/services/orgOwnershipRecoveryService.ts` |
| R-7 transfer ownership | `pages/api/super-admin/companies/transfer-ownership.ts`, plus the service above |
| R-8 user creation | `pages/api/super-admin/users/create.ts`, `backend/apiHandlers/superAdmin/usersCreateShared.ts` |
| R-9 company deletion | `pages/api/super-admin/companies.ts` |
| R-5 onboarding | `pages/api/onboarding/setup-company.ts` |
| R-6 free credits | `pages/api/super-admin/free-credits/{grant,requests}.ts` |
| R-10 rate limits | `pages/api/users/[userId]/{role,index}.ts`, `pages/api/company/users/[userId]/role.ts`, `pages/api/governance/{unlock,restore-snapshot}.ts` |
| R-10 governed revoke | `pages/api/admin/revoke-super-admin.ts` |
| R-11 / R-12 RBAC config | `backend/services/rbacService.ts`, `pages/api/super-admin/rbac.ts`, `components/super-admin/tabs/RbacTab.tsx` |
| R-13 re-invites | `backend/apiHandlers/company/usersShared.ts`, `pages/api/company/users.ts`, `backend/apiHandlers/superAdmin/{usersShared,usersMutations}.ts`, `pages/api/company/users/reinvite.ts` (and `users/create` above) |

**Existing test fixtures changed** (test-side only; each change is explained in §4):

- `backend/tests/unit/crossOrganizationIdentityAdminBinding.test.ts`
- `backend/tests/integration/user_lifecycle_management.test.ts`
- `backend/tests/integration/governance_lockdown.test.ts`
- `backend/tests/integration/governance_snapshot.test.ts`

## 2. Outcomes R-4 … R-13

Policy applied throughout:

- An ordinary route never removes, demotes or overwrites platform SUPER_ADMIN authority. The governed `identity.admin.assign` / `identity.admin.revoke` flows remain the only path.
- Legitimate operations are kept.
- Every write that depends on a prior read is conditional on the values read (compare-and-set). A stale write answers 409; it never overwrites.

| ID | Outcome | What changed |
|---|---|---|
| **R-4** archive-abandoned | **FIXED** | Removed `organizationId` from the `ORGANIZATION_DELETE` check: same mechanism as F-5. `AuthorizationService` waives actor-in-org only for `identity.admin.assign`, and an abandoned org has no active members, so every platform SA was refused `NOT_ORG_MEMBER`. Platform write authority, step-up and the rate limit still apply; the org remains the audited resource. The archive update is now conditional on the status read (snapshotted at read time); 0 rows → **409 CONFLICT**. A failed active-member count used to be treated as `0` ("abandoned"); it is now **500 DB_ERROR** (fail closed). |
| **R-5** onboarding self-demotion | **FIXED (removed)** | `setup-company` no longer runs `update({role:'COMPANY_ADMIN'}).eq('role','SUPER_ADMIN')` on the caller's memberships. The new company's own membership is still created as COMPANY_ADMIN. |
| **R-6** free credits | **FIXED (removed)** | `free-credits/grant` and `free-credits/requests` no longer "downgrade accidental SUPER_ADMIN". An existing SUPER_ADMIN (or any existing) membership is left as is; insert-when-missing is unchanged. |
| **R-7** transfer-ownership | **FIXED** | (a) A SUPER_ADMIN membership on **either** side → **409 SUPER_ADMIN_MEMBERSHIP**; revoke first. The to-side mattered: the promote overwrote SUPER_ADMIN with COMPANY_ADMIN. (b) `demoteToRole` was taken from the request unvalidated, SUPER_ADMIN included. It is now case-normalized and must be one of CONTENT_CREATOR, CONTENT_REVIEWER, CONTENT_PUBLISHER or VIEW_ONLY, else **400 INVALID_DEMOTE_ROLE**. (c) Promote and demote are now conditional on role + `active` as read; a concurrent change → **409 CONFLICT**. If the demote conflicts after the promote, the org is left in the safe two-admin state. Legitimate transfer is unchanged. |
| **R-8** users/create | **FIXED** | A read-only pre-check runs **before any side effect** (auth provisioning, users row, membership, invitation). If the email's user holds a SUPER_ADMIN membership in the company (any status) → **403 SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE**; a lookup error → 503. `upsertCompanyRole` repeats the refusal as a backstop for a race past the pre-check, and now reads **all** rows for the user and company. |
| **R-9** company deletion | **FIXED (precondition)** | DELETE, hard or soft, is refused with **409 COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP** while the company holds an **active** SUPER_ADMIN membership. Revoke or reassign it first through the governed flow. Invited, inactive or expired SA rows confer nothing and do not block. A lookup error → 503. Deletion of other companies is unchanged. |
| **R-10** step-up route safeguards | **FIXED (bounded)** | The Closure-014 (D) per-route rate limit (`requireAdminRateLimit …, { sensitive: true }`) was added to `users/[userId]/role` (`rl:users:role` 10/60), `users/[userId]` DELETE (`rl:users:remove` 10/60), `company/users/[userId]/role` (`rl:company:users:role` 10/60), `governance/unlock` (5/60) and `governance/restore-snapshot` (5/60). Each sits after the method check and before the capability/step-up decision. `admin/revoke-super-admin` now reads back the downgraded memberships; a downgrade error → **500 MEMBERSHIP_DOWNGRADE_FAILED** `{partial:true, completed:['users_role_downgraded']}` (it was ignored). It also writes a strict business audit row `SUPER_ADMIN_REVOKE` (actor, target, downgraded memberships and count). If that audit write fails, the response is **500 REVOKED_AUDIT_FAILED** `{revoked:true}`, which states truthfully that the revocation stands. **Not claimed:** exactly-once. Revoke is not wrapped in `withIdempotency`; its effect is idempotent (conditional on `role='SUPER_ADMIN'`, so a repeat changes nothing, `downgraded_count 0`), but each call writes its own audit row. |
| **R-11** incomplete RBAC config | **FIXED** | The write contract is a **full replacement** (the UI always sends the declared roles and every permission shown). No partial-update contract exists, so none is preserved. `validateRbacConfigInput` runs before any read or write and refuses (400):<br>• `roles` missing, non-array or empty → `RBAC_ROLES_REQUIRED`<br>• an unknown or non-string role → `RBAC_ROLE_UNKNOWN`<br>• `permissions` not a non-empty object → `RBAC_PERMISSIONS_REQUIRED`<br>• a blank key → `RBAC_PERMISSION_KEY_INVALID`<br>• keys duplicated after normalization → `RBAC_PERMISSION_KEY_DUPLICATE`<br>• a value that is not an array of strings → `RBAC_PERMISSION_VALUE_INVALID`<br>• a role that is not declared → `RBAC_PERMISSION_ROLE_NOT_DECLARED`<br>The H-4 wildcard refusal keeps precedence and its exact response. The route no longer replaces a missing `roles` with `[]`, which had collapsed to `['SUPER_ADMIN']` and stripped every tenant role. An explicit `[]` value is accepted and grants nobody. **Stored config, fail closed:** a stored permission value that is not an array of strings now grants **nobody** (a scalar used to be wrapped and accepted). The 015I contract for a whole-row shape error (built-in defaults, never allow-all) is unchanged; see §6. The audit records the normalized stored config. |
| **R-11b** RBAC tab save *(new finding)* | **FIXED** | `RbacTab` POSTed with **no `Idempotency-Key`** to a `withIdempotency` route, so every save was refused with 400; it also never ran the identity.admin step-up ceremony (F-5 class). It now uses `performSuperAdminWrite` + `freshIdempotencyHeaders()` (a fresh key per attempt) and changes local state only on a confirmed 2xx. |
| **R-12** ordering / stale load | **FIXED without migration (residual documented)** | Reproduced in the harness:<br>(a) two saves in the same millisecond tie, and latest-by-`updated_at` can return the older row;<br>(b) a load in flight during a save re-caches the pre-save config for 30 s.<br>Fixes, none needing a migration:<br>• Saves issue a strictly increasing `updated_at`: max(now, newest stored + 1 ms, last issued by this process + 1 ms). The ordering read fails closed (500, nothing written).<br>• A cache generation is bumped on every clear, and a load caches only if the generation is unchanged.<br>• A residual tie (two instances, same millisecond) is resolved **deterministically**, so every instance picks the same row; the choice is by content, not by time.<br>**Residual:** two instances that read the same latest row and write in the same millisecond still tie, because there is no DB-assigned order. A strict order needs a migration (a sequence/identity column or a unique version column plus compare-and-set on it). Per the brief that migration is **not added**; it is an owner decision. Note: **`rbac_config` has no DDL anywhere in the repo and is absent from the 823-table production-derived `baseline.sql`.** Whether the table exists in production is operator evidence (§7). |
| **R-13** re-invite resets an active member | **FIXED on all four paths** | 015J found two more paths than R-13 named:<br>• `POST /api/company/users`<br>• `POST /api/super-admin/users`<br>• `POST /api/super-admin/users/create` (new): magic-link mode rewrote an active member with a different role to `invited`<br>• `POST /api/company/users/reinvite` (new): it **deleted every membership row** and re-inserted `invited`<br>On every path, **all** rows for the user and company are read; there is only a partial unique index on active rows, so an arbitrary `limit(1)` row decided before. Any active row → **409 ALREADY_ACTIVE_MEMBER** before any write, invitation or email; role changes of active members go through the governed role routes. `users/create` keeps its documented same-role no-op. A non-active row (invited, expired or inactive) is re-invited as before, but conditionally on id + role + status (reinvite: per-row conditional deletes). A concurrent activation → **409 STALE_MEMBERSHIP**, and the active row survives. A SUPER_ADMIN row is refused in every upsert as a backstop. |

**G — deferred items and the retired route:**

- **H-3 stays deferred:** no single-active-admin constraint and no unique index. The migration plan remains in the 015I report.
- **`/api/users/invite` still returns 410.**
- **Source-caller audit of `/api/users/invite`:** no caller in application source. Only tests (015C/D/E/I and `user_lifecycle_management` pin the 410), docs, and a comment in `scripts/check-withrbac-binding.js` refer to it. `userManagementService.inviteUser` is exported but no route uses it any more; it is retained for its tests and can be removed with the route.

## 3. Commands and results

All jest runs use `CI=true`, `--runInBand`.

**Hermetic environment.** Since 015I the worktree has **no `.env.test`/`.env.cert`/`.env`**. The first gate run therefore failed to load 110 suites (`SUPABASE_URL` undefined). Env files may not be inspected, so none was copied in. All gates were then run with an inline placeholder environment:

- loopback addresses on **unreachable ports** (`SUPABASE_URL=http://127.0.0.1:1`, `REDIS_URL=redis://127.0.0.1:1/15`);
- dummy keys.

These are not credentials and nothing listens on those ports. For a like-for-like comparison the **pre-015J tree was gated under the same environment**.

**Pre-015J tree** = HEAD + the recorded 015I baseline diff, rebuilt per file by an exact-context patch applier. It was swapped in temporarily; afterwards every file was restored and sha256-verified, and the tracked diff was confirmed byte-identical after each run.

| Step | Result |
|---|---|
| Focused: `closure015jFinalReview` + `closure015jRbacTabSave.dom` | **92 / 92 pass** |
| Same two suites on the **pre-015J** code | **68 fail / 24 pass**. Every defect test fails before the fix; the 24 that pass are unchanged-behaviour and authorization controls. |
| Reinvite-adjacent suites (`closure015cInviteRoleGovernance`, `closure015dIdentityLifecycle`, 015J) | 169 / 169 |
| Mutation (hardened runner; 23 suites, 1286 tests; clean baseline required; KILLED = a failing test) | **44 / 44 killed, 0 survivors**, after sha256 verification of all 25 files (§3a) |
| Pre-015J gate (351 suites, placeholder env) | 17 suites failing; 122 tests failing; 0 load failures |
| **Final gate** (351 suites, final tree, placeholder env) | **16 suites failing; 54 tests failing; 2 skipped; 7829 passing; 0 load failures** |
| `node scripts/typecheck-certification.js` | **PASS**: `tsconfig.backend.json` 0/0; `tsconfig.backend-tests.json` 256/259 (no net-new error identities) |
| `node scripts/check-migration-quality.js` | **OK**: 70 new migrations valid, 353 frozen, 0 violations. **015J adds no migration.** |
| `npm run typecheck` | **3/3 projects clean** |

**Gate set:** the 015I gate set (346 suites), plus every suite importing a 015J-changed module (75), plus the 2 new suites = **351**. Five suites are new to the set: the 2 new ones, plus `onboard001Contracts`, `setupCompanyIdentityAdoption` and `setupCompanyValidatedIdentity`. The last three pass on both the pre-015J and the final tree (22/22).

### 3a. Mutants (all KILLED)

| Group | Mutants |
|---|---|
| R-4 | J1 org binding restored; J2 archive compare-and-set dropped; J3 count error treated as zero; J4 zero-row archive treated as success |
| R-7 | J5 SA guard removed; J6 only the from-side guarded; J7 `demoteToRole` unvalidated; J8 promote compare-and-set dropped; J9 demote compare-and-set dropped |
| R-8 | J10 pre-check removed; J11 upsert backstop removed |
| R-9 | J12 guard removed; J13 lookup error ignored |
| R-5 / R-6 | J14 free-credit demotion restored; J15 onboarding demotion restored |
| R-10 | J16 / J17 rate limits removed; J18 audit failure masked; J19 downgrade error ignored; J20 audit actor nulled |
| R-11 | J21–J28: each validation rule removed in turn, plus stored-value coercion restored |
| R-12 | J29 monotonic stamp removed; J30 generation check removed; J31 tie resolution removed; J32 ordering-read error ignored |
| R-13 | J33–J40, J43, J44: active refusal or status compare-and-set removed on each path; route conflict mapping removed; `users/create` pre-check removed |
| UI | J41 save without `Idempotency-Key`; J42 one key reused across the step-up retry |

**Caveat:** J15 (R-5) is killed by a **static source assertion**. The 908-line onboarding route is not driven end-to-end here; its three existing suites pass.

## 4. Baseline comparison

**Final versus pre-015J, same environment, by test name:**

- **New failures: 1.** `publishNowService.capability › Instagram + image post WITH media reaches the adapter` timed out at 30 s inside the 25-minute gate. It passes **3/3 in isolation**, also passed in the preceding full gate run, and no 015J file touches publishing. Classified as a **flaky timeout, not a regression**.
- **No longer failing: 69.** All 69 are the new 015J tests, which do not exist on the pre-015J tree. No other test changed state.
- The remaining 54 failures (16 suites, e.g. the route-auth scanners, `community_ai_*`, `recommendation_engine`) fail **identically on the pre-015J tree**. They are pre-existing.

**Fixture changes driven by 015J** (each was a new failure in the first final-tree gate run, and fixed test-side):

- `user_lifecycle_management` ×2, `governance_lockdown` ×1, `governance_snapshot` ×2: the hand-built requests had no `headers`, which the new R-10 rate limiter reads. Real Next.js requests always carry headers. Fix: `headers: {}`.
- `crossOrganizationIdentityAdminBinding` "updated by its primary key only":
  - it seeded an **active** member, which R-13 now correctly refuses;
  - its DB mock ignored the scripted rows unless the read ended in `.limit(1)`.

  Fix: the mock now resolves reads with the scripted rows and update read-backs with the matched id. The fixture uses a non-active row, and the filter assertion becomes `{id, role, status}` (still bounded to one row id). Added: an active row is refused with no write.

**Versus the 015I baseline (54 names):** not directly comparable, because the 015I run had an env file that no longer exists. The paired same-env comparison above replaces it.

## 5. Concurrency coverage

The harness reproduces each of the following:

- **R-4:** the org status changes between read and archive.
- **R-7:** the to-user is promoted to SA before the promote; the from-user is promoted to SA before the demote.
- **R-12:** two saves in the same millisecond; a newer row from another instance or clock skew; a stored tie in both row orders; a load in flight across a save.
- **R-13:** activation between read and write on all four paths; an active row next to a stale non-active row.

These results hold for the in-memory harness only, not for Postgres isolation semantics.

## 6. Deferred decisions and residuals (owner)

1. **H-3** single-admin policy: still deferred, with the plan in the 015I report.
2. **R-12 strict DB order** needs a migration (identity/sequence or a version column with compare-and-set). The same-millisecond cross-instance tie is deterministic but content-ordered. The cache is per instance, so other instances converge within the **30 s TTL**.
3. **R-11 whole-row shape error in a stored config:** the built-in defaults are used (the 015I contract, never allow-all). The alternative is deny-all, which would lock out every tenant permission. A DB **read error** also falls back to the defaults for 30 s (pre-existing, unchanged).
4. **R-9 is a read-time precondition,** not atomic with the deletion; an SA activated in between is not caught. Atomic enforcement belongs in `soft_delete_company` or a DB trigger.
5. **R-10:** `revoke-super-admin` has no `withIdempotency`. Its effect is idempotent; its audit is per call. The other step-up routes were not given new idempotency wrappers (route-specific scope only).
6. **R-13 residuals:**
   - repeated re-invites of a non-active member each send an invitation (no dedupe, as before);
   - two concurrent **first** invites can create two `invited` rows, since uniqueness covers only active rows (pre-existing).
7. **Transfer-ownership CONFLICT after the promote** leaves two admins. This is safe; the operator retries.
8. **archive-abandoned `force=true`** can archive an org that holds an SA membership. It sets status only and removes no membership; withRBAC exempts SA.
9. **Final removal of `/api/users/invite` + `inviteUser`** waits on the access-log evidence in §7.
10. Unchanged from 015I: F-4 (company admins on the company role PATCH), and about 27 billing/cron/intel MANAGE routes without write authority.

## 7. Operator-only evidence (not accessed by this phase)

Production ref `klkiseupptzbecbxwrky`; read-only queries or log exports by the operator.

1. **Access logs, `POST /api/users/invite`**, over at least the last 30–90 days: request counts by status, user agent and origin, and authenticated user ids. Zero non-test callers is needed before final removal.
2. **Logs / `security_audit` for `super-admin/companies/archive-abandoned`:** count of `NOT_ORG_MEMBER` denials (R-4 impact before the fix).
3. **`rbac_config`:**
   - `to_regclass('public.rbac_config')`;
   - column list and types (is `updated_at` `timestamptz`?) and any `id`/sequence column;
   - row count and the newest two `updated_at` values (existing ties);
   - whether any stored value is a non-array or non-string, since such values now grant nobody.
4. **`user_company_roles`:**
   - active SUPER_ADMIN memberships per company (which companies R-9 now protects from deletion);
   - rows with `status IS NULL`;
   - (user, company) pairs with more than one row;
   - active members with a pending invitation.
5. **Free-credit grants / onboarding history:** any SUPER_ADMIN → COMPANY_ADMIN downgrades written by the removed R-5/R-6 code (`updated_at` + role), so the operator can decide whether any governed SA was silently demoted and needs restoring through `identity.admin.assign`.

## 8. Still required beyond this phase

- **Real-Postgres verification** of every conditional write (`.eq/.is` chains with `.select()` read-back) and of the uniqueness behaviour: the partial unique index on active rows, the R-13 per-row deletes, and the transfer compare-and-set. All 015J evidence is in-memory.
- **Browser passkey (WebAuthn) verification** of the step-up flows: the RbacTab save (now step-up + fresh key), revoke, transfer, archive and company delete.
- **Production verification** that `rbac_config` exists (§7.3).
- A **full-repo suite run with a real non-production env file**, provided by the operator. This phase used placeholders.

## 9. Release blockers

1. **Nothing is committed.** The whole 015C–015J series (53 tracked files plus untracked suites and reports) needs commit authorization, review and a PR.
2. **Owner decisions** in §6: H-3, the R-12 migration, the R-11 stored-shape policy, R-9 atomicity, and F-4.
3. **Operator evidence** in §7, especially `rbac_config` existence (R-11/R-12 are latent if the table is absent) and `/api/users/invite` access logs.
4. **Real-Postgres and browser passkey verification** (§8).
5. **Deployment coordination:**
   - Several clients now receive new 409/400 codes (`ALREADY_ACTIVE_MEMBER`, `STALE_MEMBERSHIP`, `SUPER_ADMIN_MEMBERSHIP`, `INVALID_DEMOTE_ROLE`, `COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP`, `RBAC_*`).
   - UI messaging for these codes relies on the generic error banners and is not individually designed.
   - The RbacTab fix must ship with the route.
