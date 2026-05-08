# Super-Admin Canonical Integration Readiness

**Generated**: 2026-05-07
**Question**: Can the super-admin runtime be migrated to the canonical chain `auth_session → principal → capabilities → step-up → authorization`?

**Verdict**: Yes, but **with substantial migration surface**. Five categories of blockers, each with a concrete fix path.

---

## Migration target

```
HTTP request
      │
      ▼
┌──────────────────────────────────────┐
│ Next.js route handler                 │
│ requireCapability(req, res, opts) {   │
│   ├─ resolvePrincipal(req)            │
│   │   ├─ resolveAuthenticatedUser     │  ← Bearer + Supabase auth cookie
│   │   ├─ build principal              │  ← auth_sessions + capability_assignments + mfa state
│   │   └─ NO bridge fallback           │
│   ├─ AuthorizationService.decide      │  ← capability hierarchy + role → capability
│   ├─ evaluateStepUp                   │  ← stepup_sessions + policy registry
│   └─ logSecurityEvent                 │  ← capability_audit_log INSERT
│ }                                     │
└──────────────────────────────────────┘
```

---

## Blocker 1 — Isolated session store (the bridge cookie itself)

**Description**: `super_admin_session=1` and `content_architect_session=1` cookies are independent of `omnivyra_session` (canonical) and `sb-*-auth-token` (Supabase). Their lifecycle is entirely separate: minted by env-var compare, expires after 24h, no DB row, no audit row, no rotation.

**Surface**: [pages/api/super-admin/login.ts](../../../pages/api/super-admin/login.ts), [pages/api/super-admin/content-architect-login.ts](../../../pages/api/super-admin/content-architect-login.ts) — the mint sites.

**Fix path**: Wave 3 deletes the mint sites. Operators sign in via the canonical Supabase login flow + complete a passkey step-up. No env-var bypass.

**Migration prerequisite**: at least one DB-backed SUPER_ADMIN with passkey enrolled MUST exist. Wave 3A's `pages/api/admin/bootstrap-super-admin.ts` is the only path to this state without bridge dependency.

---

## Blocker 2 — Custom cookies outside canonical resolver

**Description**: `content_architect_company_id` is a third cookie carrying authority data (org scope). No canonical equivalent.

**Surface**: [backend/services/contentArchitectService.ts:22-27](../../../backend/services/contentArchitectService.ts) (read), [pages/api/super-admin/content-architect-login.ts:60-66](../../../pages/api/super-admin/content-architect-login.ts) (write).

**Fix path**: Content-architect role becomes a real `user_company_roles` row with `role='CONTENT_ARCHITECT'` (new role) bound to the operator's `users.id`. Org scope comes from `principal.activeOrgId` (canonical) or capability allowlist (`CONTENT_ARCHITECT_*` capabilities scoped to the binding org). Cookie deleted.

**Capability mapping** (TBD; not yet in `SecurityCapabilities.ts`):
- `CONTENT_ARCHITECT_READ_COMPANY_PROFILE` (any company)
- `CONTENT_ARCHITECT_WRITE_CAMPAIGN_DRAFTS` (any company)

---

## Blocker 3 — Middleware assumptions baked into route handlers

**Description**: 67 distinct files have hand-rolled `req.cookies?.super_admin_session === '1'` checks. Each is its own micro-precedence chain. There is no single chokepoint to migrate (no `middleware.ts`).

**Surface**: 67 routes (full list in [route-classification.md](route-classification.md)).

**Fix path**: per-route migration to `requireCapability`. Mechanical but high-volume. Mitigation strategies:
- Codemod: replace the cookie check + Supabase fallback with `const guard = await requireCapability(req, res, { capability: SUPER_ADMIN_FOR_THIS_ROUTE, … }); if (!guard.ok) return;`
- Capability mapping table per route (about 15 distinct capabilities cover the 67 sites)
- Run `LEGACY_BRIDGE_DRY_RUN=1` first to verify operator workflows work without the cookie before deleting it

**Estimated effort**: ~200 line-changes per file × 67 files = ~13.4k lines of mostly-mechanical code change.

---

## Blocker 4 — Hardcoded env auth (login routes)

**Description**: The mint sites bypass DB entirely. `SUPER_ADMIN_USERNAME`/`SUPER_ADMIN_PASSWORD` env compare grants admin authority on a successful credential match.

**Surface**: [pages/api/super-admin/login.ts:6-19](../../../pages/api/super-admin/login.ts), [pages/api/super-admin/content-architect-login.ts:9-21](../../../pages/api/super-admin/content-architect-login.ts).

**Fix path**: DELETE both files in Wave 3. Operator authentication becomes:
1. Sign in with Supabase identity (email/password or OAuth)
2. Complete phishing-resistant step-up (passkey)
3. `requireCapability(IDENTITY_ADMIN_ASSIGN)` against the user's `user_company_roles` SUPER_ADMIN row

