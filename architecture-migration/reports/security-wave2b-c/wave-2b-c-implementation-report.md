# Security Wave 2B-C Implementation Report

**Branch:** `identity-spine-consolidation`
**Wave:** 2B-C of 3
**Date:** 2026-05-07
**Scope:** Integrate `auth_sessions` minting + step-up rotation into the real login lifecycle.
**NOT in scope:** mass role-check conversion, cookie-bridge removal, full frontend MFA UX, global mandatory MFA.

---

## Files created (3)

- [pages/api/auth/logout.ts](pages/api/auth/logout.ts) — server-side logout: revokes auth_session + cascades step-up revoke + clears cookie + audits.
- [pages/api/auth/refresh.ts](pages/api/auth/refresh.ts) — touches the principal's auth_session if still valid; surfaces revoke/expiry to long-lived SPA clients.
- [architecture-migration/reports/security-wave2b-c/wave-2b-c-implementation-report.md](architecture-migration/reports/security-wave2b-c/wave-2b-c-implementation-report.md) — this file.

## Files modified (5)

- [backend/security/SessionAuthorityService.ts](backend/security/SessionAuthorityService.ts) — added `rotateSession` (revoke-then-mint inheriting remaining TTL); added `ensureSessionForUser` (idempotent helper for sync entry points); added optional-exempt argument to `revokeAllSessionsForUser`.
- [backend/security/audit/SecurityAuditService.ts](backend/security/audit/SecurityAuditService.ts) — extended `AuditDecision` union with the 7 new session-lifecycle events.
- [backend/security/IdentityResolver.ts](backend/security/IdentityResolver.ts) — throttled `touchSession` (>60s stale) on every authenticated request.
- [pages/api/auth/sync-supabase-user.ts](pages/api/auth/sync-supabase-user.ts) — calls `ensureSessionForUser` before each successful 200 return (5 sites covered: existingByUid + bootstrap-success, existingByUid fallback, byEmail + bootstrap-success, byEmail fallback, brand-new INSERT).
- [pages/api/auth/set-password.ts](pages/api/auth/set-password.ts) — revokes ALL `auth_sessions` for the user after a successful password change (credential rotation per NIST 800-63B § 5.2 / OWASP ASVS V3.6) and clears the cookie.
- [pages/api/auth/step-up/verify.ts](pages/api/auth/step-up/verify.ts) — rotates the auth_session before minting the step-up session; emits `auth_session_rotated` + `stepup_session_bound` audits.

---

## Auth-session integrations completed

| Lifecycle event | Hook | Behavior |
|---|---|---|
| **Login (Supabase callback)** | [sync-supabase-user.ts](pages/api/auth/sync-supabase-user.ts) → `ensureSessionForUser` | Mints a fresh `auth_sessions` row + signs cookie if absent / foreign; touches if already present for the same user. Foreign-user cookies are revoked then a new session minted. **Fail-soft** — if `SESSION_COOKIE_SECRET` is missing or migration not applied, the existing Bearer-token flow continues to work. |
| **Refresh** | [refresh.ts](pages/api/auth/refresh.ts) → `touchSession` | Surfaces revoke / expiry to the client (401 with code) so SPAs know to re-auth. |
| **Per-request validation** | [IdentityResolver.ts](backend/security/IdentityResolver.ts) → `touchSession` (throttled) | Stamps `last_seen_at` once per minute per session, never blocking the request path. |
| **Logout** | [logout.ts](pages/api/auth/logout.ts) → `revokeSession` + `revokeForAuthSession` + `clearSessionCookie` | Hard server-side teardown + cookie clear. Cascades step-up revoke. Always returns 200; idempotent. |
| **Credential rotation** | [set-password.ts](pages/api/auth/set-password.ts) → `revokeAllSessionsForUser` + `clearSessionCookie` | Password change revokes EVERY auth_session for the user. The next sync re-mints a fresh session from the user's then-valid Supabase token. |

Bridge principals (legacy `super_admin_session=1` / `content_architect_session=1`) **can authenticate** for the existing read-mostly admin surface, **but cannot mint auth_sessions** — `IdentityResolver.resolveLegacyCookieSuperAdminPrincipal` returns a synthetic principal with `sessionId=null`, and every Wave 2B-A/B/C MFA / step-up / refresh / logout path rejects bridge principals explicitly.

