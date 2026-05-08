# Super-Admin Authority Source Map

**Generated**: 2026-05-07
**Branch**: `identity-spine-enforcement`
**Method**: source-grounded (`grep` over `pages/`, `backend/`, `lib/`); DB-grounded (live remote queries via `mcp__supabase__execute_sql`).

---

## 12 distinct super-admin authority sources

The super-admin runtime relies on **twelve** independent authority sources. Each is independently consulted by some subset of routes; precedence is route-local with no canonical chokepoint.

### Cookies (3)

| ID | Cookie | Set by | Read by |
|---|---|---|---|
| **C1** | `super_admin_session=1` | [pages/api/super-admin/login.ts:22](../../../pages/api/super-admin/login.ts) (env `SUPER_ADMIN_USERNAME`+`SUPER_ADMIN_PASSWORD` compare; `HttpOnly`, `SameSite=Lax`, `Max-Age=86400`) | 67 distinct files match `super_admin_session` |
| **C2** | `content_architect_session=1` | [pages/api/super-admin/content-architect-login.ts:53](../../../pages/api/super-admin/content-architect-login.ts) (env `CONTENT_ARCHITECT_USERNAME`+`CONTENT_ARCHITECT_PASSWORD` compare) | 13 files (`isContentArchitectSession`) |
| **C3** | `content_architect_company_id=<uuid>` | Same login route, line 60-66 (env `CONTENT_ARCHITECT_COMPANY_ID`) | 1 file (`getContentArchitectCompanyId`) |

### Server-side resolvers / synthesizers (5)

| ID | Source | Implementation | Notes |
|---|---|---|---|
| **R1** | `getLegacySuperAdminSession(req)` | [backend/services/superAdminSession.ts:5-9](../../../backend/services/superAdminSession.ts) | Synthesizes `{ userId: 'super_admin_session', role: 'SUPER_ADMIN' }`. Used by 19 files. |
| **R2** | `isContentArchitectSession(req)` + `checkContentArchitectAccess(...)` | [backend/services/contentArchitectService.ts:14-44](../../../backend/services/contentArchitectService.ts) | Synthesizes `{ userId: 'content_architect', role: 'CONTENT_ARCHITECT' }`. |
| **R3** | `resolveLegacyCookieSuperAdminPrincipal(req)` (BRIDGE) | [backend/security/legacyCookieSuperAdminBridge.ts:76](../../../backend/security/legacyCookieSuperAdminBridge.ts) | Synthesizes a full `AuthenticatedPrincipal` with `legacyCookieSuperAdmin: true`. ONLY referenced from [IdentityResolver.ts:253](../../../backend/security/IdentityResolver.ts) — fallback after Supabase resolution fails. |
| **R4** | `resolvePrincipal(req)` | [backend/security/IdentityResolver.ts:240](../../../backend/security/IdentityResolver.ts) | The canonical resolver. Tries Supabase first, falls through to R3 if no Supabase identity. |
| **R5** | Inline `req.cookies?.super_admin_session === '1'` checks | scattered across 67 files | Hand-rolled cookie checks bypassing every helper above. |

### Token-based / DB-backed paths (4)

| ID | Source | Implementation | Notes |
|---|---|---|---|
| **T1** | `getSupabaseUserFromRequest(req)` | [backend/services/supabaseAuthService.ts:30](../../../backend/services/supabaseAuthService.ts) — facade for `resolveAuthenticatedUser` from `authResolver.ts` | Bearer token OR Supabase auth cookie (`sb-*-auth-token` / `auth-token` / `supabase-auth`). Does NOT read bridge cookies. |
| **T2** | `requireSuperAdminUser(req, res)` | [backend/services/requestAccessService.ts:46](../../../backend/services/requestAccessService.ts) | T1 + `isPlatformSuperAdmin(user.id)` against `user_company_roles`. Bridge cookie INVISIBLE here. ~60 routes use this. |
| **T3** | `isPlatformSuperAdmin(userId)` / `isSuperAdmin(userId)` | [backend/services/rbacService.ts:246,256](../../../backend/services/rbacService.ts) | Direct `user_company_roles.role='SUPER_ADMIN'` query. DB-backed canonical. |
| **T4** | `requireCapability(req, res, opts)` | [backend/security/requireCapability.ts:77](../../../backend/security/requireCapability.ts) | Canonical capability gate. 15 routes use it. Internally calls R4 (so honors bridge via fallback). |

