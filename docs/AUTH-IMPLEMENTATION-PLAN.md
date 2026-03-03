# Authentication and Access Control — Implementation Plan

**Goal:** Introduce clean role separation (Super Admin, Campaign Architect, Company Admin, Content Creators) **before** touching campaign logic or UI.

**Constraints:**
- No architecture redesign; no removal of legacy systems yet.
- Preserve Supabase auth and `super_admin_session` temporarily.
- Minimal refactor; no rewrite of existing auth.
- Auth + permissions only; no UI changes; no campaign logic changes.
- Minimize risk; small PR-sized steps.

**Reference:** [AUTH-AND-ACCESS-ANALYSIS.md](./AUTH-AND-ACCESS-ANALYSIS.md)

---

## 1. Minimal Refactor Path (Analysis Summary)

### 1.1 What We Keep

| Component | Action |
|-----------|--------|
| **Supabase Auth** | Unchanged. Login (OTP), session (cookies/Bearer), `getSupabaseUserFromRequest` stay as-is. |
| **super_admin_session cookie** | Preserved. Middleware and `enforceRole` continue to accept it; no deprecation in this plan. |
| **user_company_roles** | Remain source of truth for role per company. No table rename or schema rewrite. |
| **middleware.ts** | No behavior change. Still: login public; cookie → super-admin routes; else token required. |
| **resolveUserContext / enforceCompanyAccess** | Kept. Optional later consolidation into a single guard; not required for role refactor. |

### 1.2 What We Change (Incremental Only)

1. **Role enum + PERMISSIONS** — Add `CAMPAIGN_ARCHITECT`; adjust permission matrix so:
   - Super Admin: governance only (no CREATE_USER/ASSIGN_ROLE for company users).
   - Campaign Architect: strategy + campaign intelligence + system-level setup; no user creation.
   - Company Admin: CREATE_USER, ASSIGN_ROLE, execution workflows only.
   - Content Creators: task-level permissions only.

2. **One bug fix** — `campaigns/list`: replace `hasPermission(role, 'view')` with correct key (e.g. `VIEW_CAMPAIGNS`).

3. **One centralized guard** — New `requirePermission(req, res, permission, options?)` (and optional `withPermission(handler, permission)`) that:
   - Reuses existing `enforceRole` + `getUserCompanyRole` + `hasPermission` under the hood.
   - Treats legacy super_admin_session as SUPER_ADMIN.
   - Does **not** replace all routes at once; migrate gradually.

4. **Governance and strategy routes** — Remove COMPANY_ADMIN from governance (verify-snapshot, replay-event); use permission-based checks where we introduce strategy-only permissions so Campaign Architect can be added without breaking existing users.

### 1.3 What We Do Not Do (This Plan)

- No new login flows or session stores.
- No removal of cookie-based Super Admin.
- No frontend permission API or UI changes.
- No campaign or content logic changes.
- No DB migration that drops or renames tables/columns.

---

## 2. Role Refactor Checklist

### 2.1 Exact Files / Services to Change First (Order)

| Order | File or service | Change |
|-------|------------------|--------|
| 1 | `backend/services/rbacService.ts` | Add `CAMPAIGN_ARCHITECT` to `Role`; add to `ALL_ROLES`; add `normalizePermissionRole` mapping; update `PERMISSIONS` (see §3). |
| 2 | `pages/api/campaigns/list.ts` | Fix `hasPermission(role, 'view')` → `hasPermission(role, 'VIEW_CAMPAIGNS')`. |
| 3 | `backend/middleware/withRBAC.ts` | No change yet (keep as-is). |
| 4 | New: `backend/guards/requirePermission.ts` | Add `requirePermission(req, res, permission, options?)` and `withPermission(handler, permission)` that call existing enforceRole/hasPermission. |
| 5 | Governance APIs (see §3) | Remove COMPANY_ADMIN from verify-snapshot, replay-event (use SUPER_ADMIN only); optionally switch to withPermission when guard is ready. |
| 6 | PERMISSIONS in rbacService | Remove SUPER_ADMIN from CREATE_USER and ASSIGN_ROLE (Company Admin only for company users). |
| 7 | Company user APIs | Ensure they use hasPermission('CREATE_USER') / hasPermission('ASSIGN_ROLE') so behavior stays correct after PERMISSIONS change. |
| 8 | (Optional) DB / docs | If any app code or docs list allowed roles, add CAMPAIGN_ARCHITECT. `user_company_roles.role` is TEXT with no CHECK, so no DB migration required for new role value. |

