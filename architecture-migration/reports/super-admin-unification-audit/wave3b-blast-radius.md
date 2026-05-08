# Wave 3B Blast Radius Simulation

**Generated**: 2026-05-07
**Question**: "What breaks if bridge authority is removed TODAY?"

This report simulates immediate bridge deletion (DELETE `legacyCookieSuperAdminBridge.ts` + DELETE `super_admin_session=1` cookie path + DELETE `content_architect_session=1` path + DELETE all hand-rolled cookie checks) without first migrating consumers.

---

## Removal model

For this simulation, "bridge authority is removed TODAY" means:
- [backend/security/legacyCookieSuperAdminBridge.ts](../../../backend/security/legacyCookieSuperAdminBridge.ts) is deleted
- [pages/api/super-admin/login.ts](../../../pages/api/super-admin/login.ts), [logout.ts](../../../pages/api/super-admin/logout.ts), [content-architect-login.ts](../../../pages/api/super-admin/content-architect-login.ts) are deleted
- [backend/services/superAdminSession.ts](../../../backend/services/superAdminSession.ts) is deleted
- All `req.cookies?.super_admin_session === '1'` checks evaluate `false` (cookie still in browser, but route handlers no longer act on it)
- All `isContentArchitectSession(req)` calls return `false`
- `IdentityResolver.resolvePrincipal` no longer falls through to bridge — only Supabase identity is honored

