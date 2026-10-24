# Closure-015D — Identity Lifecycle and Global-Route Step-Up Results

**Status: LOCAL, UNSTAGED, UNCOMMITTED.** No production access, production queries or remote operations. No push, PR, merge or deploy. No database rows read or written, no migration and no schema change. Nothing staged or committed. Credentials and `.env` files were not inspected. No worker or application was started. The recommendation-audit writer/schema and the destructive deletion routes were not touched.

| Workstream | Classification |
|---|---|
| A — five global routes | **PARTIAL** (3 FIXED · 2 authorization FIXED, step-up classification BLOCKED) |
| B — `/api/users/invite` role policy | **FIXED** |
| C — reinvitation of privileged users | **FIXED** |
| D — invited-membership authority and expiry | **PARTIAL** (invited SUPER_ADMIN FIXED · invited COMPANY_ADMIN, authorization-time expiry and company status BLOCKED) |

---

## 1. Baseline and working tree

| Item | Value |
|---|---|
| Repository root | `C:/tmp/closure-014a` |
| Branch | `integration/closure-014a` (as expected) |
| HEAD | `03724e86969cd9d022fd191e142e914e04963b8a` (as expected; unchanged at end) |
| Staged at start / at end | 0 / 0 |
| Starting diff | The Closure-015C working tree: 8 modified + 4 untracked code files. Snapshot `scratchpad/c15d/baseline.diff`, sha256 `9dedc636…80bd3`, all preserved. |
| Branch operations | None (no reset, stash, clean, rebase, amend or switch) |

The earlier reports are byte-identical at the end of this phase:

| Report | sha256 |
|---|---|
| 015 | `b8eb1988740b9c9b01935c856e430049b9411a0729ce80ee01b35b9f861294f2` |
| 015A | `7c9964440d9783d3298737f24f88f4c6736aa799ef31a5f93d4cf9e49a98fe78` |
| 015B_REVIEW | `e4a155fdeef61342efc9eff464b1b97becec9f69b824aeeb1d7ad95c8693f342` |
| 015C | `45de3490fe42de40003ea15942f37216a5e4af3a06330d2991b1e69a169117f9` |

## 2. Workstream A — the five global routes

### 2.1 Established policy used

The rule comes from the Closure-009 owner decision (`CLOSURE_009_010_RELEASE_PREPARATION.md`). Platform-wide **controls and kill-switches** use `platform.controls.manage` with passkey step-up on a trusted device, plus active platform `SUPER_ADMIN`. The capability's own definition reads: "platform-wide runtime CONTROLS whose misuse disables safety for every tenant: rollout overrides and kill-switches … policy gate". **Operational recovery writes** (DLQ re-drive, cache flush, planner force-mode/rollout/features, observability baseline) use dashboard view plus active platform `SUPER_ADMIN`, with **no step-up**.

No new capability was introduced. The 015C guard (`requireActivePlatformSuperAdmin`) still runs first on every route.

### 2.2 Route by route