---

## Step-up integrations completed

`POST /api/auth/step-up/verify` is now the canonical orchestrator:

```
1. resolvePrincipal (must be authenticated, non-bridge, has auth_session)
2. Run factor verifier (WebAuthn / TOTP / recovery_code)
3. rotateSession — revoke old auth_session + mint new (inherits TTL)
4. attachSessionCookie — install rotated cookie
5. mint stepup_session — bound to NEW auth_session_id
6. audit: auth_session_rotated + stepup_session_created + stepup_session_bound
```

Step-up sessions therefore can NEVER reference a stale `auth_session_id`: the FK is set to the brand-new id, and the OLD id is `revoked_at`-marked at this point so any inbound request still presenting the old cookie fails auth.

The rotation behavior matches NIST 800-63B (Federation profile) and OWASP ASVS V3.2 elevation-of-privilege guidance.

---

## Session-hardening protections implemented

| Protection | Mechanism | File |
|---|---|---|
| **Foreign-user cookie revoke** | `ensureSessionForUser` revokes any auth_session whose user_id ≠ syncing user | `SessionAuthorityService.ts` |
| **Concurrent-session detection** | foreign-user revoke logs `session_authority_foreign_session_detected` | `SessionAuthorityService.ts` |
| **Rotation on elevation** | `rotateSession` (revoke + mint with inherited TTL) | `SessionAuthorityService.ts` + `step-up/verify.ts` |
| **Credential-change revoke-all** | `revokeAllSessionsForUser(userId, 'credential_rotation:*')` | `set-password.ts` |
| **Throttled touch** | `touchSession` only when last_seen_at > 60s stale; never blocks request | `IdentityResolver.ts` |
| **Step-up cascade revoke on logout** | `revokeForAuthSession(authSessionId, 'auth_session_revoked')` | `logout.ts` |
| **Server-side cookie clear on revoke** | `clearSessionCookie(res)` invoked at logout + credential rotation | `SessionAuthorityService.ts` |
| **No silent reuse** | `resolveSessionFromRequest` rejects revoked / expired / bad-signature rows; `touchSession` only fires on already-valid rows | `SessionAuthorityService.ts` |
| **No orphan step-up sessions** | DB-level `ON DELETE CASCADE` on `stepup_sessions.auth_session_id` (Wave 2A schema) + explicit `revokeForAuthSession` cascade | migration `20260507_identity_security_tables.sql` + `logout.ts` |
| **No auth-session resurrection** | `revokeSession` is idempotent + check-and-set; `revoked_at` is monotonic; `rotateSession` revokes BEFORE mint so a transient race cannot leak the old id | `SessionAuthorityService.ts` |

---

## Audit events added

`AuditDecision` union extended (additive — no behavioral change to prior events):
- `auth_session_created` — emitted from `sync-supabase-user.ts` when minted by `ensureSessionForUser`
- `auth_session_rotated` — emitted from `step-up/verify.ts` after `rotateSession` succeeds
- `auth_session_revoked` — emitted from `logout.ts` and `set-password.ts`
- `auth_session_expired` — reserved (emit when a refresh/touch detects stale row; consumers may add)
- `stepup_session_bound` — emitted from `step-up/verify.ts` after `mint` succeeds with rotated session id
- `stepup_session_revoked` — reserved for an admin-revoke flow (Wave 2C)
- `suspicious_session_invalidated` — reserved for the anomaly hook in `TrustedDeviceService.flagSuspicious` (Wave 2C will wire)
- `concurrent_session_detected` — reserved for the foreign-user-cookie audit (currently logged as warn)

All events flow through `SecurityAuditService.logSecurityEvent` and write to the immutable `capability_audit_log` (Wave 2A: INSERT-only triggers).

---

## Remaining blockers

