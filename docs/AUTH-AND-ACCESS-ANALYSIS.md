# Authentication and Access Privileges — Analysis

**Scope:** Authentication, session management, role resolution, company context, and access boundaries only. No UI or campaign logic changes.

**Target direction (for refactor):**
- **Super Admin:** Full system access, can enter company context, system governance only.
- **Campaign Architect:** Strategic configuration, campaign intelligence + system-level campaign setup, NO company user creation.
- **Company Admin:** Manages company users/team, execution workflows, operational only.
- **Content Creators:** Task-level access only.

---

## 1. Current Authentication Flow

### 1.1 Login Handling

| Flow | Entry | Mechanism | Session |
|------|--------|-----------|---------|
| **Super Admin** | `POST /api/super-admin/login` | Username + password (env: `SUPER_ADMIN_USERNAME`, `SUPER_ADMIN_PASSWORD`) | Cookie `super_admin_session=1` (HttpOnly, SameSite=Lax, Max-Age=86400) |
| **Company users** | `pages/login.tsx` | Supabase Auth OTP (email magic link) | Supabase session; token in cookies (`sb-*-auth-token`) and/or `Authorization: Bearer <token>` |

- Super Admin login is **separate** from Supabase; no user row required.
- Company users are identified by Supabase `auth.users`; roles live in `user_company_roles` (per company).

### 1.2 Session Management

- **Middleware** (`middleware.ts`), matcher `['/api/:path*']`:
  - `/api/super-admin/login` → always allowed (no session yet).
  - If cookie `super_admin_session === '1'`:
    - Allow `/api/super-admin/*` and `/api/admin/audit-logs`.
  - Else: require **either** cookie `sb-access-token` **or** `Authorization: Bearer <token>`; otherwise 401.

So:
- Super Admin API access is cookie-based only (no Bearer for super admin).
- All other API routes require a valid Supabase token (cookie or header); middleware does **not** resolve roles.

### 1.3 Role Resolution (Backend)

- **Token → user:** `supabaseAuthService.getSupabaseUserFromRequest(req)`  
  - Reads Bearer or `sb-*` cookie, then `supabase.auth.getUser(token)`.
- **User → context:** `userContextService.resolveUserContext(req)`  
  - Loads `user_company_roles` (company_id, role, status) for user.  
  - Builds `UserContext`: `userId`, `role: 'admin'|'user'` (binary), `companyIds`, `defaultCompanyId`.  
  - “Admin” = any active role that normalizes to COMPANY_ADMIN or SUPER_ADMIN.
- **Company-scoped role:** `rbacService.getUserCompanyRole(req, companyId)`  
  - If Super Admin (via `user_company_roles` or legacy cookie), returns SUPER_ADMIN.  
  - Else returns role from `user_company_roles` for that company (active).
- **Super Admin detection:**  
  - **Legacy:** `req.cookies?.super_admin_session === '1'` (in `enforceRole` and super-admin API handlers).  
  - **DB:** `rbacService.isSuperAdmin(userId)` / `isPlatformSuperAdmin(userId)` — checks `user_company_roles` for role = `SUPER_ADMIN`.

So there are **two** Super Admin paths: legacy cookie (no userId) and DB-backed SUPER_ADMIN in `user_company_roles`.

### 1.4 Company Context (Frontend)

- **CompanyContext** (`components/CompanyContext.tsx`):
  - Uses Supabase `auth.getSession()` / `onAuthStateChange` for `isAuthenticated`.
  - Loads `user_company_roles` (active) and builds `companies`, `userRole` (per selected company), `rolesByCompany`.
  - `user.role` is binary: `admin` if any company has SUPER_ADMIN or COMPANY_ADMIN, else `user`.
  - `hasPermission(action)` uses a local `permissionMatrix` (CREATE_CAMPAIGN, GENERATE_RECOMMENDATIONS, APPROVE_CONTENT, etc.) keyed by current `userRole`.