| Route (file) | Effect (traced) | Authorization after 015D | Status |
|---|---|---|---|
| `POST /api/governance/unlock` (`pages/api/governance/unlock.ts`) | Clears the single platform-global `governance_lockdown` row. That lock is set automatically on integrity risk (`GovernanceAuditService:62`) and blocks campaign mutations for **every** tenant: preemption, duration, blueprint, pre-planning, commit-plan, release, schedule-structured-plan. Releasing it is disabling a platform safety gate. | `withRBAC([SUPER_ADMIN])` → 015C guard → `requireCapability(PLATFORM_CONTROLS_MANAGE)` (passkey + trusted device, 10 min) → `enforcePlatformWriteAuthority` (audited) → write | **FIXED** |
| `POST /api/governance/restore-snapshot` (`restore-snapshot.ts`) | `GovernanceSnapshotService.doRestore` **also rewrites the platform-global `governance_lockdown` row** from the snapshot, so a restore can release the lock exactly as unlock does. It also deletes and replaces the snapshot company's governance audit runs. | Same chain as unlock. Checked before the snapshot is read or anything is written. | **FIXED.** Owner may prefer a dedicated capability (decision A-2). |
| `POST /api/governance/rebuild-projection` (`rebuild-projection.ts`) | Recomputes one campaign's derived `governance_projections` row from its event ledger (idempotent, per-campaign lock). | Active platform SA (015C), no step-up | **Authorization FIXED; step-up BLOCKED** (decision A-1) |
| `POST /api/opportunities/refresh-slots` (`refresh-slots.ts`) | Runs the scheduler cron job (`backend/scheduler/cron.ts:1079`) on demand: reopens due items and fills slots for every active company. | Session path: active platform SA (015C), no step-up. Cron path (`Bearer CRON_SECRET`, constant-time) unchanged. | **Authorization FIXED; step-up BLOCKED** (decision A-1) |
| `GET /api/omnivyra/health` (`health.ts`) | Returns the **in-process** Omnivyra client telemetry: `status`, per-endpoint call counts, latency, `last_success_at`/`last_failure_at`, `last_error_reason`/`last_error_type`, `success_rate`, `last_error`. No tenant data and no credentials. Upstream error strings are recorded in `last_error_reason`; the one config-derived string is `'Missing OMNIVYRA_BASE_URL'` (a variable name, not a value). | Active platform SA (015C), **no step-up** (read). Not moved to `super_admin.dashboard.view`: that capability is also held by legacy-bridge principals and direct grantees, so moving would **broaden** access. | **FIXED** (read policy). Response not narrowed: no sensitive field identified. |

**Ordering evidence.** For every route, all authorization runs before the effect. The tests prove each effect spy is never called on refusal. For unlock and restore, an allowed call records `elevated_route_accessed` (`PLATFORM_CONTROLS_MANAGE`), and a refused one never does.

## 3. Workstream B — `/api/users/invite` role policy (FIXED)

### 3.1 Vocabularies compared

| Source | Role names |
|---|---|
| Server role model `rbacPrimitives.Role` | SUPER_ADMIN, ADMIN, COMPANY_ADMIN, CONTENT_MANAGER, CONTENT_REVIEWER, CONTENT_PUBLISHER, CONTENT_PLANNER, CONTENT_CREATOR, CONTENT_ENGAGER, VIEWER, VIEW_ONLY |
| `normalizeRole` (deterministic aliases) | ADMIN → COMPANY_ADMIN; CONTENT_MANAGER, CONTENT_PLANNER → CONTENT_CREATOR; CONTENT_ENGAGER, VIEWER → VIEW_ONLY. Also tolerates `COMPANYADMIN`, `CONTENTPLANNER` and spaced spellings. Unknown → `null`. |
| `/admin/users` UI (`pages/admin/users.tsx`) | CONTENT_MANAGER, CONTENT_PLANNER, CONTENT_CREATOR, CONTENT_ENGAGER, plus ADMIN for SUPER_ADMIN/ADMIN viewers. All are exact `Role` keys. |
| Governed path `admin/invite-user` `VALID_ROLES` | COMPANY_ADMIN, CONTENT_CREATOR, CONTENT_REVIEWER, CONTENT_PUBLISHER, VIEW_ONLY |
| `invitations_role_check` | Same 5 as `VALID_ROLES` |
| `user_company_roles.role` | `text NOT NULL`, **no CHECK constraint** |
| Existing compatibility test (`user_lifecycle_management`) | CONTENT_MANAGER |

### 3.2 Policy implemented

`INVITABLE_ROLES` is the server `Role` vocabulary minus `SUPER_ADMIN`, compared case-insensitively (exact key after upper-casing). This is derivable from the code alone, so no policy was invented. It keeps every UI and compatibility-test name and rejects everything else:
- unknown names (e.g. `OWNER`);
- platform-only roles outside the vocabulary (`CONTENT_ARCHITECT`);
- `normalizeRole` alias spellings (`COMPANYADMIN`, `content creator`);
- padded or injection-shaped values.

These were previously **stored verbatim**. They are now refused with `400 { error: 'UNSUPPORTED_ROLE', allowedRoles: [...] }` before any user, membership or audit row is written. The response lists only public role names.

`SUPER_ADMIN` keeps its explicit `403 SUPER_ADMIN_NOT_ASSIGNABLE_HERE`, and rewriting an existing `SUPER_ADMIN` membership keeps `403 SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE` (both from Closure-015C). Grant and revocation stay on `identity.admin.assign` / `identity.admin.revoke`.

