# Identity-Security Implementation Report — Wave 2A

**Branch:** `identity-spine-consolidation`
**Wave:** 2A of 3
**Date:** 2026-05-07
**Status:** Wave 2A landed. Wave 2B (WebAuthn / TOTP / trusted-device backends + step-up verify flows) and Wave 2C (route conversion) are queued.

---

## Files created

### Contracts (`/shared/contracts/security/`)
- [shared/contracts/security/SecurityCapabilities.ts](shared/contracts/security/SecurityCapabilities.ts) — capability vocabulary (28 capabilities + hierarchy + step-up list).
- [shared/contracts/security/AuthenticatedPrincipal.ts](shared/contracts/security/AuthenticatedPrincipal.ts) — canonical principal shape.
- [shared/contracts/security/AuthorizationRequirement.ts](shared/contracts/security/AuthorizationRequirement.ts) — declarative authorization checks + decision shape.
- [shared/contracts/security/StepUpRequirement.ts](shared/contracts/security/StepUpRequirement.ts) — declarative step-up policy + decision shape.
- [shared/contracts/security/index.ts](shared/contracts/security/index.ts) — barrel export.

### Security services (`/backend/security/`)
- [backend/security/capabilityRegistry.ts](backend/security/capabilityRegistry.ts) — role→capability mapping + hierarchy expansion + orphan-capability detector.
- [backend/security/SessionAuthorityService.ts](backend/security/SessionAuthorityService.ts) — DB-backed signed-cookie auth_sessions.
- [backend/security/CapabilityService.ts](backend/security/CapabilityService.ts) — effective capability resolution from `user_company_roles` + `capability_assignments` + hierarchy.
- [backend/security/AuthorizationService.ts](backend/security/AuthorizationService.ts) — pure + audited capability decisions; step-up composition; HTTP-shaped denial.
- [backend/security/StepUpAuthorizationService.ts](backend/security/StepUpAuthorizationService.ts) — step-up evaluation (verify/challenge flows ship in Wave 2B).
- [backend/security/IdentityResolver.ts](backend/security/IdentityResolver.ts) — canonical principal builder.
- [backend/security/legacyCookieSuperAdminBridge.ts](backend/security/legacyCookieSuperAdminBridge.ts) — temporary, audited bridge with hard-expiry (2026-08-05).
- [backend/security/audit/SecurityAuditService.ts](backend/security/audit/SecurityAuditService.ts) — append-only `capability_audit_log` writer.

### DB migrations
- [supabase/migrations/20260507_identity_security_tables.sql](supabase/migrations/20260507_identity_security_tables.sql) — 9 tables (`auth_sessions`, `trusted_devices`, `webauthn_credentials`, `webauthn_challenges`, `totp_factors`, `recovery_codes`, `stepup_sessions`, `capability_assignments`, `capability_audit_log`) + INSERT-only triggers on the audit log + RLS-enabled / no-policy lockdown.

### Centralized auth routes
- [pages/api/auth/session.ts](pages/api/auth/session.ts) — current principal summary.
- [pages/api/auth/capabilities.ts](pages/api/auth/capabilities.ts) — current principal capability list (UI hint-only; actions still re-check server-side).

### Reports
- [architecture-migration/reports/security-final/role-to-capability-mapping.md](architecture-migration/reports/security-final/role-to-capability-mapping.md)
- [architecture-migration/reports/security-final/wave-2a-implementation-report.md](architecture-migration/reports/security-final/wave-2a-implementation-report.md) (this file)

---

## Files modified

- [package.json](package.json) — added `@simplewebauthn/server`, `@simplewebauthn/browser`, `argon2`, `otplib` to dependencies. **`npm install` must run before Wave 2B routes can compile.**

No production files modified outside `package.json`. Wave 2A is purely additive — existing auth flow behavior is preserved.

---

## Security services added

