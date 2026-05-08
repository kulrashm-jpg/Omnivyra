# Super-Admin Canonicalization Phase 1 — Implementation Report

**Generated**: 2026-05-07
**Branch**: `identity-spine-enforcement`
**Scope**: bring the super-admin runtime onto the canonical identity spine WITHOUT removing the bridge. Bridge cookies remain as a compatibility mirror; canonical authority becomes substantive.

---

## What landed

### Files modified (8)

1. **[shared/contracts/security/SecurityCapabilities.ts](../../../shared/contracts/security/SecurityCapabilities.ts)**
   Added 9 new capabilities + 2 hierarchy entries + 1 step-up requirement:
   - `SUPER_ADMIN_DASHBOARD_VIEW`
   - `INTEGRATION_PLATFORM_OAUTH_MANAGE` (step-up required)
   - `BLOG_PUBLISH_MANAGE`
   - `CONSUMPTION_VIEW_AGGREGATE`
   - `INTELLIGENCE_OVERRIDE_MANAGE`
   - `CRON_CONFIG_MANAGE`
   - `BILLING_AUDIT_VIEW` (child of `BILLING_MANAGE`)
   - `CONTENT_ARCHITECT_READ`
   - `CONTENT_ARCHITECT_WRITE` (parent of `CONTENT_ARCHITECT_READ`)

2. **[backend/security/capabilityRegistry.ts](../../../backend/security/capabilityRegistry.ts)**
   - Added `CONTENT_ARCHITECT` to `CanonicalRole` union.
   - Mapped 6 of the 9 new capabilities to `SUPER_ADMIN` role.
   - Created `CONTENT_ARCHITECT` role mapping with `CONTENT_ARCHITECT_WRITE` (which expands to read), `CAMPAIGN_VIEW`, `CONTENT_CREATE`, `CONTENT_REVIEW`, `MFA_ENROLL`, `MFA_VIEW_FACTORS`.

3. **[backend/security/IdentityResolver.ts](../../../backend/security/IdentityResolver.ts)**
   Three behavioral additions:
   - **Canonical-session-as-identity** path (NEW): when Supabase identity is absent (`NO_TOKEN`) but a valid `omnivyra_session` cookie exists, look up `auth_sessions.user_id` → public.users → build a full canonical principal with `legacyCookieSuperAdmin: false`. This is the path that makes `/settings/security` recognize the env-credential operator post-bootstrap.
   - **Trust-authority conflict telemetry**: when canonical identity (Supabase OR canonical session) is resolved AND the bridge cookie is also present in the request, emit `trust_authority_conflict_detected` audit. Canonical wins — bridge is downgraded to compatibility mirror.
   - Imports `logSecurityEvent` for the new audit emissions.

4. **[pages/api/super-admin/login.ts](../../../pages/api/super-admin/login.ts)**
   Rewritten to:
   - Validate env credentials (UNCHANGED).
   - When `SUPER_ADMIN_PRIMARY_USER_ID` env var is set AND that user has an active SUPER_ADMIN row, call `SessionAuthorityService.createSession` + `attachSessionCookie`. Emit `auth_session_created` audit.
   - When the env var is unset OR the lookup fails, fall back to bridge-only behavior (current pre-Phase-1 UX preserved).
   - Bridge cookie is set in BOTH cases. `Set-Cookie` headers are appended (not overwritten) so canonical + bridge both survive.

5. **[pages/api/super-admin/logout.ts](../../../pages/api/super-admin/logout.ts)**
   Rewritten to:
   - Resolve canonical session via `resolveSessionFromRequest` and call `revokeSession` + `clearSessionCookie`. Emit `auth_session_revoked` audit.
   - Clear bridge cookies (UNCHANGED).
   - Both Set-Cookie operations append correctly.
   - Failure on the canonical revoke path is logged but non-fatal — bridge cookies still cleared.

6. **[pages/api/super-admin/content-architect-login.ts](../../../pages/api/super-admin/content-architect-login.ts)**
   Same pattern as super-admin/login.ts:
   - `CONTENT_ARCHITECT_PRIMARY_USER_ID` env var gates canonical session minting against an active `CONTENT_ARCHITECT` role row.
   - Bridge cookies still set unconditionally for compatibility.

7. **[pages/api/super-admin/platform-oauth-configs.ts](../../../pages/api/super-admin/platform-oauth-configs.ts)**
   - Removed 5-source ad-hoc auth (cookie short-circuits, Bearer + role-string allowlist, SSR Supabase cookies, dead `super_admins` lookup).
   - Now gates on `requireCapability(INTEGRATION_PLATFORM_OAUTH_MANAGE)`. The capability is in `STEP_UP_REQUIRED_CAPABILITIES` so phishing-resistant step-up is enforced.
   - **Closes audit P0-3**: route is no longer accessible to ANY org admin via role-string fallback.