### SSR Supabase cookies (1)

| ID | Source | Implementation | Notes |
|---|---|---|---|
| **S1** | `createServerClient` from `@supabase/ssr` | [pages/api/super-admin/platform-oauth-configs.ts:17-26](../../../pages/api/super-admin/platform-oauth-configs.ts) | Reads ALL `req.cookies` and parses Supabase SSR cookie names. Only used in 5 files. Different cookie surface than T1. |

### Synthetic userId short-circuits (1)

| ID | Source | Implementation | Notes |
|---|---|---|---|
| **U1** | `if (user.userId === 'content_architect') ...` | [backend/services/rbacService.ts:235,279](../../../backend/services/rbacService.ts), [backend/services/userContextService.ts:94](../../../backend/services/userContextService.ts), [pages/api/campaigns/list.ts:31](../../../pages/api/campaigns/list.ts) | Branches that special-case the synthetic userId from R2. Behavior: COMPANY_ADMIN-equivalent on every company. |

### Ghost authority (1)

| ID | Source | Implementation | Notes |
|---|---|---|---|
| **G1** | `super_admins` table check | [pages/api/super-admin/platform-oauth-configs.ts:60-66](../../../pages/api/super-admin/platform-oauth-configs.ts), [pages/api/social-accounts/status.ts](../../../pages/api/social-accounts/status.ts) | DB query against `super_admins` table. **TABLE DOES NOT EXIST IN REMOTE DB** (verified). Silently returns null → falls through. Dead authority surface, but appears live in source. |

### Env-only (3)

| ID | Variable | Purpose |
|---|---|---|
| **E1** | `SUPER_ADMIN_USERNAME` + `SUPER_ADMIN_PASSWORD` | Mints C1 |
| **E2** | `CONTENT_ARCHITECT_USERNAME` + `CONTENT_ARCHITECT_PASSWORD` + `CONTENT_ARCHITECT_COMPANY_ID` | Mints C2 + C3 |
| **E3** | `SUPER_ADMIN_BOOTSTRAP_TOKEN` | One-shot single-use authority for `/api/admin/bootstrap-super-admin` (Wave 3A). Should be unset after first SUPER_ADMIN exists. |

---

## Precedence order (route-local; not canonical)

There is **no global precedence**. Each route makes its own ordering choice. Observed patterns:

### Pattern A — "cookie short-circuits" (most common in pre-Wave 2 routes)
```ts
if (req.cookies?.super_admin_session === '1') return true;       // C1 wins
if (req.cookies?.content_architect_session === '1') return true; // C2 wins
const { user } = await getSupabaseUserFromRequest(req);          // T1 next
if (await isPlatformSuperAdmin(user.id)) return true;            // T3 next
// org role fallback
```
Used by: 67 files reading C1 directly.

### Pattern B — "legacy session synthesizer first"
```ts
const legacy = getLegacySuperAdminSession(req);                  // R1 wins
if (legacy) return { userId: legacy.userId, role: 'SUPER_ADMIN' };
const { user } = await getSupabaseUserFromRequest(req);          // T1 next
if (await isPlatformSuperAdmin(user.id)) return ...;             // T3 next
```
Used by: 19 files using `getLegacySuperAdminSession`.

### Pattern C — "content-architect first"
```ts
if (isContentArchitectSession(req)) return true;                 // R2 wins
if (req.cookies?.super_admin_session === '1') return true;       // C1 next
// Supabase + role
```
Used by: 13 files using `isContentArchitectSession`.

### Pattern D — "Supabase-only" (canonical via legacy facade)
```ts
if (!(await requireSuperAdminUser(req, res))) return;            // T2 only
```
Used by: ~60 files. Bridge cookie INVISIBLE — these routes 403 a bridge-only operator.

### Pattern E — "canonical capability gate"
```ts
const guard = await requireCapability(req, res, { capability, ... });  // T4 only
if (guard.ok !== true) return;
```
Used by: 15 routes. Bridge cookie REACHES the route via R4 fallback but cannot satisfy step-up; capability allowlist limits what bridge principals can do.