| Service | Responsibility | Wave 2A status |
|---|---|---|
| **IdentityResolver** | Build canonical `AuthenticatedPrincipal` from request | ✅ implemented |
| **SessionAuthorityService** | DB-backed signed-cookie sessions (`auth_sessions`) | ✅ implemented |
| **CapabilityService** | Effective capability resolution (role + assignments + hierarchy) | ✅ implemented |
| **AuthorizationService** | Capability-based authorization with audit | ✅ implemented |
| **StepUpAuthorizationService** | Step-up evaluation; verify/challenge flows | ⚠ evaluation only — verify/challenge in Wave 2B |
| **SecurityAuditService** | Append-only `capability_audit_log` writes | ✅ implemented |
| **legacyCookieSuperAdminBridge** | Audited temporary cookie super-admin path with hard expiry | ✅ implemented |
| **WebAuthnRegistrationService** / WebAuthnAuthenticationService | Passkey enrollment + verification | ❌ Wave 2B |
| **TotpEnrollmentService** / TotpVerificationService | TOTP backup factor | ❌ Wave 2B |
| **RecoveryCodeService** | argon2-hashed recovery codes | ❌ Wave 2B |
| **TrustedDeviceService** | Server-issued device trust | ❌ Wave 2B |
| **DeviceFingerprintService** | Server-side fingerprint computation | ⚠ inlined in IdentityResolver; lift to standalone in Wave 2B |
| **StepUpSessionService** / StepUpPolicyRegistry | Step-up issuance + policy registry | ❌ Wave 2B |

---

## MFA / passkey flows implemented

**Wave 2A: zero MFA flows are runtime-callable.** Wave 2A delivers the data model, the policy contracts, and the evaluation/audit layers. The actual passkey + TOTP implementations land in Wave 2B together with their HTTP routes:

- `POST /api/auth/passkeys/register/options`
- `POST /api/auth/passkeys/register/verify`
- `POST /api/auth/passkeys/authenticate/options`
- `POST /api/auth/passkeys/authenticate/verify`
- `GET  /api/auth/passkeys` (list)
- `DELETE /api/auth/passkeys/:id` (revoke)
- `POST /api/auth/totp/enroll/start`
- `POST /api/auth/totp/enroll/verify`
- `POST /api/auth/totp/verify`
- `POST /api/auth/totp/regenerate-recovery-codes`
- `POST /api/auth/devices/trust`
- `GET  /api/auth/devices`
- `DELETE /api/auth/devices/:id`
- `POST /api/auth/step-up/challenge`
- `POST /api/auth/step-up/verify`

Passkey policy: passkeys are designated PRIMARY MFA. WebAuthn-only step-up (`phishingResistantOnly: true`) is the default for billing / api-key / identity-admin actions. TOTP is fallback only.

---

## Step-up protections enforced

Wave 2A implements the EVALUATION side. A capability listed in `STEP_UP_REQUIRED_CAPABILITIES` (in `SecurityCapabilities.ts`) is policy-marked, but the actual challenge/verify flows that *create* `stepup_sessions` rows ship in Wave 2B.

Capabilities currently policy-marked as step-up-required:
- `identity.admin` (+ assign / revoke / delete sub-capabilities)
- `organization.delete`
- `organization.transfer`
- `billing.manage`
- `billing.purchase`
- `apiKey.manage`
- `apiKey.generate`
- `integration.secrets.read`
- `automation.transfer`
- `mfa.revoke`

These are NOT yet enforced at the route layer — that's Wave 2C scope. AuthorizationService.decideCapabilityWithStepUp is ready for use, but no route currently invokes it.

---

## Duplicate trust authorities removed

**Wave 2A removed: 0.** Wave 2A is additive scaffolding — no removals. Wave 1 already removed:
- `users.role` runtime reads (zero remaining).
- `users.company_id` runtime reads (zero remaining).
- `firebase_uid` runtime references (only one allowed justification comment).
- Duplicate UID-backfill logic (consolidated to `resolveAuthenticatedUser`).
- Dev-only JWT-claims fallback (deleted).

Wave 2A introduces explicit isolation of the cookie super-admin path:
- It now flows through `legacyCookieSuperAdminBridge.ts`, which audits every use, hard-expires at 2026-08-05, and produces a synthetic principal that **cannot satisfy step-up requirements**.
- The audit log marks every bridge use with `via_legacy_bridge=true`.

Removal of the cookie path itself is **Wave 3 scope and BLOCKED** until a DB-backed `user_company_roles WHERE role='SUPER_ADMIN'` row exists for at least one user (current production count: 0).

---

## Remaining blockers

### Critical (block Wave 2B start)
1. **Run `npm install` to materialize the new libraries.** Until then, Wave 2B services that import `@simplewebauthn/server`, `argon2`, or `otplib` will fail to compile. (Wave 2A code does not import them yet — typecheck should be green.)
2. **Set `SESSION_COOKIE_SECRET`** env var (>= 32 chars). `SessionAuthorityService.createSession` throws if absent. Required for any auth_session row to be created.
3. **Apply the migration** `20260507_identity_security_tables.sql` to dev/staging/prod. None of the new services can persist anything until the tables exist.