- **Selected company:** Stored in `localStorage` (`selected_company_id`, `company_id`); Super Admin can switch to any company they’re “in” (or see all via super-admin APIs that don’t scope by company).

### 1.5 Page-Level Auth (_app.tsx)

- **AuthGate:** Public routes: `/`, `/login`, `/signup`, `/super-admin/login`, and any path starting with `/super-admin`, plus `/external-apis` with `mode=platform`.
- All other routes: if not `isAuthenticated` and not loading → redirect to `/login`.
- **Gap:** `/super-admin` and `/super-admin/dashboard` are treated as public (no redirect to login). Protection is effectively “calls to super-admin APIs fail without cookie”; no server-side page guard.

---

## 2. Where Role Checks Exist

### 2.1 Backend

| Pattern | Usage |
|--------|--------|
| **withRBAC(handler, allowedRoles)** | Many API routes; requires `companyId` (query/body); uses `enforceRole`; legacy super_admin_session treated as SUPER_ADMIN. |
| **enforceCompanyAccess(req, res, companyId)** | Company scope only; no role check. Used alone or with withRBAC. |
| **hasPermission(role, action)** | Used in company/users, campaigns/index, external-apis, etc. Actions from `rbacService.PERMISSIONS` (e.g. CREATE_USER, VIEW_CAMPAIGNS). |
| **isSuperAdmin(userId)** | Inline in many handlers for “show all companies” or bypass company scope. |
| **Cookie check `super_admin_session === '1'`** | All `/api/super-admin/*` handlers and `enforceRole` (legacy). |
| **Custom** (e.g. ensureCompanyAdminAccess, requireUserAdminAccess) | company/users/[userId]/role, userManagementService: require COMPANY_ADMIN (using Role.ADMIN in code, normalized to COMPANY_ADMIN). |

**Role alias:** `rbacService` maps `ADMIN` → `COMPANY_ADMIN`, `CONTENT_MANAGER` → `CONTENT_CREATOR`, etc. Several routes use `Role.ADMIN` in allowedRoles; that is normalized to COMPANY_ADMIN.

### 2.2 Frontend

| Location | Check |
|----------|--------|
| **CompanyContext** | `isAdmin` = SUPER_ADMIN or COMPANY_ADMIN; `hasPermission(action)` from local matrix. |
| **Header** | Nav items gated by `isAdmin` (SUPER_ADMIN, COMPANY_ADMIN). |
| **DashboardPage** | `hasPermission('CREATE_CAMPAIGN')`, `hasPermission('SCHEDULE_CONTENT')`, `userRole === 'COMPANY_ADMIN'`. |
| **team-management** | Can manage team if COMPANY_ADMIN, SUPER_ADMIN, or ADMIN. |
| **admin/users** | `canManageUsers` = SUPER_ADMIN or ADMIN; Super-Admin–only UI (grant/revoke super admin). |
| **recommendations** | canViewRecommendations, canCreateFromRecommendations, canEditPolicy, etc. by role (COMPANY_ADMIN, CONTENT_CREATOR, CONTENT_MANAGER). |
| **external-apis** | isSuperAdmin vs hasPermission('MANAGE_EXTERNAL_APIS'). |
| **company-profile** | isAdmin (user.role === 'admin'). |
| **recommendations/policy** | isAdmin from `/api/admin/check-super-admin`. |
| **campaign-details** | isAdmin from same API. |
| **social-platforms** | isAdmin + hasPermission('MANAGE_EXTERNAL_APIS'). |
| **community-ai/discovered-users** | canEditRole for CONTENT_CREATOR, CONTENT_REVIEWER, etc. |

### 2.3 Duplicated or Inconsistent Access Checks

