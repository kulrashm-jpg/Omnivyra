# Closure-015 — read-only audit: super-admin status enforcement (`/api/admin/check-super-admin`)

**Read-only. Local static inspection only.**
- No source or test file was changed. This report is the only new file.
- Nothing was staged or committed.
- No production access, database modification, migration, push, PR, deploy or remote operation took place.
- No application or worker was started.

## 1. Repository identity

| | |
|---|---|
| Worktree | `C:\tmp\closure-014a` |
| Branch | `integration/closure-014a` |
| HEAD at start and end | `03724e86969cd9d022fd191e142e914e04963b8a` (parent `77760314c6af4d41b72f4b13ccc8322d97474e3a`) |
| Working tree at start | clean: no staged, unstaged or untracked files |

## 2. Executive summary

**The helper itself: LOW.**
- `/api/admin/check-super-admin` answers `isSuperAdmin: true` for **any** `user_company_roles` row with role exactly `SUPER_ADMIN`.
- It does **not** check the membership `status`. A row that is `inactive`, `expired`, `invited` or `status IS NULL` all pass.
- It is a **UI convenience only**. No API route calls it or relies on its answer.
- Every action and data call behind the 12 consumers is re-authorized on the server. Most of those server checks require an `active` membership.
- **Consequence:** an inactive or expired former super admin can see some super-admin page shells and admin-only controls, and every privileged call is then refused (403).

**Related findings, found while tracing the server boundary: MEDIUM.**
- **F-3.** The `withRBAC([SUPER_ADMIN])` path (`rbacService.enforceRole` → `getUserRole`) accepts an **`invited`** `SUPER_ADMIN`, `COMPANY_ADMIN` or `ADMIN` row for the requested company. This is a documented legacy fallback, shared with `enforceCompanyAccess`.
- **F-4.** Two of those routes (`/api/recommendations/audit/[id]` and `/audit/campaign/[id]`) **do not bind their query to the authorized company**. In code, a user whose only `SUPER_ADMIN` row is an *invited* one in company X can read recommendation audit rows for **any** id, including other tenants'.

Neither was confirmed at runtime: that requires seeding synthetic role rows, and this brief forbids database modification. **BLOCKED.**

**The reported count of ten is wrong.** There are **12 consumer call sites in 12 files** (§4). The "ten" came from a truncated search (`| head -10`) in Closure-014C.

## 3. Helper behaviour (`pages/api/admin/check-super-admin.ts`)

| Aspect | Evidence |
|---|---|
| Export | default `createApiRoute(handler, { route: '/api/admin/check-super-admin' })` (:54); GET only, otherwise 405 (:7-9) |
| Authentication | `getSupabaseUserFromRequest(req)` (:12) delegates to `backend/services/authResolver.ts resolveAuthenticatedUser`. The token comes from a Bearer header first, then the Supabase auth cookie (`authResolver.ts:309-310`). The legacy `super_admin_session` bridge cookie is **not** read here. |
| Account-level status | **Enforced** by the resolver, fail-closed, on every request: `is_deleted`/`deleted` → `ACCOUNT_DELETED` (authResolver.ts:514-515); `suspended` → `ACCOUNT_SUSPENDED` (:517-518); `session_revoked_after` later than the token iat, or unparseable → `SESSION_REVOKED` (:524-542). The facade refuses an `invited` *account* (`supabaseAuthService.ts:41-42`). A NULL account status is treated as `active` (:546-549). |
| Role check | `.from('user_company_roles').select('role').eq('user_id', userId).eq('role', 'SUPER_ADMIN').limit(1)` (:21-26), plus an optional caller-supplied `company_id` (:17-19, :28). The match is case-exact. |
| **Membership status** | **Not loaded and not checked.** The schema allows `invited` (the column **default**), `active`, `inactive`, `expired`, and NULL (`baseline.sql` `user_company_roles`, CHECK constraint). Every one of them yields `isSuperAdmin: true`. |
| Disclosure | Only the caller's own answer and their own `userId`. The route-auth allowlist classifies it "identity-scoped" (`scripts/route-auth-allowlist.json:46`), which is accurate. It is also on the grandfathered tenant-authz debt list (`scripts/tenant-authz-baseline.json:5`). |
| Errors | auth error or missing user → 401 (:13-15); DB error → 500 with `details: error.message` (:30-35); exception → 500 with the message (:44-49). It never answers `true` on an error. Messages are echoed back. |
| Fail-closed? | **Yes for errors. No for status semantics:** a non-active membership answers `true`. |
| Caching | None in the helper. The role row is read live on every request. Token validation may be cached, but account lifecycle is still checked against the DB row on every request (`authValidationCache.ts` header). |