### Critical (block Wave 3 start)
4. **Promote a user to `user_company_roles WHERE role='SUPER_ADMIN'`.** Operator action; never auto-promoted by code. The bridge expires 2026-08-05 regardless; ensure a DB-backed super-admin exists before then.

### Operational (Wave 2B / 2C scope, but track)
5. **Recovery-code distribution policy.** Wave 2B will hash codes with argon2id and surface them to the user once at enrollment time. UX decision needed: how to display, what re-issue cadence requires step-up vs. recovery-code consumption.
6. **WebAuthn RP ID + origin per environment.** `WebAuthnAuthenticationService` will need `RP_ID` + `RP_ORIGIN` env vars. Ensure the values are set before Wave 2B routes ship.
7. **Vault key for TOTP secrets.** `vault.create_secret(...)` requires a default vault key id; verify the operator has provisioned one before Wave 2B TOTP enrollment.
8. **Device-fingerprint algorithm.** Wave 2A uses a cheap djb2-style hash inlined in IdentityResolver. Wave 2B should lift this into `DeviceFingerprintService` and adopt a more robust hash (e.g., SHA-256 of the same UA + accept-language + cookie-name set, or a server-side FingerprintJS-equivalent).

### Long-tail (Wave 2C scope)
9. 21 role-string sites still reference `role === 'SUPER_ADMIN'` / `'COMPANY_ADMIN'` etc. in production code. See the role-to-capability-mapping report for the conversion playbook.

---

## Validation commands executed

```
mcp__supabase__list_extensions   →  supabase_vault v0.3.1 confirmed installed
mcp__supabase__execute_sql       →  user_company_roles SUPER_ADMIN count = 0 (Wave 3 blocker)
git grep -nE "role *=== *'..." → 21 Wave-2C role-check sites
npx tsc --noEmit -p tsconfig.json → see "Final security counts" below
```

---

## Final security counts

(Counts apply to production code only. Migrations + tests + audit reports excluded.)

| Metric | Pre-Wave-1 | Post-Wave-1 | Post-Wave-2A | Notes |
|---|---:|---:|---:|---|
| Duplicate trust authorities | 5 | 4 | 4 | Wave 1 collapsed auth resolvers. Cookie + content-architect + DB role + `profiles.is_super_admin` remain (Wave 3 work). |
| Route-local auth parsers | 3 | 0 | 0 | All auth resolution flows through `resolveAuthenticatedUser` (Wave 1) or the new `IdentityResolver` (Wave 2A). |
| Frontend auth-trust paths | n/a | n/a | 0 (new code) | Wave 2A frontend code reads only `/api/auth/session` + `/api/auth/capabilities`. Existing frontend code is unaffected by Wave 2A. |
| MFA-bypass risks | n/a | n/a | n/a | No MFA enforced yet (Wave 2B). Step-up evaluation rejects bridge principals. |
| Role-based authorization paths in production code | n/a | 21 | 21 | Wave 2A added the canonical authorization API; conversion is Wave 2C scope. |
| Typecheck errors in Wave-2A files | — | — | 0 | All Wave-2A files compile clean (verified). |

---

## Wave 2B preview (next session)

Order:
1. WebAuthn registration + authentication services + 6 routes.
2. TOTP enrollment + verification + recovery codes.
3. Trusted-device service + 3 routes.
4. Step-up challenge + verify routes (consume webauthn / totp / recovery-code factors).
5. StepUpPolicyRegistry mapping capability → policy.
6. Capability enforcement helper that wraps existing `requireSuperAdmin` etc. as Wave-2C migration aids.

Wave 2C (after 2B):
- Convert the 21 role-check sites to capability checks.
- Add step-up requirements to billing / api-key / integration / identity-admin routes.

Wave 3 (after 2C, after operator provisions a DB SUPER_ADMIN):
- Delete `legacyCookieSuperAdminBridge.ts` and `pages/api/super-admin/login.ts`.
- Remove `super_admin_session=1` cookie reads from all super-admin endpoints.
- Remove `content_architect_session=1` privilege mapping.
- Remove `profiles.is_super_admin` reads.
- Drop `users.role` and `users.company_id` columns via migration (DB cleanup).