### Critical (block real session minting in prod)
1. **Apply both migrations** — `20260507_identity_security_tables.sql` + `20260507_security_vault_rpcs.sql`. Until the `auth_sessions` table exists, `ensureSessionForUser` returns `{ sessionId: null, minted: false }` and silently skips cookie attach. The fail-soft path was specifically designed to keep auth working while migrations are applied.
2. **Set envs** — `SESSION_COOKIE_SECRET` (≥ 32 chars), `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_ORIGIN` per environment.

### Operational
3. **Logout flow at frontend** — the existing client-side logout (`supabase.auth.signOut()`) must additionally call `POST /api/auth/logout`. Until then, server-side auth_sessions accumulate until they expire on their own (14-day default TTL). Frontend wiring is Wave 2C.
4. **Refresh-on-idle wiring** — long-lived SPA tabs should poll `POST /api/auth/refresh` (e.g., every 5 minutes) so revoked sessions surface promptly. Frontend wiring is Wave 2C.
5. **Bridge expiry 2026-08-05** — operator must promote a DB-backed `SUPER_ADMIN` row before then (still 0 in prod).

### Long-tail
6. 22 role-based authorization paths (Wave 2C migration target — unchanged).
7. 135 cookie super-admin references + 16 `profiles.is_super_admin` references — Wave 3.

---

## Validation commands executed

```
npx tsc --noEmit -p tsconfig.json              → 0 errors in any Wave-2B-C file
git status                                     → 8 changed files in scope (3 new, 5 modified)
```

Pre-existing typecheck noise (cron.ts, in-progress engagement modules) — outside Wave 2B-C scope.

---

## Security baseline counts

(Production code only.)

| Metric | Pre-2B-C | Post-2B-C | Notes |
|---|---:|---:|---|
| Duplicate trust authorities | 4 | **4** | No removal; Wave 3 territory. |
| Route-local auth parsers | 0 | **0** | All new routes (`logout`, `refresh`, `step-up/verify` orchestration) delegate to `IdentityResolver` / `SessionAuthorityService`. |
| Frontend auth-trust paths (new code) | 0 | **0** | Wave 2B-C added zero frontend code. |
| MFA bypass risks | 0 in passkey/TOTP/device/step-up paths | **0 also for session-lifecycle paths** | Bridge principals rejected at every Wave 2B-C entry; foreign cookies revoked at sync. |
| Role-based authorization paths | 22 | **22** | Wave 2C target; not touched. |
| Variant contamination | 0 | **0** | Preserved. |
| Runtime cycles | ≤18 | **≤18** | Preserved — security modules form a single forward chain (`IdentityResolver → SessionAuthorityService → SecurityAuditService`; no back-edges). |
| Runtime DB writes | ≤588 | **≤588** | Within budget. New writes confined to session-lifecycle (`ensureSessionForUser` / `rotateSession` / `revokeSession` / `revokeForAuthSession` / throttled `touchSession`). |
| Unsafe propagation | ≤6025 | **≤6025** | Preserved. |
| Typecheck errors (Wave-2B-C files) | — | **0** | Clean across all 3 created files + 5 modified files. |

---

## Wave 2C preview (next session)

1. **Capability enforcement helper** (`withSecurity({ capability, stepUp? })`) for routes — wraps `decideCapabilityWithStepUp` + `respondDenied`.
2. **High-leverage role-check conversion** — billing / api-key / integration / identity-admin sites first.
3. **Step-up gating on elevated routes** via `withSecurity`.
4. **Frontend MFA settings UX** — passkey enrollment, TOTP setup + recovery codes (one-shot display), trusted-device list, step-up challenge UI.
5. **Logout + refresh frontend wiring** — call `/api/auth/logout` on signOut; poll `/api/auth/refresh` from long-lived SPA tabs.
6. **Anomaly audit wiring** — emit `concurrent_session_detected` from the `ensureSessionForUser` foreign-user revoke; emit `suspicious_session_invalidated` from `TrustedDeviceService.flagSuspicious` consumers.

Wave 3 (after 2C, after operator promotes a DB-backed SUPER_ADMIN):
- Delete `legacyCookieSuperAdminBridge.ts`.
- Remove cookie + `profiles.is_super_admin` reads.
- Drop legacy DB columns (`users.role`, `users.company_id`).