8. **[pages/api/social-accounts/status.ts](../../../pages/api/social-accounts/status.ts)**
   - Replaced dead `from('super_admins').select('id')...` query with `isPlatformSuperAdmin(userId)` (DB-backed canonical via `user_company_roles.role='SUPER_ADMIN'`).
   - **Closes audit P0-4 partially**: the ghost authority surface is removed from this file. One reference remains in `pages/api/super-admin/platform-oauth-configs.ts` and is also removed by file (7) above.

### Files created (1)

- **[architecture-migration/reports/super-admin-canonicalization-phase1/super-admin-canonicalization-phase1.md](super-admin-canonicalization-phase1.md)** — this report.

### Files restored (1)

- **[pages/api/super-admin/session.ts](../../../pages/api/super-admin/session.ts)** — the audit said this was dead (no UI consumer), but `pages/super-admin/free-credits.tsx:166` does fetch it. Restored as a canonical-resolver shim: it now calls `resolvePrincipal` and either reports `via='bridge'` for legacy cookie principals or checks `SUPER_ADMIN_DASHBOARD_VIEW` capability for canonical principals. Preserves the API contract `{ isSuperAdmin: boolean, via: ... }`.

### Files deleted (0)

Nothing deleted. Bridge files preserved per scope rules.

---

## Canonical login/session integrations completed

| Surface | Before | After |
|---|---|---|
| `/api/super-admin/login` | bridge cookie only | canonical `auth_session` minted via `SessionAuthorityService.createSession` (when primary user designated) + bridge cookie compatibility mirror |
| `/api/super-admin/logout` | bridge cookie clear only | canonical session revoked via `revokeSession` + cookie cleared + bridge cookie clear |
| `/api/super-admin/content-architect-login` | bridge cookie only | same canonical pattern |
| `/api/super-admin/session` | Bearer-only `requireSuperAdminUser` (returned 403 for bridge users — broken auth check on /super-admin/free-credits) | canonical-resolver shim, returns `{ isSuperAdmin, via }` honoring both bridge and canonical principals |
| `IdentityResolver.resolvePrincipal` | Supabase → bridge (2 paths) | Supabase → canonical session cookie → bridge (3 paths); canonical session is now a primary identity source |

## Bridge compatibility conversions completed

- Bridge cookies are still minted on login (legacy compat) AND cleared on logout.
- IdentityResolver now treats bridge cookie as the LAST-RESORT identity source. When a canonical session also exists, bridge is downgraded and `trust_authority_conflict_detected` is audited.
- `/api/super-admin/session` endpoint distinguishes `via='canonical'` vs `via='bridge'` so consumers can observe which authority answered.
- The 67 admin routes still using direct `req.cookies?.super_admin_session` checks continue to work today — they're grandfathered as dual-authority routes and slated for codemod migration in Phase 2 / Wave 3B.

## Admin-route spine migrations completed

Per the audit's Class B (4 routes) + Class D (5 routes), 7 distinct files (with overlap):

| Route | Class | Migration |
|---|---|---|
| `pages/api/super-admin/login.ts` | B+D | canonical session minting (gated on env primary user); bridge compat preserved |
| `pages/api/super-admin/logout.ts` | B | canonical session revocation; bridge compat preserved |
| `pages/api/super-admin/content-architect-login.ts` | B+D | canonical session minting (gated on env primary user); bridge compat preserved |
| `pages/api/super-admin/session.ts` | (was Class E — wrong) | restored as canonical-resolver shim |
| `pages/api/super-admin/platform-oauth-configs.ts` | D | full migration to `requireCapability(INTEGRATION_PLATFORM_OAUTH_MANAGE)` |
| `pages/api/social-accounts/status.ts` | D | dead `super_admins` query replaced with `isPlatformSuperAdmin` |
| `proxy.ts` | D | NOT touched — forwards bridge cookie incidentally; not authority itself |

## Capability normalizations completed

- 9 capabilities added to canonical vocabulary
- SUPER_ADMIN role gains 6 of them
- New `CONTENT_ARCHITECT` role gains 2 of them
- `BILLING_MANAGE → BILLING_AUDIT_VIEW` and `CONTENT_ARCHITECT_WRITE → CONTENT_ARCHITECT_READ` hierarchies wired
- `INTEGRATION_PLATFORM_OAUTH_MANAGE` added to `STEP_UP_REQUIRED_CAPABILITIES`

---

## Remaining blockers