### 2.2 Role Enum Updates (`backend/services/rbacService.ts`)

- Add to `Role` object:
  - `CAMPAIGN_ARCHITECT: 'CAMPAIGN_ARCHITECT'`
- Add to `ALL_ROLES` array:
  - `Role.CAMPAIGN_ARCHITECT`
- In `normalizePermissionRole(role)`:
  - No mapping for CAMPAIGN_ARCHITECT (identity).
- In `normalizeRole(value)` (internal):
  - Add case for `'CAMPAIGN_ARCHITECT'` → `Role.CAMPAIGN_ARCHITECT`.

### 2.3 RBAC Updates (Same File)

- **PERMISSIONS** — See §3 (Permission Migration Plan). Summary:
  - CREATE_USER, ASSIGN_ROLE: drop SUPER_ADMIN (keep COMPANY_ADMIN only for company user management).
  - VIEW_TEAM: add CAMPAIGN_ARCHITECT only if we want architects to see team (recommendation: no; keep COMPANY_ADMIN, SUPER_ADMIN).
  - VIEW_CAMPAIGNS, CREATE_CAMPAIGN: add CAMPAIGN_ARCHITECT; keep Content roles and Company Admin for execution.
  - New permission (optional): e.g. CONFIGURE_CAMPAIGN_STRATEGY or use CREATE_CAMPAIGN for strategy; assign to SUPER_ADMIN, CAMPAIGN_ARCHITECT.
  - MANAGE_EXTERNAL_APIS: keep COMPANY_ADMIN for company-scoped; add CAMPAIGN_ARCHITECT for system-level if desired (or leave as COMPANY_ADMIN + SUPER_ADMIN for now).
  - Governance: no PERMISSION key today; routes use withRBAC(..., [Role.SUPER_ADMIN]). Remove COMPANY_ADMIN from verify-snapshot and replay-event.

- **getUserRole / getUserCompanyRole** — No change; they already read from `user_company_roles` and normalize role. Once CAMPAIGN_ARCHITECT is in Role and normalizeRole, it will be returned as-is.

- **enforceRole** — No signature change. Legacy cookie still returns SUPER_ADMIN. Existing withRBAC(handler, allowedRoles) continues to work; new routes can use withPermission(handler, permission) where we add it.

---

## 3. Permission Migration Plan

### 3.1 Permissions That Move to or Include Campaign Architect

| Permission | Current roles | After migration | Notes |
|------------|----------------|------------------|--------|
| VIEW_CAMPAIGNS | COMPANY_ADMIN, CONTENT_*, SUPER_ADMIN | + CAMPAIGN_ARCHITECT | Strategy needs visibility. |
| CREATE_CAMPAIGN | COMPANY_ADMIN, CONTENT_*, SUPER_ADMIN | + CAMPAIGN_ARCHITECT | Strategy + setup; execution stays with Company Admin + Content. |
| VIEW_ANALYTICS | COMPANY_ADMIN, CONTENT_*, VIEW_ONLY, SUPER_ADMIN | + CAMPAIGN_ARCHITECT | Campaign intelligence. |
| (Optional) CONFIGURE_CAMPAIGN_STRATEGY | — | SUPER_ADMIN, CAMPAIGN_ARCHITECT | New key for strategy-only APIs if we split from CREATE_CAMPAIGN later. For minimal change, use CREATE_CAMPAIGN. |

Recommendation: add CAMPAIGN_ARCHITECT to VIEW_CAMPAIGNS, CREATE_CAMPAIGN, VIEW_ANALYTICS. Do **not** add to CREATE_USER, ASSIGN_ROLE, or VIEW_TEAM.

### 3.2 Permissions That Stay with Company Admin Only (Company User Management)

| Permission | Current roles | After migration |
|------------|----------------|------------------|
| CREATE_USER | SUPER_ADMIN, COMPANY_ADMIN | COMPANY_ADMIN only |
| ASSIGN_ROLE | SUPER_ADMIN, COMPANY_ADMIN | COMPANY_ADMIN only |
| VIEW_TEAM | SUPER_ADMIN, COMPANY_ADMIN | No change (Super Admin keeps for governance; Company Admin for team management). |