Not done:
- **Step-up on `/api/users/invite`:** no established policy. Owner decision B-1.
- **Finding, out of scope, not changed:** the sibling `PATCH /api/users/[userId]/role` (`updateUserRole`) has the same P3 bypass. An active platform SA can set `SUPER_ADMIN` (or any string) on any membership, without the governed grant path and without step-up. Owner decision B-2.

## 4. Workstream C — reinvitation, acceptance and expiry (FIXED)

The changes are in `pages/api/company/users/reinvite.ts`:

1. **No SUPER_ADMIN by reinvitation.** If the preserved membership role normalizes to `SUPER_ADMIN` (any status: active, invited, inactive, expired), the route answers `403 SUPER_ADMIN_NOT_REINVITABLE` **before any write**. Nothing is deleted or inserted, no invitation is revoked or created, and no email is sent. Recovery of a privileged role stays on the governed path (`identity.admin.assign`, which writes `status='active'`). No new activation mechanism was created.
2. **The invitation names the role acceptance activates.** The invitation insert now carries `role`. The preserved membership role is mapped onto `invitations_role_check` by the **existing** `normalizeRole` aliases:
   - ADMIN → COMPANY_ADMIN;
   - CONTENT_MANAGER, CONTENT_PLANNER → CONTENT_CREATOR;
   - CONTENT_ENGAGER, VIEWER → VIEW_ONLY;
   - canonical names map to themselves.

   Before this change, the omitted column took its DB default `CONTENT_CREATOR`, so acceptance (`team/accept-invite.ts:153`, RPC `activate_invitation_membership`) **silently demoted** a re-invited administrator.
3. **Fail closed.** A preserved role with no invitation mapping (e.g. `CONTENT_ARCHITECT`) gets `409 ROLE_NOT_REINVITABLE` and nothing is written.

**Acceptance and expiry** (`team/accept-invite`, unchanged code, now proven through the real route):
- Acceptance activates exactly `invitation.role`, which now matches the membership's normalized role.
- An expired invitation gets 404 "expired"; the membership stays `invited` and the invitation unaccepted.
- A revoked (superseded) invitation gets 404.
- A different signed-in email gets 403.

Expiry is enforced at **acceptance** time, on both paths: `team/accept-invite.ts:75` and `auth/set-password.ts:74`.

## 5. Workstream D — invited-membership authority and expiry (PARTIAL)

### 5.1 Facts established (code)

- **The only governed SUPER_ADMIN writer** is `assignSuperAdmin` (`admin/bootstrap-super-admin.ts:489-516`, behind `identity.admin.assign`). It always writes `status='active'`.
- **`admin/invite-user` cannot create a SUPER_ADMIN.** Its `VALID_ROLES` excludes it, and `invitations_role_check` excludes it, so **acceptance can never activate one**.
- **An invited SUPER_ADMIN row therefore has no legitimate producer and no completion path.** Its only producer was the ungoverned reinvite, now closed (§4).
- **Yet four places granted it authority before acceptance:**
  - `getUserRole` invited fallback → `withRBAC`/`enforceRole` would see role `SUPER_ADMIN` for that company. This is the P1 class: 14 `withRBAC([SUPER_ADMIN])`-only routes, plus `verify-snapshot`'s `tenantConstraint = null` and three other handlers that branch on `role === SUPER_ADMIN`.
  - `enforceCompanyAccess` legacy fallback (b).
  - `resolveCompanyAccess`.
  - `lib/platform/policyGate.ts`, where `isPlatformSuperAdmin` was true for **any active or invited** SUPER_ADMIN membership. This is a platform-wide grant. It is latent only because the gate is observation-only in Phase 1 (`observePolicy` never blocks); it would have become live with enforcement.

### 5.2 Change made: the conservative default the brief authorizes

`SUPER_ADMIN` was removed from the invited-membership fallback in `rbacService.getUserRole`, `userContextService.enforceCompanyAccess` and `contentArchitectService.resolveCompanyAccess`. `policyGate` now derives `isPlatformSuperAdmin` from an **active** SUPER_ADMIN membership only, the canonical `isPlatformSuperAdminPrincipal` predicate.