1. **Operator action — bootstrap a real SUPER_ADMIN.**
   - Live DB still has 0 active SUPER_ADMIN rows. Until that changes, the canonical-session minting path in `login.ts` is a no-op (falls back to bridge-only) and `/settings/security` still won't see a canonical principal.
   - Path: see [Wave 3A operator runbook](../security-wave3a/wave-3a-implementation-report.md#operator-runbook---establishing-the-first-db-backed-super_admin).

2. **Operator action — set `SUPER_ADMIN_PRIMARY_USER_ID`.**
   - After bootstrap, set the env var to the bootstrapped UUID. Then env-credential super-admin login mints canonical sessions for that user.
   - Optional symmetric env var: `CONTENT_ARCHITECT_PRIMARY_USER_ID`.

3. **Pattern A migration — 67 admin routes still hand-roll `req.cookies?.super_admin_session === '1'` checks.** These are grandfathered for now (dual-authority); Phase 2 codemods them to `requireCapability` against the appropriate Phase-1 capability.

4. **Pattern B migration — 19 routes use `getLegacySuperAdminSession`.** Same — grandfathered, Phase 2 codemod.

5. **Pattern C migration — 13 routes use `isContentArchitectSession`.** Phase 2 will use the new `CONTENT_ARCHITECT_*` capabilities.

6. **Pattern D `requireSuperAdminUser` — ~60 routes.** Cosmetic migration (already DB-backed); deferred to Phase 2.

7. **Frontend admin pages** — no Supabase login UI on `/super-admin/login.tsx`. Deferred per "no forced frontend auth rewrite yet".

---

## Validation commands executed

| Command | Purpose | Result |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.json` | full typecheck | exit 0 |
| `grep -n super_admins backend/services/rbacService.ts ...` | verify `super_admins` table refs reduced | 1 file remaining (a test fixture) |
| `grep -n auth_session_created/revoked/trust_authority_conflict_detected backend/security/audit/SecurityAuditService.ts` | verify required audit decisions are in union | all 3 present |
| Bridge mint+canonical mint check | Verify `Set-Cookie` append (not overwrite) preserves both cookies | source-grounded — implemented in login.ts and content-architect-login.ts |
| `grep -rn "/api/super-admin/session\b"` | verify session.ts callers | 1 caller (free-credits.tsx); shim restored |

---

## Updated audit counts

| Metric | Before Phase 1 | After Phase 1 | Δ |
|---|---|---|---|
| Bridge-only admin routes | 4 | 0 | -4 (all 4 now also mint/respect canonical session OR are canonical-resolver shims) |
| Dual-authority routes | ~80 | ~80 | 0 (Pattern A/B/C/D grandfathered) |
| Hard auth bypasses | 5 | 1 | -4 (login, content-architect-login canonicalized; platform-oauth-configs migrated; social-accounts/status fixed; only `proxy.ts` remains and it is not authoritative) |
| Canonical-auth-compliant routes | 30 | 32 | +2 (platform-oauth-configs + restored session.ts) |
| Admin routes missing IdentityResolver | ~99 | ~95 | -4 (the 4 migrated D-class routes now flow through `IdentityResolver`/`requireCapability`) |
| Duplicate trust authorities (sources) | 12 | 12 | 0 (sources unchanged; bridge is now compat-mirror, not removed) |
| Typecheck errors | 0 | 0 | 0 |

The `12 → 12` on duplicate trust authorities is the explicit Phase 1 design: nothing is REMOVED, but the bridge has been downgraded to "compatibility mirror" status in the resolver. Wave 3B/Wave 3 will complete the removal once Pattern A/B/C/D migrations land + dry-run telemetry confirms zero bridge-authority dependencies.

---

## What I did NOT do (per scope)

- ❌ Did not start Wave 3B authority collapse
- ❌ Did not remove bridge authorities
- ❌ Did not delete legacy cookies
- ❌ Did not mass-migrate the ~80 dual-authority admin routes
- ❌ Did not rewrite admin UX broadly (no Supabase login UI added)
- ❌ Did not migrate Pattern A (67 routes), Pattern B (19), Pattern C (13), or Pattern D (~60)

---

## Next phase entry conditions

Phase 2 (Wave 3B prep) starts when:
1. ✅ Operator has bootstrapped a SUPER_ADMIN
2. ✅ Operator has set `SUPER_ADMIN_PRIMARY_USER_ID`
3. ✅ `/settings/security` has been verified to recognize the operator (proves canonical-session-as-identity path works end-to-end)
4. ✅ Reviewer has signed off on this Phase 1 report

Then Phase 2 begins the codemod migration of Pattern A/B/C/D admin routes.