**The canonical server predicate, for contrast:** `rbacService.hasActiveSuperAdminRow` (`rbacService.ts:266-276`) filters `role = SUPER_ADMIN` **and `status = 'active'`**, and returns false on a lookup error. `isSuperAdmin` (:278) and `isPlatformSuperAdmin` (:280) both delegate to it.

The capability layer also requires `active`:
- `CapabilityService.ts:77` — `if (row.status !== 'active') continue`;
- `platformCapabilities.ts:223`;
- `AuthorizationService.ts:69, 164`.

## 4. Consumer inventory

There are 12 call sites, from `git grep -n "check-super-admin"` excluding the route itself, the docs and two allowlist JSON files. `pages/super-admin/consumption.tsx` also has a comment line (63) mentioning it.

| # | Consumer (file:line) | What it uses the answer for |
|---|---|---|
| 1 | `components/ContentCreationPanel.tsx:180` (`deleteContentItem`) | pre-check before the delete-confirmation dialog |
| 2 | `components/planner/hooks/useDailyPlan.ts:640` (`deleteActivity`) | pre-check before the delete-confirmation dialog |
| 3 | `hooks/useDailyPlanning.tsx:1045` (`deleteActivity`) | pre-check before the delete-confirmation dialog |
| 4 | `components/campaign-ai/useCampaignAIExternalData.ts:230` | sets `isAdmin` in the CampaignAIChat state, which is **never read** (dead) |
| 5 | `hooks/useCampaignDetailsCore.tsx:438` (`?companyId=`) | `isAdmin` → "Policy" navigation button and the "Create Snapshot" button |
| 6 | `lib/campaign-details/useGovernancePanel.ts:135` (`?companyId=`) | **dead**: the hook is not imported anywhere |
| 7 | `pages/recommendations/audit.tsx:40` | shows or greys a navigation link |
| 8 | `pages/recommendations/policy.tsx:96` | enables or disables controls and auto-loads |
| 9 | `hooks/usePlannerControl.tsx:138` | page gate for `/super-admin/planner-control` |
| 10 | `hooks/useSysHealth.tsx:248` | page gate for `/super-admin/system-health` |
| 11 | `pages/super-admin/bolt-failures.tsx:72` (`useSuperAdminGate`) | page gate |
| 12 | `pages/super-admin/consumption.tsx:64` | page tier gate (`super_admin` vs `company_admin`/`user` tabs) |

**Page-gate fallbacks.** Consumers 9–12 fall back to `CompanyContext.userRole === 'SUPER_ADMIN'` when the helper says false. `CompanyContext.normalizeCompanyRole` downgrades `SUPER_ADMIN` to `COMPANY_ADMIN` under a normal session, so in practice the helper is the only thing that opens these pages.

Two comments misdescribe the helper as checking the legacy `super_admin_session` cookie, which it does not read:
- `useSysHealth.tsx:246`;
- `consumption.tsx:63`.

## 5. Consumer authorization matrix

"Status enforcement" refers to the **server** route that performs the actual work.