The **invited COMPANY_ADMIN / ADMIN fallback is unchanged** (documented as deliberate existing behaviour). `withRBAC` itself is not changed.

### 5.3 Impact analysis

Counts are non-comment call lines in `pages/`, `backend/`, `lib/`, `hooks/` and `components/`, excluding tests and definitions:

| Helper | 015A count | 015D count |
|---|---|---|
| `withRBAC(` | 81 | 81 |
| `enforceRole(` | 103 | 105 |
| `enforceCompanyAccess(` | 495 | 574 |
| `getUserRole(` | 103 | 115 |
| `resolveCompanyAccess(` | 43 | 42 |

The differences are counting method: the 015A method counted call sites differently. Of the `withRBAC` routes, 37 admit `SUPER_ADMIN` and 14 admit **only** `SUPER_ADMIN`.

**Who is affected.** Only a principal whose **only** membership in the requested company is a `SUPER_ADMIN` row with `status='invited'`. Before, that principal had SUPER_ADMIN (or invited-admin) authority for that company in every one of the helpers above. Now it has none there.

**Who is not affected:**
- **Active platform SAs:** every bypass (`enforceRole`, `TenantGuard`, `resolveCompanyAccess`, `getUserCompanyRole`) already required an active row and is unchanged.
- **Active members:** unaffected.
- **Invited COMPANY_ADMIN/ADMIN:** unaffected.
- **Invited non-admin roles:** they already had no fallback.
- **Inactive or expired rows:** already conferred nothing.

**Legitimate flows broken:** none identified, because no governed flow produces or completes an invited SUPER_ADMIN.

**Production prevalence of invited SUPER_ADMIN rows is unknown.** Production was not queried. That is integration blocker I-2.

Side effect, verified by test: Closure-015C's T12 recommendation-audit pins are now satisfied for the invited principal, because `withRBAC([SUPER_ADMIN])` refuses it. No audit code changed. What an **active** platform SA may read there remains owner decision 6.

### 5.4 Not changed (BLOCKED, owner decisions)

- **Invited COMPANY_ADMIN / ADMIN authority before acceptance** (`getUserRole`, `enforceCompanyAccess`, `resolveCompanyAccess`, `campaignAccessService`). Documented as deliberate. Decision D-1.
- **Invitation expiry at authorization time.** No authorization helper consults `invitations`. An invited COMPANY_ADMIN membership keeps its fallback authority after its invitation expires, or with no invitation at all (015C T10 characterization, still true). Nothing writes `user_company_roles.status='expired'`. Decision D-2.
- **Company operational status is not checked consistently:**
  - `enforceCompanyAccess` (`TenantGuard` plus invited-fallback re-check) and `campaignAccessService` reject non-operational companies.
  - `withRBAC` / `enforceRole` / `getUserRole` and `resolveCompanyAccess` **never read `companies.status`**.

  Decision D-3.
- **`policyGate` company-scoped view** still includes **all** invited roles (including invited non-admin roles) in `organizationRoles`. This is pre-existing and observation-only, and differs from `getUserRole`. Only the platform-wide flag was fixed. Decision D-4, before Phase 2 enforcement.

## 6. Changed files

All files are unstaged. Totals versus HEAD: 14 tracked files, +158 / −14, plus untracked files.