### Pattern F — "SSR cookies + role check"
```ts
const ssrUser = await createServerClient(...).auth.getUser();    // S1 first
// then super_admins table check (G1 — dead) or role string
```
Used by: `pages/api/super-admin/platform-oauth-configs.ts` only.

---

## Runtime reachability

| Source | Reachable from `/super-admin/dashboard` (cookie-only operator) | Reachable from `/settings/security` (canonical-principal-only path) |
|---|---|---|
| C1 (`super_admin_session`) | ✅ yes (mounted at login) | ✅ cookie reaches the request, but `/api/auth/session` only honors via R4 (bridge fallback) |
| C2 / C3 (content-architect) | ✅ yes (alternate login mode) | ✅ cookie reaches but bridge fallback synthesizes principal with `legacyCookieSuperAdmin: true` (`/settings/security` rejects this branch explicitly at line 132) |
| R1, R2, R5 (inline cookie checks) | ✅ — every admin API uses one of these | ❌ — `/settings/security` calls `/api/auth/session` → `resolvePrincipal` → does NOT use R1/R2/R5 |
| R4 (canonical) | reachable but cookie operator surfaces as bridge principal | reachable; bridge principal is detected and rejected at the `legacyCookieSuperAdmin` guard |
| T1 / T2 / T3 (Supabase + DB role) | ❌ — cookie-only operator has NO Supabase token | ❌ — no Supabase token, returns 401 |
| T4 (`requireCapability`) | not invoked from /super-admin pages directly | invoked indirectly via passkey/totp/device/session routes |
| S1 (SSR Supabase) | ❌ — no Supabase auth cookie present for cookie-only operator | ❌ — same |
| G1 (super_admins table) | ❌ — table absent | ❌ — same |
| U1 (synthetic content_architect userId) | only after R2 produces it | not reachable from canonical resolver |
| E1–E3 | server-side env, no direct request reachability | server-side env |

---

## Hidden fallback paths

1. **`SUPER_ADMIN_FALLBACK` debug log** — [pages/api/external-apis/index.ts:51-56](../../../pages/api/external-apis/index.ts) emits a `console.debug` when `isSuperAdmin(user.id)` succeeds AFTER `isPlatformSuperAdmin` failed. Both functions query `user_company_roles.role='SUPER_ADMIN'`; the only meaningful difference is `isSuperAdmin` doesn't filter by `status='active'`. **A SUPER_ADMIN row with `status != 'active'` would still grant authority via the fallback.**
2. **`getCompanyRoleIncludingInvited`** fallback in 23 files — promotes invited-but-not-active membership rows to active for COMPANY_ADMIN/ADMIN/SUPER_ADMIN. Authority granted before the user accepts.
3. **`super_admins` table** — silent no-op since the table is missing. If the table is ever created, every route doing a `.from('super_admins').select('id')` query starts honoring it. **Reactivation hazard.**
4. **`isContentArchitectSession` fallback inside `resolveCompanyAccess`** — [contentArchitectService.ts:91-93](../../../backend/services/contentArchitectService.ts): if Supabase user exists but has NO role, AND the request has `content_architect_session=1`, the function returns `{ userId: 'content_architect' }`. This means a Supabase user logged in concurrently with the content-architect cookie can fall back to content-architect identity unexpectedly.
5. **Canonical bridge through `IdentityResolver`** — [IdentityResolver.ts:250-256](../../../backend/security/IdentityResolver.ts) checks the bridge ONLY when Supabase auth fails. If both are present, Supabase wins — but this means a SUPER_ADMIN with both a Supabase session AND the bridge cookie is recorded as the Supabase user, never as the bridge.

---

## Counts at a glance

| Source class | Distinct files | Wave 3 disposition |
|---|---|---|
| C1 direct cookie reads | 67 | replace with capability check |
| `getLegacySuperAdminSession` (R1) | 19 | DELETE helper, replace callers |
| `isContentArchitectSession` (R2) | 13 | DELETE helper |
| `requireSuperAdminUser` (T2) | ~60 | migrate to `requireCapability` |
| `super_admin_audit_logs` table writes | 2 | DB table EXISTS — keep for now (audit retention) |
| `super_admins` table reads (G1) | 2 | DELETE references — table is dead |
| `requireCapability` (T4) | 15 | KEEP — canonical |