| # | Consumer | Operation | Server authorization path | Membership status enforced? | Step-up | Failure behaviour of the UI check | Exposure if an inactive/expired SUPER_ADMIN passes the UI check | Tests |
|---|---|---|---|---|---|---|---|---|
| 1 | ContentCreationPanel delete | write (destructive) | `POST /api/admin/delete-content`: `getSupabaseUserFromRequest` then `rbacService.isSuperAdmin` (`delete-content.ts:12-20`) | **Yes**: active, via `hasActiveSuperAdminRow` | **None** (no `requireCapability`) | non-ok → `result.isSuperAdmin` undefined → deny message; exception → error message (deny) | sees the confirm dialog; server 403 `Forbidden`, nothing deleted | none for the route or the UI |
| 2 | useDailyPlan delete | write (destructive) | `POST /api/admin/delete-activity` (`delete-activity.ts:12-20`), same as #1 | **Yes** (active) | **None** | deny on error | dialog shown; server 403 | none |
| 3 | useDailyPlanning delete | write (destructive) | same as #2 | **Yes** (active) | **None** | deny on error | same | none |
| 4 | useCampaignAIExternalData | read (flag only) | — (flag never read) | n/a | n/a | non-ok → flag unchanged (false) | none | none |
| 5 | useCampaignDetailsCore | mixed | Create Snapshot → `POST /api/governance/snapshot`, `withRBAC([SUPER_ADMIN])` (`snapshot.ts:49`) → `enforceRole` → `getUserRole` | **Partially**: active, **or an `invited` SUPER_ADMIN row in the body companyId** (`rbacService.ts:185, 197-211`); inactive, expired and NULL refused | None | non-ok → false | button shown; server 403 `FORBIDDEN_ROLE` for inactive/expired | none for these routes |
| 6 | useGovernancePanel | — (dead) | — | n/a | n/a | n/a | none (not mounted). The related `pages/campaign-details/GovernanceTab.tsx` is an orphan page route that would forward the same flag. | none |
| 7 | recommendations/audit | read | page fetches `GET /api/recommendations/audit/[id]` and `/audit/campaign/[id]`, `withRBAC([SUPER_ADMIN])` (`:25` in both), **not gated by the flag** | **Partially** (as #5) | None | non-ok → false | the link is shown. The page sends **no companyId**, so the server answers **400 `companyId required`** for everyone (`rbacService.ts:304-306`), see F-5 | none |
| 8 | recommendations/policy | mixed | Save → `POST /api/recommendation-policy`: `isSuperAdmin` (`recommendation-policy.ts:70-73`). Simulate → `POST /api/recommendations/simulate`, `withRBAC([SUPER_ADMIN])` (`simulate.ts:35`). Audit auto-load as #7. | Save: **yes** (active). Simulate and audit: **partially** (invited fallback). | None | non-ok → false | controls **enabled but not hidden otherwise** (`disabled` only); server 403 for inactive/expired | none |
| 9 | planner-control page | mixed | `GET /inspect`: `requireCapability(SUPER_ADMIN_DASHBOARD_VIEW)`. `/features`, `/force-mode`, `/rollout`: `requireCapability` + `requirePlatformWriteAuthority` (the Closure-013/014 central guard plus step-up) | **Yes** (capability layer active-only; platform write authority = active exact SUPER_ADMIN) | Yes for writes (Closure-014) | non-ok/exception → falls back to the context role → `/login` | page shell rendered; every call 403 | Closure-013/014 suites cover these routes' authority |
| 10 | system-health page | mixed | `/api/super-admin/system-health`, `/system-intelligence`: `requireCapability(DASHBOARD_VIEW)`. `/api/admin/consumption/activity-breakdown`: `requireCapability(CONSUMPTION_VIEW_AGGREGATE)`. `/api/admin/cache-management`: `requireCapability` + `requirePlatformWriteAuthority`. | **Yes** | Yes for writes | as #9 | shell rendered; calls 403 | as #9 |
| 11 | bolt-failures page | read | all `/api/super-admin/bolt-failures/*`: `requireCapability(SUPER_ADMIN_DASHBOARD_VIEW)` | **Yes** | n/a | as #9 | shell; 403 | — |
| 12 | consumption page | mixed | metrics: `requireCapability(DASHBOARD_VIEW)`. cron/queue config: `requireCapability(CRON_CONFIG_MANAGE)` + step-up. `consumption/llm`, `consumption/apis`, `credits`, `plans/list`: `isPlatformSuperAdmin`. `rate-limit-config`: `requireSuperAdminUser` (active). `/api/super-admin/companies`: `requireCapability`. `/api/external-apis` platform scope: `requirePlatformAdmin` (active). | **Yes** | step-up on capability-guarded writes; **none** on `rate-limit-config` (Closure-014C decision 2) | non-ok → fallback → tier by context role | super-admin tabs render; data calls 403 | partial (Closure-014 suites) |

**Legacy bridge cookie.** Several routes still accept the legacy `super_admin_session` cookie (`getLegacySuperAdminSession`): `external-apis` (`indexShared.ts:39, 83`), the consumption routes and the metrics routes. That principal has no membership row, so no status could ever apply. The path is **inert**: `evaluateBridgeCookieLifecycle` refuses every cookie at or after `LEGACY_BRIDGE_HARD_EXPIRY_AT = 2026-08-05T00:00Z` (`legacyCookieSuperAdminBridge.ts:39, 95-96`). This is verified in code and was demonstrated at runtime in Closure-012 A10. It depends on the server clock.

## 6. Security-boundary answers

| Question | Answer | Basis |
|---|---|---|
| Can a non-active account reach a protected page? | **Account suspended, deleted, revoked or invited:** no. The helper answers 401, and the page gates then redirect to `/login`. **Active account with a non-active SUPER_ADMIN membership:** yes, the page **shell** renders (consumers 9–12) and admin controls appear (1–3, 5, 8). | Verified code |
| Can it invoke the APIs directly? | It can call them; they answer 403. **Exception:** an `invited` SUPER_ADMIN membership in company X passes `withRBAC([SUPER_ADMIN])` for X (snapshot, simulate, recommendation audit). | Verified code; runtime BLOCKED |
| Do the server routes enforce status independently? | **Yes, every one traced.** Through the capability layer, `hasActiveSuperAdminRow`, `requireSuperAdminUser` or `requirePlatformWriteAuthority` (all active-only), or `withRBAC` (active, or invited admin roles only). | Verified code |
| Can stale sessions bypass status? | **No.** Membership rows are read live on every request (the principal memo is per-request, `IdentityResolver.ts:266-269`; `rbacCache` caches only the role→permission config, `rbacService.ts:68-137`). Account lifecycle and session revocation are checked on the DB row on every request. | Verified code. Runtime not tested. |
| Would changing the shared helper affect others? | The helper is called only by these 12 UI consumers, never by a server route, so tightening it changes **UI only**. Platform super admins (active) are unaffected. A delegated read holder (e.g. VIEW_ONLY with a `super_admin.dashboard.view` grant) gets `false` today and would still get `false`. Tenant administrators get `false` today. | Verified code |
| Does any consumer rely on the helper without a server check? | **Not found.** Every privileged action and data read behind the 12 consumers is re-authorized on the server. | Verified code, one route at a time (§5) |

## 7. Findings

| ID | Finding | Classification | Severity |
|---|---|---|---|
| F-1 | `check-super-admin` ignores `user_company_roles.status`; invited, inactive, expired and NULL SUPER_ADMIN rows answer `true` | **CONFIRMED** (code) | Low: UI-only |
| F-2 | A consumer relies on the helper as its only authorization | **NOT FOUND** | — |
| F-3 | `withRBAC` / `enforceRole` → `getUserRole` accepts **invited** SUPER_ADMIN/COMPANY_ADMIN/ADMIN rows, scoped to the requested company (`rbacService.ts:197-211`). The same documented legacy fallback exists in `enforceCompanyAccess` and in `externalApis/indexShared.ts:59-70` (`getCompanyRoleIncludingInvited`, `rbacPrimitives.ts:42-56`, `status in ('active','invited')`). | **CONFIRMED** (code; a documented policy — see the SEC-91A note at `campaignAccessService.ts:168-179`) | Medium: an admin invitation that was never accepted already confers admin authority, including `MANAGE_EXTERNAL_APIS` for external-API writes |
| F-4 | `/api/recommendations/audit/[id]` and `/audit/campaign/[id]` do not bind their query to `req.rbac.companyId`; the queries filter only on `recommendation_id`/`campaign_id` (`recommendationAuditService.ts` `getAuditByRecommendationId`/`getAuditByCampaignId`). Combined with F-3, a user whose only SUPER_ADMIN row is invited in company X can read audit rows for any id. | **CONFIRMED** (code); exploitability **INCONCLUSIVE**: depends on invited SUPER_ADMIN rows existing (CompanyContext's own comment says such rows come from onboarding mis-creation) | Medium |
| F-5 | The recommendations audit and policy pages never send `companyId` to the audit routes, so those loads always answer 400 | **CONFIRMED** (code) | Low: functional |
| F-6 | `delete-content` / `delete-activity` (destructive) require an active SUPER_ADMIN but no capability guard, no passkey step-up and no central platform-write guard | **CONFIRMED** (code) | Medium: outside the Closure-014 73-route matrix |
| F-7 | Dead or orphan code: the consumer #4 flag is unused; `useGovernancePanel` is unimported; `pages/campaign-details/GovernanceTab.tsx` is an orphan page route | **CONFIRMED** (code) | Info |
| F-8 | Misleading comments claim the helper checks the legacy cookie (`useSysHealth.tsx:246`, `consumption.tsx:63`) | **CONFIRMED** | Info |
| F-9 | Legacy bridge cookie paths could bypass status | **NOT FOUND** (inert since 2026-08-05) | — |
| F-10 | Runtime confirmation of F-1, F-3, F-4 with synthetic inactive/invited rows | **BLOCKED**: requires inserting role rows into the cert DB, which this brief forbids | — |
| F-11 | Production prevalence: how many non-active or invited SUPER_ADMIN rows exist | **BLOCKED**: production-only | — |

## 8. Remediation options (not selected and not implemented)

| Option | Change | Pros | Cons / affected parties |
|---|---|---|---|
| R-1 | Make `check-super-admin` delegate to `isPlatformSuperAdmin` (active only), and keep the `companyId` filter for the two company-scoped callers | Smallest; aligns the UI with the server; UI-only blast radius | Former or invited super admins lose page shells they could not use anyway. A `?companyId` caller would need an explicit decision: active-in-X, or platform. |
| R-2 | Retire the helper and gate pages on their own data reads (the pattern used in Closure-014C Finding E) | One source of truth; no drift | Touches 12 consumers. Read-delegated users (dashboard.view) would see some pages, by capability design. |
| R-3 | End the invited-admin legacy fallback in `getUserRole`, `enforceCompanyAccess` and `externalApis` | Closes F-3 everywhere | **Policy change.** Invited admins lose access until they accept; it may break onboarding flows that rely on it. Needs an owner decision and a production prevalence query. |
| R-4 | Bind the recommendation audit queries to `req.rbac.companyId` (join through the campaign's company) | Closes F-4 regardless of F-3 | Needs the audit-row-to-company relationship confirmed; a platform-SA view of all tenants would need an explicit branch. |
| R-5 | Send `companyId` from the audit and policy pages | Fixes F-5 | The pages may not know a company for a bare recommendation id. |
| R-6 | Move `delete-content` / `delete-activity` behind `requireCapability` with a platform-write capability and step-up | Brings F-6 into the Closure-014 matrix | **Policy decision** (which capability), plus a UI step-up adoption like Closure-014 C |

## 9. Proposed regression-test matrix

| Principal | Helper (`check-super-admin`) | `withRBAC([SUPER_ADMIN])` routes (snapshot/simulate/audit) | `isSuperAdmin` routes (delete-*, recommendation-policy POST) | Capability routes (planner/system-health/bolt/consumption) | Page gates (9–12) |
|---|---|---|---|---|---|
| active exact SUPER_ADMIN | true | allow | allow | allow (writes: step-up) | render |
| SUPER_ADMIN row `inactive` / `expired` / NULL | **expected after fix: false** (today true) | 403 | 403 | 403 | no render |
| SUPER_ADMIN row `invited` (in company X) | owner decision | owner decision (today: allow for X) | 403 | 403 | owner decision |
| `super_admin` (lower-case) row | false | 403 | 403 | 403 | no render |
| account `suspended` / `deleted` / session revoked | 401 | 401 | 401 | 401 | → `/login` |
| account `invited` | 401 | 401 | 401 | 401 | → `/login` |
| missing user row | 401 | 401 | 401 | 401 | → `/login` |
| tenant COMPANY_ADMIN (active) | false | 403 | 403 | 403 | no render |
| ordinary tenant user | false | 403 | 403 | 403 | no render |
| VIEW_ONLY + direct `dashboard.view` grant | false | 403 | 403 | reads allow, writes 403 | owner decision |
| legacy bridge cookie only | 401 | n/a | 401 | refused (hard-expired) | → `/login` |
| role lookup DB error | 500, never true | 500/403 (fail closed) | 403 (fail closed) | 503/403 | deny or fallback, never render |
| direct API call bypassing the UI | as per row | as per row | as per row | as per row | n/a |
| cross-tenant: F-4 audit id from company Y, caller authorized for X | — | **expected: 404/403** (today: rows returned) | — | — | — |

## 10. Owner decisions required before implementation

1. **Helper semantics:** should `check-super-admin` mean an "active platform super admin" (R-1)? What should `?companyId=` mean?
2. **Invited admin fallback (F-3):** keep, restrict (e.g. never for SUPER_ADMIN), or remove platform-wide (R-3)? Request a read-only production count of non-active and invited `SUPER_ADMIN`/admin rows first.
3. **Recommendation audit scoping (F-4):** company-bind the audit routes (R-4), and decide what a platform super admin may see.
4. **Destructive deletes (F-6):** which capability and whether step-up is required (R-6).
5. Whether dead or orphan code (F-7) may be removed in the same change.

## 11. Commands and checks performed

| Check | Command (summary) | Outcome |
|---|---|---|
| Repository state | `git rev-parse --show-toplevel/--abbrev-ref HEAD/HEAD/HEAD~1`, `git status --short`, `git diff --cached --name-only`, `git ls-files --others --exclude-standard` | as §1; clean |
| Helper | `cat -n pages/api/admin/check-super-admin.ts` | §3 |
| Consumers | `git grep -n "check-super-admin"` (no truncation) | 12 call sites, 12 files |
| Auth path | read `supabaseAuthService.ts`, `authResolver.ts` (:300-345, :482-560) | §3 |
| Membership schema | `baseline.sql` `user_company_roles`; cert DB `pg_get_constraintdef` (read-only SELECT on catalog) | statuses invited, active, inactive, expired; default `invited` |
| Server predicates | read `rbacService.ts` (:176-225, :266-341), `rbacPrimitives.ts:42-56`, `withRBAC.ts` | §5, §7 |
| Page route guards | scratchpad `c15/classify_routes.js` over 28 page→route pairs (read-only file scan) | every route guarded (§5); one dynamic route resolved by hand |
| Downstream of company-scoped flags | read-only Explore agent; key claims spot-verified (getUserRole invited fallback; audit handlers' unbound queries; snapshot/simulate `withRBAC`; dead hooks) | §5 #4–8, F-3–F-5, F-7 |
| Bridge lifecycle | read `legacyCookieSuperAdminBridge.ts:39, 95-96` | inert since 2026-08-05 |
| Caching | grep of the IdentityResolver, CapabilityService, rbacService caches | per-request principal memo; RBAC config cache only |
| Tests | `git grep` over `backend/tests` | no test references `check-super-admin`, `delete-content`/`delete-activity`, or the invited fallback in external-API tests; Closure-014 suites cover capability-route authority and role casing |
| Runtime confirmation | — | BLOCKED (would require DB modification) |

No test was run: the brief required static inspection first, and no test was needed to establish the code facts.

## 12. Statement

No source or test file was modified. No commit or staging, no branch change, no database modification, no migration, no production access, no deployment, push, PR or remote operation took place, and no application or worker was started. Reports and evidence manifests from Closure-014A through 014D were not touched.