| File | Phase | Reason |
|---|---|---|
| `pages/api/governance/unlock.ts` | 015C+**015D** | 015D: `PLATFORM_CONTROLS_MANAGE` step-up and audited platform write authority |
| `pages/api/governance/restore-snapshot.ts` | 015C+**015D** | Same; the restore can rewrite the global lock |
| `pages/api/governance/rebuild-projection.ts` | 015C | Unchanged in 015D |
| `pages/api/opportunities/refresh-slots.ts` | 015C | Unchanged in 015D |
| `pages/api/omnivyra/health.ts` | 015C | Unchanged in 015D |
| `backend/services/userManagementService.ts` | 015C+**015D** | 015D: `INVITABLE_ROLES` whitelist (fail closed, before any write) |
| `pages/api/users/invite.ts` | **015D** | Forwards `allowedRoles` on `UNSUPPORTED_ROLE` |
| `pages/api/company/users/reinvite.ts` | **015D** | Refuses SUPER_ADMIN; invitation carries the activatable role; unmappable role fails closed |
| `backend/services/rbacService.ts` | **015D** | `getUserRole`: invited SUPER_ADMIN no longer a fallback |
| `backend/services/userContextService.ts` | **015D** | `enforceCompanyAccess` fallback (b): same |
| `backend/services/contentArchitectService.ts` | **015D** | `resolveCompanyAccess`: same |
| `lib/platform/policyGate.ts` | **015D** | `isPlatformSuperAdmin` from an active SUPER_ADMIN membership only |
| `backend/tests/integration/governance_lockdown.test.ts` | 015C+**015D** | Functional suite with authorization mocked: also stubs `requireCapability` and `enforcePlatformWriteAuthority` (real chain covered in §7) |
| `backend/tests/integration/governance_snapshot.test.ts` | 015C+**015D** | Same |
| `backend/security/requireActivePlatformSuperAdmin.ts` (untracked) | 015C | Unchanged |
| `backend/tests/unit/closure015cGlobalRouteContainment.test.ts` (untracked) | 015C+**015D** | Step-up routes' T1 moved to 015D; T2 accepts the earlier `withRBAC` refusal; T2b tests the guard alone; fidelity now expects `getUserRole(invited SA) = null` |
| `backend/tests/unit/closure015cInviteRoleGovernance.test.ts` (untracked) | 015C+**015D** | T7/T8/T9 `test.failing` → plain tests (defects fixed) |
| `backend/tests/unit/closure015cAuditAndDeleteRegression.test.ts` (untracked) | 015C+**015D** | T12 ×2 `test.failing` → plain tests (invited principal refused); T17 race pin unchanged (still a defect) |
| `backend/tests/unit/closure015dGlobalRouteStepUp.test.ts` (new) | **015D** | Workstream A, 62 tests |
| `backend/tests/unit/closure015dIdentityLifecycle.test.ts` (new) | **015D** | Workstreams B, C, D, 56 tests |
| `backend/tests/unit/closure015dPolicyGateInvitedSuperAdmin.test.ts` (new) | **015D** | Workstream D policy gate, 5 tests |
| `docs/security/CLOSURE_015D_IDENTITY_AND_STEP_UP_RESULTS.md` (new) | **015D** | This report |

## 7. Tests and gates

### What the evidence is

All evidence is unit/harness level: real authorization code over in-memory membership, capability, step-up and trusted-device rows. No Postgres, PostgREST, RLS, column default, CHECK constraint or real passkey ceremony is exercised. The `routeAuthHarness` fake also ignores `.or()` filters, so each acceptance test seeds only the accepting user. **Runtime containment is not claimed.**

**`closure015dGlobalRouteStepUp` (62 tests, real `requireCapability` → `IdentityResolver` → `CapabilityService` → step-up chain):**
- **Unlock and restore:** an active SA with passkey on a trusted device gets 200, the effect runs once, and `elevated_route_accessed` is recorded. An active SA with no step-up, an expired step-up, a TOTP step-up or an untrusted device gets `STEP_UP_REQUIRED` and the effect never runs.
- **Rebuild, refresh and health:** an active SA with **no** step-up gets 200.
- **All five routes:**
  - each of these is refused with 403 and the effect never runs: invited, inactive and expired SUPER_ADMIN; no membership; active COMPANY_ADMIN; a VIEW_ONLY member with a **direct `PLATFORM_CONTROLS_MANAGE` grant plus valid step-up**;
  - unauthenticated gets 401;
  - a membership lookup error fails closed.
- **Cross-company:** an invited SA of A sending B's snapshot or campaign ID gets 403. The stepped-up active SA can restore B's snapshot.
- **Cron:** a valid secret runs the scheduler; a wrong secret with an invited SA gets 403; an empty bearer gets 401.
- **Health:** the response contains only the 5 report keys; POST gets 405 with no report built.