If env vars are still set after deletion, they're inert (no code reads them).

---

## Blocker 5 — Incompatible admin flows (frontend)

**Description**: `pages/super-admin.tsx` and its tabs use `fetchWithAuth` which sends Bearer token + cookies. Bridge-cookie operators never have a Bearer token. If the bridge is removed, every admin API call goes out without authority and 401s.

**Surface**:
- [pages/super-admin.tsx](../../../pages/super-admin.tsx) — entire dashboard
- [pages/super-admin/dashboard.tsx](../../../pages/super-admin/dashboard.tsx) — re-export
- [pages/super-admin/consumption.tsx](../../../pages/super-admin/consumption.tsx)
- [pages/super-admin/free-credits.tsx](../../../pages/super-admin/free-credits.tsx)
- [pages/super-admin/system-health.tsx](../../../pages/super-admin/system-health.tsx)
- [components/super-admin/**/*.tsx](../../../components/super-admin/) — sub-components calling fetchWithAuth

**Fix path**:
1. Add a Supabase login flow to `pages/super-admin/login.tsx` (next to the existing env-var path during transition)
2. Once the env-var path is removed, the operator's Bearer token is always present
3. Optionally: wire the canonical `omnivyra_session` cookie to make Bearer-less requests work (the SessionAuthorityService already supports this — see [SessionAuthorityService.ts:281](../../../backend/security/SessionAuthorityService.ts) `ensureSessionForUser`)

---

## Missing capability mappings

Wave 3B will need these capabilities defined in [shared/contracts/security/SecurityCapabilities.ts](../../../shared/contracts/security/SecurityCapabilities.ts):

| Capability (proposed) | Maps to | Used by |
|---|---|---|
| `INTEGRATION_PLATFORM_OAUTH_MANAGE` | platform OAuth config writes | platform-oauth-configs.ts |
| `BLOG_PUBLISH_MANAGE` | blog admin routes | admin/blog/* |
| `CONSUMPTION_VIEW_AGGREGATE` | consumption dashboards | admin/consumption/* |
| `INTELLIGENCE_OVERRIDE_MANAGE` | scheduler-* routes | admin/intelligence/* |
| `CRON_CONFIG_MANAGE` | cron-config routes | admin/cron-config.ts, admin/queue-config.ts |
| `BILLING_AUDIT_VIEW` | super-admin audit-logs | super-admin/audit-logs.ts |
| `SUPER_ADMIN_DASHBOARD_VIEW` | dashboard data fetches | super-admin.tsx + tabs |
| `CONTENT_ARCHITECT_*` | content-architect role | resolveCompanyAccess + 13 files |

These need to be added to:
1. The `Capability` literal union
2. The `ALL_CAPABILITIES` array
3. The capability hierarchy (parent/child)
4. (For elevated ones) the step-up policy registry
5. (For SUPER_ADMIN) the role-to-capability mapping in `CapabilityService.ts`

---

## Migration surface (concrete file count)

| Layer | Files affected |
|---|---|
| Mint sites (DELETE) | 3 |
| Direct `super_admin_session` cookie reads (MIGRATE) | 67 |
| `getLegacySuperAdminSession` callers (MIGRATE) | 19 |
| `isContentArchitectSession` callers (MIGRATE + DELETE) | 13 |
| `requireSuperAdminUser` callers (MIGRATE — Pattern D) | ~60 |
| Frontend admin pages (Bearer flow) | ~6 page files + sub-components |
| Capability registry additions | 1 file (`SecurityCapabilities.ts`) |
| Capability hierarchy + step-up policy | 1 file each |
| Synthetic `userId === 'content_architect'` removals | 4 |
| `super_admins` table reference removals | 2 |

**Total file change set**: ~175 files. Mechanical migration with codemods possible for 90%; the frontend Supabase login flow + capability registry additions are the genuinely new work.

---

## Verdict

**MIGRATABLE WITH CONSTRAINTS.** The canonical chain (`auth_session → principal → capabilities → step-up → authorization`) is a complete superset of what the bridge currently grants. The migration is large but mechanical for most of the surface. The non-mechanical parts:

1. ✅ Operator-facing Supabase login flow (currently does not exist on /super-admin/login.tsx)
2. ✅ `CONTENT_ARCHITECT_*` capability definitions + role
3. ✅ Per-route capability mapping for the 67 cookie-direct routes
4. ✅ Wave 3A bootstrap route already lands the first SUPER_ADMIN — schema patch verified

The principal blocker remains operator action (no SUPER_ADMIN exists yet); see [/architecture-migration/reports/security-wave3b-readiness/wave3b-readiness-final.md](../security-wave3b-readiness/wave3b-readiness-final.md).