Super Admin: **should NOT** manage company users directly (target). So remove SUPER_ADMIN from CREATE_USER and ASSIGN_ROLE. Super Admin can still use super-admin APIs (e.g. `/api/super-admin/users`) for system-level operations; those are guarded by cookie, not PERMISSIONS.

### 3.3 Permissions That Remain Super Admin Only (Governance)

No new PERMISSION keys required. Routes that are today withRBAC(..., [Role.SUPER_ADMIN]) stay that way:

- recommendations/simulate, recommendations/audit/*, governance/* (run-audit, snapshot, verify-ledger, restore-snapshot, unlock), external-apis/test, external-apis/[id]/validate, omnivyra/health, opportunities/refresh-slots.

**Narrowing:** Remove COMPANY_ADMIN from:

- `governance/verify-snapshot.ts` — change to `[Role.SUPER_ADMIN]` only.
- `governance/replay-event.ts` — change to `[Role.SUPER_ADMIN]` only.

### 3.4 Summary Matrix (Target State)

| Permission | Super Admin | Campaign Architect | Company Admin | Content Creator / Reviewer / Publisher | View only |
|------------|-------------|---------------------|---------------|----------------------------------------|-----------|
| VIEW_DASHBOARD | ✓ | ✓ (add) | ✓ | ✓ | ✓ |
| VIEW_TEAM | ✓ | — | ✓ | — | — |
| VIEW_ANALYTICS | ✓ | ✓ (add) | ✓ | ✓ | ✓ |
| CREATE_USER | — (remove) | — | ✓ | — | — |
| ASSIGN_ROLE | — (remove) | — | ✓ | — | — |
| APPROVE_CONTENT | ✓ | — | ✓ | CONTENT_REVIEWER | — |
| PUBLISH_CONTENT | ✓ | — | ✓ | CONTENT_PUBLISHER | — |
| CREATE_CAMPAIGN | ✓ | ✓ (add) | ✓ | ✓ | — |
| VIEW_CAMPAIGNS | ✓ | ✓ (add) | ✓ | ✓ | — |
| MANAGE_EXTERNAL_APIS | ✓ | optional | ✓ | — | — |
| VIEW_CONTENT | * | * | * | * | * |

---

## 4. Guard Standardization Plan

### 4.1 Current State

- **withRBAC(handler, allowedRoles)** — Requires companyId; calls enforceRole; sets req.rbac.
- **enforceCompanyAccess(req, res, companyId)** — Only company scope; no role.
- **Inline** — isSuperAdmin(userId), hasPermission(role, action), custom ensureCompanyAdminAccess.

### 4.2 Target: One Centralized Permission Guard

Introduce a single module used for permission checks (without removing existing patterns yet):

**New file: `backend/guards/requirePermission.ts`**

- **requirePermission(req, res, options): Promise<{ userId: string; role: Role } | null>**
  - Options: `{ permission: string; companyId?: string | null; requireCompany?: boolean }`.
  - Logic:
    1. If legacy super_admin_session cookie and permission is one Super Admin can do (e.g. not CREATE_USER/ASSIGN_ROLE), resolve as SUPER_ADMIN and return.
    2. Else resolve user via resolveUserContext(req).
    3. If requireCompany and companyId missing → 400.
    4. Get role via getUserCompanyRole(req, companyId) (or isSuperAdmin for bypass).
    5. If hasPermission(role, permission) → return { userId, role }; else 403 and return null.
  - Ensures one place for “legacy cookie → SUPER_ADMIN” and permission lookup.

- **withPermission(handler, permission, options?): NextApiHandler**
  - Wraps handler; calls requirePermission; attaches result to req (e.g. req.authContext); returns 400/403 on failure.

### 4.3 Unification Strategy (No Big-Bang Rewrite)

1. **Phase A:** Add `requirePermission` and `withPermission`; implement by delegating to existing `enforceRole`, `getUserCompanyRole`, `hasPermission`, and legacy cookie check. No route changes.
2. **Phase B:** Migrate 2–3 routes to `withPermission` (e.g. governance/verify-snapshot, governance/replay-event, one analytics route). Keep withRBAC elsewhere.
3. **Phase C:** Over time, migrate more routes from withRBAC(handler, [Role.X, Role.Y]) to withPermission(handler, 'PERMISSION_NAME') where a single permission expresses the requirement. Leave enforceCompanyAccess in place where only scope is needed.

**Backward compatibility:** withRBAC and enforceRole remain; they are used by requirePermission under the hood (or we implement requirePermission so it duplicates minimal logic and shares hasPermission). Existing routes keep working.

### 4.4 Files to Touch for Guard

| File | Action |
|------|--------|
| `backend/guards/requirePermission.ts` | **Create.** Implement requirePermission and withPermission. |
| `backend/services/rbacService.ts` | Export hasPermission, getUserCompanyRole, enforceRole (already exported). Optional: add a small helper used by requirePermission for “resolve identity + role” to avoid duplication. |
| Routes that will later use withPermission | In a later PR: change from withRBAC to withPermission where permission is the natural abstraction. |

---

## 5. Safety Plan

### 5.1 Migration Steps Without Breaking Existing Users

1. **Add role and permissions first, assign no one.**  
   Add CAMPAIGN_ARCHITECT to Role and ALL_ROLES and PERMISSIONS (view/create campaign, view analytics). No user has this role yet, so no behavior change for existing users.

2. **Fix campaigns/list bug only.**  
   Change 'view' → 'VIEW_CAMPAIGNS'. This **fixes** current broken behavior (permission was never granted).

3. **Remove SUPER_ADMIN from CREATE_USER / ASSIGN_ROLE in PERMISSIONS.**  
   Super Admin today can create company users via company/users API (which checks hasPermission(role, 'CREATE_USER')). After removal, Super Admin will get 403 on that API. **Intended** per target (“should NOT manage company users directly”). Ensure no automation or script relies on Super Admin creating company users. If needed, add a feature flag or env to temporarily keep SUPER_ADMIN in CREATE_USER until confirmed.

4. **Remove COMPANY_ADMIN from verify-snapshot and replay-event.**  
   Only SUPER_ADMIN can call these. Company Admins who used them will get 403. Document as intentional (governance = Super Admin only).

5. **Introduce requirePermission/withPermission.**  
   New code path; existing routes unchanged until migrated.

6. **Assign CAMPAIGN_ARCHITECT to users later.**  
   When you add UI or admin flow to set role to CAMPAIGN_ARCHITECT, those users get new capabilities without breaking others.

### 5.2 Backward Compatibility Strategy

| Area | Strategy |
|------|----------|
| **Legacy super_admin_session** | Keep. requirePermission and enforceRole both treat cookie as SUPER_ADMIN. No change to middleware. |
| **Supabase session** | No change. resolveUserContext and getSupabaseUserFromRequest unchanged. |
| **user_company_roles.role** | TEXT; no constraint. New value CAMPAIGN_ARCHITECT is valid. Existing values unchanged. |
| **withRBAC / enforceRole** | Remain. New guard calls same underlying logic. No deprecation in this plan. |
| **Frontend** | No changes in this plan. CompanyContext and hasPermission matrix stay; can be aligned in a later, UI-safe pass. |
| **Company Admin** | Keeps CREATE_USER, ASSIGN_ROLE, execution workflows. Loses only governance (verify-snapshot, replay-event). |
| **Super Admin** | Loses CREATE_USER/ASSIGN_ROLE for company users; keeps all super-admin APIs and governance. |

### 5.3 Rollback (Per Step)

- **Role/PERMISSIONS change:** Revert commit to rbacService; clear rbac cache if any.
- **campaigns/list:** Revert to hasPermission(role, 'view') (restores bug).
- **Governance routes:** Revert to [Role.COMPANY_ADMIN, Role.SUPER_ADMIN].
- **New guard file:** Remove or leave unused; no route depends on it until Phase B.

---

## 6. Step-by-Step Implementation Order (PR-Sized Steps)

Each step is intended to be one small PR: auth/permissions only, no UI, no campaign logic.

---

### Step 1 — Fix campaigns/list permission bug  
**Scope:** 1 file.  
**Risk:** Low (fixes incorrect 403).

- In `pages/api/campaigns/list.ts`, replace `hasPermission(role, 'view')` with `hasPermission(role, 'VIEW_CAMPAIGNS')`.
- Verify: GET campaigns/list with companyId and valid role returns 200.

---

### Step 2 — Add CAMPAIGN_ARCHITECT role (no assignment)  
**Scope:** backend/services/rbacService.ts.  
**Risk:** Low (additive only).

- Add `Role.CAMPAIGN_ARCHITECT = 'CAMPAIGN_ARCHITECT'`.
- Add to `ALL_ROLES`.
- In `normalizeRole`, handle `'CAMPAIGN_ARCHITECT'`.
- In `normalizePermissionRole`, identity for CAMPAIGN_ARCHITECT (no mapping).
- Do **not** add CAMPAIGN_ARCHITECT to any PERMISSION yet (next step).
- Verify: existing tests and one manual API call with existing role unchanged.

---

### Step 3 — Add Campaign Architect to selected permissions  
**Scope:** backend/services/rbacService.ts.  
**Risk:** Low (no user has role yet).

- Add CAMPAIGN_ARCHITECT to PERMISSIONS: VIEW_CAMPAIGNS, CREATE_CAMPAIGN, VIEW_ANALYTICS, VIEW_DASHBOARD.
- Verify: no regression (no user has this role).

---

### Step 4 — Remove Super Admin from company user management permissions  
**Scope:** backend/services/rbacService.ts.  
**Risk:** Medium (Super Admin loses CREATE_USER/ASSIGN_ROLE on company APIs).

- In PERMISSIONS, set CREATE_USER: [Role.COMPANY_ADMIN].
- In PERMISSIONS, set ASSIGN_ROLE: [Role.COMPANY_ADMIN].
- Verify: Company Admin can still invite/assign; Super Admin gets 403 on company users API (if called with Supabase token). Super-admin-only routes (e.g. /api/super-admin/users) still work with cookie.

---

### Step 5 — Restrict governance routes to Super Admin only  
**Scope:** 2 files.  
**Risk:** Low (narrowing).

- `pages/api/governance/verify-snapshot.ts`: change withRBAC allowedRoles from [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] to [Role.SUPER_ADMIN].
- `pages/api/governance/replay-event.ts`: same change.
- Verify: Super Admin can call; Company Admin gets 403.

---

### Step 6 — Add centralized permission guard (no route migration)  
**Scope:** New file backend/guards/requirePermission.ts.  
**Risk:** Low (unused by routes).

- Implement requirePermission(req, res, { permission, companyId?, requireCompany? }) using existing resolveUserContext, getUserCompanyRole, hasPermission, and legacy cookie check.
- Implement withPermission(handler, permission, options?).
- Add unit or integration test for requirePermission (e.g. Super Admin cookie → pass for VIEW_CAMPAIGNS; fail for CREATE_USER).
- No API route uses it yet.
- Verify: existing tests pass; new guard test passes.

---

### Step 7 — Migrate 2 governance routes to withPermission (optional)  
**Scope:** 2 route files.  
**Risk:** Low.

- In verify-snapshot and replay-event, replace withRBAC(handler, [Role.SUPER_ADMIN]) with withPermission(handler, 'GOVERNANCE_*' or keep withRBAC). If no GOVERNANCE_* key exists, keep withRBAC; this step can be “document that these two use SUPER_ADMIN only” and skip code change, or add a permission key and use withPermission.
- Recommendation: skip this step if you want zero new permission keys; Step 5 is enough. If you add a key like GOVERNANCE_REPLAY / GOVERNANCE_VERIFY_SNAPSHOT, then migrate.

---

### Step 8 — Document and optional DB note  
**Scope:** Docs only; optional DB comment.  
**Risk:** None.

- In AUTH-AND-ACCESS-ANALYSIS.md or this plan, note “CAMPAIGN_ARCHITECT is a valid role in user_company_roles.role.”
- If you have a list of allowed role values in app code (e.g. invite dropdown), add CAMPAIGN_ARCHITECT there in a **later** PR when you do UI for role assignment (this plan excludes UI changes).

---

## 7. Summary

| Item | Delivered |
|------|-----------|
| **Minimal refactor path** | Keep Supabase + super_admin_session; change only role enum, PERMISSIONS, one bug fix, one new guard, and 2 governance routes. |
| **Role refactor checklist** | Files and order (§2.1); role enum and RBAC updates (§2.2–2.3). |
| **Permission migration plan** | What moves to Campaign Architect (§3.1), what stays Company Admin only (§3.2), what stays Super Admin only (§3.3), and summary matrix (§3.4). |
| **Guard standardization** | Single guard requirePermission/withPermission (§4); unification via incremental migration, no big-bang (§4.3). |
| **Safety plan** | Migration steps and backward compatibility (§5); rollback per step (§5.3). |
| **Implementation order** | 8 small steps (§6), each PR-sized, auth + permissions only, no UI, no campaign logic. |

**End of implementation plan.** Proceed with Step 1 when ready.