- **Super Admin definition:** Both legacy cookie and DB `user_company_roles.role = 'SUPER_ADMIN'`; middleware only allows super-admin routes with cookie; `enforceRole` accepts both.
- **Company Admin vs ADMIN:** Code uses `Role.ADMIN` in withRBAC and custom guards; rbacService normalizes to COMPANY_ADMIN. DB stores COMPANY_ADMIN (and others); one route maps COMPANY_ADMIN → Role.ADMIN for a legacy `users` table.
- **Permission keys:** Backend uses PERMISSIONS (e.g. VIEW_CAMPAIGNS, CREATE_USER); one place uses `hasPermission(role, 'view')` which does not exist in PERMISSIONS (bug: should be VIEW_CAMPAIGNS or similar).
- **Frontend permission matrix** (CompanyContext) is a separate list from backend PERMISSIONS; can drift (e.g. GENERATE_RECOMMENDATIONS only in frontend matrix).
- **Company scope:** Some APIs use only enforceCompanyAccess (no role); others use withRBAC (role + companyId); super-admin often bypasses company (inline isSuperAdmin).
- **admin/audit-logs:** Middleware allows it with super_admin_session cookie; handler has no additional check (anyone with cookie can read audit logs).

### 2.4 Company Admin Excessive Access (vs target)

- **CREATE_USER / ASSIGN_ROLE:** Company Admin has both (same as Super Admin in PERMISSIONS). Target: only Company Admin should manage company users; Super Admin should not be in the same “user creation” bucket for company teams.
- **CREATE_CAMPAIGN / VIEW_CAMPAIGNS:** Company Admin + Content* + Super Admin. Target: Campaign Architect for strategy/setup; Company Admin for execution.
- **MANAGE_EXTERNAL_APIS:** Company Admin + Super Admin. Target: possibly Campaign Architect for system-level API config; Company Admin operational only.
- **GENERATE_RECOMMENDATIONS:** Frontend matrix: SUPER_ADMIN, COMPANY_ADMIN only. Backend recommendations/generate: COMPANY_ADMIN, CONTENT_CREATOR. So Company Admin can do recommendation generation; target is to narrow and separate “strategy” (Campaign Architect) vs “execution” (Company Admin).
- **Analytics / optimization:** Many routes allow COMPANY_ADMIN + SUPER_ADMIN; Company Admin gets broad analytics and optimization access (align with “operational only” by trimming where appropriate).
- **Governance (snapshot, verify-ledger, run-audit, restore, unlock):** Mostly SUPER_ADMIN only; verify-snapshot and replay-event allow COMPANY_ADMIN — inconsistent with “system governance only” for Super Admin.

---

## 3. ROLE ACCESS MATRIX (Current State)

### 3.1 Role → Pages (effective)