The browser still has the bridge cookies (clients didn't reload), but server-side authority is gone.

---

## Route-by-route impact

### Group 1 — Inaccessible admin dashboards (UI level)

| Route | Behavior post-removal |
|---|---|
| [pages/super-admin/dashboard.tsx](../../../pages/super-admin/dashboard.tsx) | Renders, but every API call inside returns 403 → fails with `window.location.href = '/super-admin/login'` redirect |
| [pages/super-admin/login.tsx](../../../pages/super-admin/login.tsx) | `POST /api/super-admin/login` → 404 (file deleted) → "Login failed" error in UI |
| [pages/super-admin/consumption.tsx](../../../pages/super-admin/consumption.tsx) | Render-time data fetches fail; UI partly blank |
| [pages/super-admin/free-credits.tsx](../../../pages/super-admin/free-credits.tsx) | Same |
| [pages/super-admin/system-health.tsx](../../../pages/super-admin/system-health.tsx) | Same |
| `/content-architect/*` | If anything is mounted there, content-architect cookie reads fail → 403 |

**Impact**: Operator cannot reach the super-admin panel. Until they re-establish a Supabase + DB-backed SUPER_ADMIN identity, admin operations are entirely offline.

### Group 2 — 67 dual-authority routes (Pattern A) — break for cookie-only operators

These routes (Pattern A in [route-classification.md](route-classification.md)) had `if (req.cookies?.super_admin_session === '1') return true;` as their first auth gate. With the cookie ignored, they fall through to the Supabase + DB role chain. **A cookie-only operator (no Supabase identity, no DB role) cannot reach any of these routes.**

Sample of what breaks for a cookie-only super-admin:
- All admin API endpoints under `/api/admin/audit-logs`, `/api/admin/blog/*`, `/api/admin/cache-management`, `/api/admin/config/*`, `/api/admin/consumption/*`, `/api/admin/cost-accounting`, `/api/admin/cron-config`, `/api/admin/external-users`, `/api/admin/intelligence/*`, `/api/admin/platform-oauth-configs/*`, `/api/admin/railway-*`
- Super-admin tier APIs under `/api/super-admin/activity-control`, `/api/super-admin/activity-cost-breakdown-v2`, `/api/super-admin/analytics-*`, `/api/super-admin/campaign-health`, `/api/super-admin/community-ai-*`, `/api/super-admin/connection-health`, `/api/super-admin/credit-packages/*`, `/api/super-admin/cron-metrics`, `/api/super-admin/free-credits/*`, `/api/super-admin/ga-*`, `/api/super-admin/llm/*`, `/api/super-admin/queue-metrics`, `/api/super-admin/redis-metrics`, etc.
- Cron health probes under `/api/cron/anomaly-sweep`
- Organization views under `/api/organization/usage-summary`, `/api/organization/enforcement-state`

**Impact**: For an operator with a real Supabase identity AND a `user_company_roles` SUPER_ADMIN row (i.e., post-bootstrap), all routes continue to work because the Supabase + role check satisfies them. For a cookie-only operator (current state with 0 SUPER_ADMIN rows), none of them work.

### Group 3 — 19 dual-authority routes (Pattern B) — same as Group 2

Routes using `getLegacySuperAdminSession` had a synthesized synthetic-session-as-SUPER_ADMIN. Without it, they fall through to Supabase + DB role.

**Impact**: identical to Group 2 — Supabase-authed SUPER_ADMIN works; cookie-only operator doesn't.

### Group 4 — 13 content-architect routes (Pattern C) — break for content-architect cookie users

Routes using `isContentArchitectSession`. Without the cookie path, content-architect access falls through to the Supabase identity path. Since `userId === 'content_architect'` is a synthetic literal (not a real `users.id`), there IS no Supabase fallback for these — they all 403.

**Impact**: Content-architect role becomes inaccessible. There is no DB-backed equivalent role; Wave 3B must create one before bridge removal would be safe for content-architect operators.

### Group 5 — Class D platform-oauth-configs

[pages/api/super-admin/platform-oauth-configs.ts](../../../pages/api/super-admin/platform-oauth-configs.ts) loses 4 of its 5 auth surfaces (C1, C2, S1 still works because SSR cookies are independent of the bridge; G1 dies because `super_admins` is dead anyway). Falls through to "ANY admin role string" check.

**Impact**: Reachable by org admins (already a P0 finding) — bridge removal HARDENS this route slightly (removes the cookie short-circuits) but leaves the role-string fallback.

### Group 6 — Routes already on canonical chain (Class A)

15 capability-gated routes + ~16 self-service auth routes. All work normally — they go through `resolvePrincipal` which (post-removal) only honors Supabase identity. **A Supabase-authenticated SUPER_ADMIN with passkey+step-up reaches every Class A route exactly as today.**

**Impact**: zero. These are already canonical-only.

### Group 7 — Wave 3A bootstrap route

[pages/api/admin/bootstrap-super-admin.ts](../../../pages/api/admin/bootstrap-super-admin.ts) — `mode=bootstrap` explicitly rejects bridge principals (line 149-155). `mode=promote` requires `IDENTITY_ADMIN_ASSIGN` capability + step-up — bridge principal is rejected at step-up.

**Impact**: zero. The bootstrap route is bridge-immune by design.

### Group 8 — `requireSuperAdminUser` routes (~60 files)

These already only honor Supabase + `isPlatformSuperAdmin`. They never depended on the bridge.

**Impact**: zero. These continue working for Supabase-authed SUPER_ADMINs.

---

## Counts at removal time

| Class | Behavior | Count |
|---|---|---|
| Inaccessible admin dashboard pages | UI breaks (login redirect loop) | 5 |
| Broken admin API routes (cookie-only operator) | Returns 403 | 99 (67 + 19 + 13) |
| Routes hardened (cookie surface removed but other auth still works) | platform-oauth-configs | 1 |
| Routes unchanged | Class A canonical | 30 |
| Routes already Supabase-only | requireSuperAdminUser | ~60 |

**For an operator who has completed bootstrap** (Supabase login + DB SUPER_ADMIN row + passkey + step-up): only the 5 dashboard pages break (UI doesn't know to use Bearer/canonical session). Backend APIs largely keep working through Supabase identity.

**For a cookie-only operator** (current state): everything outside Class A breaks. ~100+ admin routes return 403.

---

## Required pre-removal migrations

Sorted by what unblocks the most routes per change:

1. **Bootstrap a real SUPER_ADMIN** (Wave 3A — done). Status: schema patch applied; not yet executed by operator.
2. **Add Supabase login to `/super-admin/login.tsx`**: existing env-var path stays during transition, but a new "Sign in with Supabase" button takes the operator through the canonical flow. Once the operator has a Supabase session, all `requireSuperAdminUser` + Pattern A/B routes work.
3. **Migrate Pattern A (67 routes) to `requireCapability`**: codemod-driven. After this, even a Supabase-authed admin with the wrong capability is correctly denied.
4. **Migrate Pattern C (13 routes) and create `CONTENT_ARCHITECT_*` capabilities**: critical because content-architect operators have no DB identity at all today.
5. **Migrate Pattern D (`requireSuperAdminUser`) to `requireCapability`**: cosmetic for security but adds canonical audit rows.
6. **Delete bridge mint endpoints + bridge resolver**: only after a 7-day dry-run window with `bridge_authority_rejected` count = 0.

---

## What CAN safely remove TODAY (without 7-day dry-run)

NOTHING that affects the production cookie-bridge surface. Even if we delete:
- the dead `super_admins` references (P0-4): **safe** — table doesn't exist anyway
- the dead `userId === 'content_architect'` short-circuits in `pages/api/campaigns/list.ts:31` (Class D): **risky** — only safe AFTER `isContentArchitectSession` is migrated
- `pages/api/super-admin/session.ts` (Class E): **safe** — UI does not call this; verifiable via grep
- the `SUPER_ADMIN_FALLBACK` debug log in `external-apis/index.ts`: **safe** — log statement, no behavior change

These four are the ONLY things that can safely move in advance of full Wave 3B without operator action. The rest must wait for the prerequisites.

---

## Verdict

Bridge removal TODAY would render the operator console inaccessible until they complete the Wave 3A bootstrap path. With current 0-SUPER_ADMIN state, this is **catastrophic** — the only operator entry path is the bridge itself. Removal MUST be sequenced after:

1. ✅ Wave 3A bootstrap route deployed (DONE — schema patch verified)
2. ❌ First DB-backed SUPER_ADMIN provisioned via bootstrap
3. ❌ Supabase login flow added to `/super-admin/login.tsx` (UX work)
4. ❌ Wave 3B codemod migrations of Pattern A/B/C
5. ❌ 7-day dry-run telemetry window observed
6. ❌ Reviewer sign-off

Until step 2, removing the bridge would lock everyone out.