**`closure015dIdentityLifecycle` (56 tests):**
- **Invite:** vocabulary equality; all 10 supported roles; lower case accepted; 6 unsupported or ambiguous names (nothing written); SUPER_ADMIN still 403; an existing member is untouched by an unsupported role.
- **Invite route:** response shapes; legacy UI role → 200; invited SA refused.
- **Reinvite:**
  - each of 4 SUPER_ADMIN statuses × 2 actors is refused with nothing written;
  - all 10 held roles map to the right invitation role;
  - a brand-new person gets CONTENT_CREATOR;
  - an unmappable role gets 409;
  - cross-company reinvite gets 403.
- **Acceptance:** 4 held roles are activated without demotion; expired → 404 with nothing changed; revoked → 404; wrong email → 403.
- **Workstream D:** `getUserRole` invited SA → null; invited COMPANY_ADMIN unchanged; inactive and expired → null; active SA unchanged; lookup error fails closed; `enforceCompanyAccess`, `resolveCompanyAccess` and `withRBAC` all refuse an invited SA.

**`closure015dPolicyGateInvitedSuperAdmin` (5 tests):**
- An invited, inactive or deactivated SUPER_ADMIN is not a platform SA: the gate would deny the super-admin policy and the cross-company policy.
- An active SA is unchanged.

**015C suites after 015D: 66/66 pass**, including the five converted `test.failing` pins.

### Gate results

| Gate | Command | Result |
|---|---|---|
| Focused (16 suites: the 3 015D, 3 015C, governance lockdown/snapshot/projection, sec91A SuperAdminStatus/TenantGuardParity/ExecutionCaps, sec91W2G PolicyGatePrincipal, policyGateObservation, closure009, closure013) | `node node_modules/jest/bin/jest.js --runInBand --forceExit <16 suites>` | **16/16 suites, 1130/1130 tests pass** |
| Regression set (330 suites: the 015C gate set ∪ every suite importing a changed module ∪ the 015D suites) | same runner, `--json` | 311 passed, 19 failed (7226 passed, 60 failed, 2 skipped) on the first run. **Classified at test-name level against the 014C whole-repo run:** 57 failing tests are in the 014C baseline. The other 4: 3 governance functional tests (fixed by the stub, now **21/21**) and 1 timeout (§8). |
| Typecheck | `npm run typecheck` | **3/3 projects clean** |
| Certification | `node scripts/typecheck-certification.js` (re-run after the last test edit) | **PASS**: backend 0/0, backend-tests 259/259, no net-new error identities |
| Migration quality | `node scripts/check-migration-quality.js` | **OK**: 0 violations (no migration added) |
| Raw control bytes | `grep -laP '[\x00-\x08\x0b\x0c\x0e-\x1f]'` over every changed file | None |

### Mutation check (`scratchpad/c15d/mutants.js`, run against all 6 closure015c/d suites; every file restored and sha256-verified)

| Mutant | Result |
|---|---|
| M1 unlock: step-up suppressed | KILLED |
| M2 unlock: capability gate removed | KILLED |
| M3 restore: step-up suppressed | KILLED |
| M4 restore: capability gate removed | KILLED |
| M5 015C guard always allows | KILLED |
| M6 inviteUser: whitelist removed | KILLED |
| M7 inviteUser: alias-tolerant whitelist | KILLED |
| M8 inviteUser: SUPER_ADMIN in the whitelist | KILLED |
| M9 reinvite: SUPER_ADMIN refusal removed | KILLED |
| M10 reinvite: invitation role omitted | KILLED |
| M11 reinvite: raw held role on the invitation | KILLED |
| M12 reinvite: unmappable-role check dropped (only `!canonicalRole` kept) | **SURVIVED: equivalent.** Every non-null `normalizeRole` output other than SUPER_ADMIN (refused earlier) is already one of the 5 invitation roles, so the extra check is unreachable today. It guards a future `Role` addition. |
| M13 `getUserRole`: invited-SA fallback restored | KILLED |
| M14 `enforceCompanyAccess`: invited-SA fallback restored | KILLED |
| M15 `resolveCompanyAccess`: invited-SA fallback restored | KILLED |
| M16 `policyGate`: invited SA counted as platform SA | KILLED |

**Result: 15/16 killed. The one survivor is equivalent.**

## 8. Previously known failures: reproduced and classified