| Page / Area | Super Admin | Company Admin | Content* (Creator/Reviewer/Publisher) | View only |
|-------------|-------------|---------------|---------------------------------------|-----------|
| /super-admin/* | ✅ (cookie) | ❌ (no cookie) | ❌ | ❌ |
| /login, /dashboard, /campaigns, etc. | ✅ (if has Supabase + role) | ✅ | ✅ | ✅ (limited by permission) |
| Team management | ✅ | ✅ | ❌ | ❌ |
| Admin/users (grant/revoke super admin) | ✅ | ❌ | ❌ | ❌ |
| Recommendations (view/create/edit policy) | ✅ | ✅ | ✅ (varies) | ❌ |
| External APIs (platform mode) | ✅ | ✅ (MANAGE_EXTERNAL_APIS) | ❌ | ❌ |
| Company profile | ✅ | ✅ (admin) | ❌ | ❌ |

*Content roles often grouped in backend as CONTENT_CREATOR, CONTENT_REVIEWER, CONTENT_PUBLISHER; frontend sometimes uses CONTENT_MANAGER as alias.

### 3.2 Role → APIs (summary)

- **Super Admin only (or legacy cookie):**  
  `/api/super-admin/*`, `/api/admin/audit-logs`,  
  recommendations/simulate, recommendations/audit/[id], recommendations/audit/campaign/[id],  
  external-apis/test, external-apis/[id]/validate, external-apis/health-summary (bypass),  
  governance (run-audit, snapshot, verify-ledger, restore-snapshot, unlock),  
  omnivyra/health, opportunities/refresh-slots.

- **Company Admin (+ Super Admin) or same + Content roles:**  
  analytics (toggle-auto-optimize, campaign-optimization, company-roi, campaign-roi, campaign-optimization-proposal),  
  company users (create, list, assign role, reinvite),  
  content (approve, reject, generate-day, regenerate),  
  campaigns (optimize-week, scheduler-payload, progress, list, [id], health-report),  
  recommendations (group-preview, refresh, create-campaign),  
  outreach-plans, governance (verify-snapshot, replay-event),  
  users (invite, index, [userId], [userId]/role).

- **Company-scoped only (enforceCompanyAccess, no or broad role):**  
  Many campaign/content/recommendation routes; list often ALL_ROLES or broad set.

- **Bug:** `campaigns/list` uses `hasPermission(role, 'view')` — PERMISSIONS has no `view`; effectively fails for normal roles.

### 3.3 Data Visibility Scope

| Actor | Scope |
|-------|--------|
| Super Admin (cookie) | No Supabase user; can call super-admin APIs (companies, users, audit, rbac, community-ai, analytics-summary, campaign-health, etc.). |
| Super Admin (DB) | Same as above when identified by token + user_company_roles; can be given company context and still bypass company filters in many handlers via isSuperAdmin(). |
| Company Admin | All data for companies in their user_company_roles (active). |
| Content Creator / Reviewer / Publisher | Same company scope; visibility and actions limited by PERMISSIONS and route-level withRBAC. |
| View only | Company scope; read-only where VIEW_* permissions apply. |

---

## 4. Access Flow Diagram (logical, text-based)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           REQUEST (API)                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  MIDDLEWARE (api/*)                                                          │
│  • /api/super-admin/login → pass                                              │
│  • super_admin_session=1 → pass for /api/super-admin/*, /api/admin/audit-logs│
│  • else: require sb-access-token OR Bearer → else 401                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
        ┌───────────────────────┐           ┌───────────────────────┐
        │ Super-admin route      │           │ Other API              │
        │ (cookie only)         │           │ (Supabase token)       │
        └───────────────────────┘           └───────────────────────┘
                    │                                   │
                    ▼                                   ▼
        ┌───────────────────────┐           ┌───────────────────────┐
        │ Handler checks        │           │ getSupabaseUserFromReq │
        │ super_admin_session   │           │ → resolveUserContext   │
        │ then proceeds         │           │ → companyIds, role      │
        └───────────────────────┘           └───────────────────────┘
                                                       │
                    ┌──────────────────────────────────┼──────────────────────┐
                    ▼                                  ▼                      ▼
        ┌─────────────────────┐            ┌─────────────────────┐  ┌─────────────────────┐
        │ withRBAC            │            │ enforceCompanyAccess │  │ Inline isSuperAdmin  │
        │ enforceRole(        │            │ (company membership  │  │ + role/permission    │
        │   companyId,        │            │  only)               │  │ checks               │
        │   allowedRoles)     │            └─────────────────────┘  └─────────────────────┘
        │ + legacy cookie     │
        │   → SUPER_ADMIN     │
        └─────────────────────┘
                    │
                    ▼
        ┌─────────────────────┐
        │ getUserCompanyRole  │
        │ or getUserRole       │
        │ (user_company_roles) │
        └─────────────────────┘
                    │
                    ▼
        ┌─────────────────────┐
        │ hasPermission(role,  │
        │   action) optional   │
        └─────────────────────┘
```

**Frontend (page load):**

```
App load → CompanyProvider → Supabase getSession / onAuthStateChange
    → if !session && !publicRoute → AuthGate redirect to /login
    → else load user_company_roles → companies, userRole, hasPermission
    → Page uses isAdmin / userRole / hasPermission to show/hide UI
    → API calls send Bearer or cookie; backend applies middleware + handler checks
```

---

## 5. Role Privilege Conflicts (vs target)

| Conflict | Current | Target |
|----------|--------|--------|
| Company Admin creates users and assigns roles | CREATE_USER, ASSIGN_ROLE for both Super Admin and Company Admin | Keep Company Admin; remove Super Admin from “company user creation” (Super Admin = governance only). |
| No “Campaign Architect” role | All strategic + execution mixed in Company Admin / Content* | Introduce Campaign Architect: strategy, campaign intelligence, system-level campaign setup; no company user management. |
| Company Admin has MANAGE_EXTERNAL_APIS | Same as Super Admin for external APIs | Option: restrict to “company-scoped” APIs for Company Admin; system-level for Campaign Architect or Super Admin. |
| Company Admin on governance | verify-snapshot, replay-event allow COMPANY_ADMIN | Restrict to Super Admin (and later Campaign Architect if desired). |
| CONTENT_MANAGER / CONTENT_PLANNER in code | Mapped to CONTENT_CREATOR or used in allowedRoles | Standardize on Content Creator (task-level); drop or alias CONTENT_PLANNER for clarity. |
| Permission key typo | hasPermission(role, 'view') in campaigns/list | Use correct key (e.g. VIEW_CAMPAIGNS). |
| Two Super Admin paths | Cookie vs user_company_roles | Unify: either deprecate cookie and use DB only, or document and centralize “legacy super admin” in one place. |

---

## 6. Recommended Refactor (minimal change)

### 6.1 Centralized Access Control

- **Single source of truth for “who can do what”:**  
  Keep and extend `rbacService.PERMISSIONS` (and optional DB `rbac_config`) for backend. Add a **permission-to-role matrix** that includes the new Campaign Architect role and reflects the target (Super Admin = governance; Company Admin = users + execution; Campaign Architect = strategy/setup; Content Creator = task-level).
- **Frontend:** Either derive permissions from a single API (e.g. “me/permissions”) that uses the same matrix, or keep a shared constants file that mirrors backend permission keys and roles, and use it in CompanyContext and all role checks.
- **Guards:** Prefer one pattern per concern:
  - **Auth:** middleware (token or cookie) only.
  - **Company scope:** enforceCompanyAccess (or equivalent) when the operation is company-scoped.
  - **Role/permission:** Single helper used by all handlers (e.g. `requirePermission(req, res, permission)` or `withPermission(handler, permission)`), which internally uses getUserCompanyRole + hasPermission and, when needed, isSuperAdmin. Avoid ad-hoc isSuperAdmin + hasPermission in every handler.

### 6.2 Middleware / Guard Improvements

- **Middleware:** Keep current behavior; optionally add a small layer that sets “auth type” (super_admin_cookie | supabase) on request so handlers don’t re-read cookies.
- **Guard pattern:** Introduce a wrapper that:
  - Resolves identity (Super Admin cookie or Supabase user).
  - Resolves company when required (query/body).
  - Checks permission (or allowed roles) from central matrix.
  - Returns 403/400 consistently. Use this instead of mixing withRBAC, enforceCompanyAccess, and inline isSuperAdmin.
- **Super Admin:** In the central guard, treat legacy cookie as SUPER_ADMIN and optionally restrict which permissions Super Admin has for “company user creation” so it aligns with “system governance only.”

### 6.3 Introducing Campaign Architect Safely

- **Phase 1 — Add role only:**  
  Add `CAMPAIGN_ARCHITECT` to `Role` and to DB (e.g. `user_company_roles.role` and any role enum/constraint). Do not grant it to anyone yet. Update PERMISSIONS so Campaign Architect has:
  - Strategic/config: e.g. CREATE_CAMPAIGN (strategy), VIEW_CAMPAIGNS, system-level campaign setup, recommendation generation (if desired), possibly MANAGE_EXTERNAL_APIS (system-level).
  - No CREATE_USER, no ASSIGN_ROLE.
- **Phase 2 — Wire permissions:**  
  Replace direct “Company Admin + Super Admin” checks on strategy/setup APIs with permission-based checks (e.g. CREATE_CAMPAIGN or a new PERMISSION like CONFIGURE_CAMPAIGN_STRATEGY) that include CAMPAIGN_ARCHITECT and exclude Company Admin from “strategy-only” actions if desired.
- **Phase 3 — Narrow Company Admin:**  
  Remove Company Admin from permissions that are “strategy only” (e.g. recommendation simulation, governance replay, or system-level external API config) so Company Admin is clearly “users + execution.”
- **Phase 4 — UI:**  
  Show Campaign Architect in role pickers and assign to users; no UI redesign, only role assignment and visibility consistent with new matrix.

### 6.4 Suggested Refactor Phases (incremental)

| Phase | Scope | Steps |
|-------|--------|--------|
| **1** | Fix and centralize | Fix `campaigns/list` hasPermission('view') → VIEW_CAMPAIGNS (or correct key). Document and, where possible, route all Super Admin checks through one helper (legacy cookie + DB). |
| **2** | Permissions and guards | Add a single `requirePermission(req, res, permission, options?)` (or withPermission wrapper) used by all protected handlers. Migrate 2–3 high-traffic APIs to it; leave rest for later. |
| **3** | Add Campaign Architect | Add CAMPAIGN_ARCHITECT to Role, ALL_ROLES, DB schema, and PERMISSIONS. No assignment yet. |
| **4** | Permission matrix update | Update PERMISSIONS and frontend matrix: CREATE_USER/ASSIGN_ROLE only Company Admin (and optionally Super Admin for cross-company); strategy permissions include CAMPAIGN_ARCHITECT; remove Company Admin from governance (verify-snapshot, replay-event). |
| **5** | Migrate APIs to permission checks | Replace withRBAC(..., [Role.COMPANY_ADMIN, Role.SUPER_ADMIN]) with requirePermission(..., 'PERMISSION_NAME') on strategy/governance/external-API routes. |
| **6** | Company Admin narrowing | Remove Company Admin from any “strategy-only” or “system-level” permission so it only has execution + user/team management. |
| **7** | Frontend alignment | Use same permission keys and roles in CompanyContext (and any “me/permissions” API if added). Ensure team-management and admin/users only show Campaign Architect where appropriate (e.g. assign role, but not “manage company users”). |
| **8** | Optional: Super Admin cookie | Decide whether to keep legacy cookie; if yes, document and centralize. If no, require Super Admin to have a Supabase user + user_company_roles.role = SUPER_ADMIN. |

---

## 7. Current Auth Structure Summary

- **Two auth systems:** Super Admin (cookie after credential login) and company users (Supabase Auth + `user_company_roles`).
- **Session:** Super Admin = cookie only; company users = Supabase session (cookies and/or Bearer).
- **Role resolution:** Backend uses `user_company_roles` (and legacy cookie for Super Admin); frontend uses same table via CompanyContext and binary admin/user + per-company role string.
- **Company context:** Backend requires companyId on many routes and uses enforceCompanyAccess or withRBAC; Super Admin bypasses company via cookie or isSuperAdmin(). Frontend stores selected company in localStorage and loads roles per company.
- **Access control:** Mixed—withRBAC, enforceCompanyAccess, inline isSuperAdmin, and hasPermission; permission keys and frontend matrix not fully aligned; one bug (hasPermission(role, 'view')).

---

**Document purpose:** Refactor role structure and access boundaries before campaign or UI feature work; no UI redesign or campaign logic changes.