| Failure | Reproduction | Classification |
|---|---|---|
| `governance_performance_guard` › "second call skips when first is still running" | Run 3× in isolation: fails 3/3 (`runGovernanceAudit` called 2×, expected 1×) | **Pre-existing, deterministic** (not flaky). Present in the 014A and 014C whole-repo sets. The suite imports no file changed in 015C/015D. |
| `user_lifecycle_management` ×3 (Super admin can invite / Admin can invite / Audit logs created) | Re-run: the same 3 fail with `IDENTITY_CREATION_FAILED` | **Pre-existing, same cause** as in the 014C whole-repo log. The failure is downstream of the new whitelist (`CONTENT_MANAGER` is accepted). |
| `external_api_company_scope` › "recommendation engine falls back with no_external_signals" | 30 s timeout inside a `jest.isolateModules` recommendation-engine load during the 330-suite run; **4/4 pass in isolation** | **Load-induced timeout, not caused by 015D.** Not in the 014C set. Recorded as unverified-flaky, not as a pass. |
| 16 other suites (community_ai ×3, company_context_contract, external_api_service, recommendation_engine, aiRuntimeFinalValidation, campaignChatBlueprint, generateWorkspaceContentCharacterization, phase1aDataSources, routeAuth001Scanner, routeAuthOrdering, sec91FRouteAuthMethod, sec91W2FRouteAuthReExport, plus the two above) | In the 330-suite run | **Pre-existing.** Every failing test name is in the 014C whole-repo failure list, including the four route-auth scanner suites. |

## 9. Remaining owner decisions

| ID | Decision |
|---|---|
| A-1 | Do `rebuild-projection` and the session path of `refresh-slots` belong in the Closure-009 "operational recovery, no step-up" tier (as implemented), or should they carry a step-up capability? There is no existing capability for "run a cron job now": `cron.config.manage` is configuration. |
| A-2 | `restore-snapshot`: keep `PLATFORM_CONTROLS_MANAGE`, or a dedicated capability? Should a restore be allowed to rewrite the global lock at all? |
| B-1 | Step-up for `/api/users/invite`, or retire it in favour of governed `admin/invite-user`. That would also settle the legacy-vocabulary question: the governed path accepts only 5 roles. |
| B-2 | `PATCH /api/users/[userId]/role` (`updateUserRole`): apply the same SUPER_ADMIN refusal and whitelist (same P3 bypass; out of scope here). |
| D-1 | Should an invited COMPANY_ADMIN/ADMIN membership authorize before acceptance? |
| D-2 | Expiry at authorization time: bind invited-fallback authority to an unexpired, unrevoked invitation, and/or write `status='expired'`. |
| D-3 | Make `withRBAC`/`enforceRole`/`getUserRole`/`resolveCompanyAccess` reject non-operational companies, as `enforceCompanyAccess` does. |
| D-4 | `policyGate` company-scoped view: align invited-role handling with `getUserRole` before Phase 2 enforcement. |
| 015B 5–8 | Invited→active SA transition (now: none, by design of §4/§5); recommendation-audit scoping for active SAs; delete-route capability, step-up and the T17 race; content-plan threshold and server-derived IP. All unchanged. |

## 10. Blocked integration tests

| ID | Blocker |
|---|---|
| I-1 | Real-Postgres verification of `invitations.role` DEFAULT, `invitations_role_check`, the `activate_invitation_membership` RPC (the `auth/set-password` path was not exercised here) and the 015B T23/T24 tests. Needs a database; not allowed. |
| I-2 | Production prevalence of invited SUPER_ADMIN rows, and of memberships holding legacy or unknown role strings that a reinvite would now refuse with 409. Needs production access; not allowed. |
| I-3 | Real passkey / trusted-device step-up end to end on unlock and restore (WebAuthn ceremony, session minting). Needs a running app with isolation established; not done. |
| I-4 | Operator impact. Unlock and restore are API-only (no UI or script caller found), so operators must hold a passkey step-up session on a trusted device before calling them. |

## 11. Statement

No production operation, production query, remote operation (push, PR, merge, deploy), migration, schema change, database row read or write, credential or `.env` inspection, staging or commit occurred in Closure-015D. No worker or application was started.
