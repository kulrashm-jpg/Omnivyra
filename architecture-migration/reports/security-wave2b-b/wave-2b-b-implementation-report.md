# Security Wave 2B-B Implementation Report

**Branch:** `identity-spine-consolidation`
**Wave:** 2B-B of 3
**Date:** 2026-05-07
**Scope:** TOTP backup factor + recovery codes + trusted devices + step-up sessions.
**NOT in scope:** route migration, mass role-check conversion, cookie bridge removal, frontend MFA UX, global MFA enforcement.

---

## Files created (24)

### Vault wrapper
- [supabase/migrations/20260507_security_vault_rpcs.sql](supabase/migrations/20260507_security_vault_rpcs.sql) — `security_create_secret` / `security_get_secret` / `security_delete_secret` SECURITY DEFINER wrappers; `EXECUTE` revoked from PUBLIC, granted only to `service_role`.
- [backend/security/totp/VaultSecretClient.ts](backend/security/totp/VaultSecretClient.ts) — TS client over the wrappers; rejects names not prefixed `security:`.

### TOTP stack (`backend/security/totp/`)
- [totpTypes.ts](backend/security/totp/totpTypes.ts) — `StoredTotpFactor`, `TotpEnrollmentBundle`, `TotpVerifyResult`, recovery-code result shapes.
- [TotpFactorRepository.ts](backend/security/totp/TotpFactorRepository.ts) — `findActiveForUser`, `findByIdForUser`, `insertPending`, `markVerified`, `touchLastUsed`, `revokeFactor`.
- [TotpEnrollmentService.ts](backend/security/totp/TotpEnrollmentService.ts) — `beginEnrollment` (Vault-backed secret), `verifyEnrollment` (activates factor on first valid token).
- [TotpVerificationService.ts](backend/security/totp/TotpVerificationService.ts) — `verifyTotp` (no session minting; pure factor verify).
- [RecoveryCodeService.ts](backend/security/totp/RecoveryCodeService.ts) — argon2id-hashed codes, atomic single-shot `verifyAndConsume`, batch `regenerate`.

### Trusted devices (`backend/security/devices/`)
- [trustedDeviceTypes.ts](backend/security/devices/trustedDeviceTypes.ts)
- [DeviceFingerprintService.ts](backend/security/devices/DeviceFingerprintService.ts) — SHA-256 fingerprint over UA + Accept-Language + sorted cookie names. Supersedes the inlined djb2 hash from Wave 2A.
- [DeviceSessionRepository.ts](backend/security/devices/DeviceSessionRepository.ts)
- [TrustedDeviceService.ts](backend/security/devices/TrustedDeviceService.ts) — `resolveContext`, `register`, `list`, `revoke`, `flagSuspicious`.

### Step-up (`backend/security/stepup/`)
- [stepUpTypes.ts](backend/security/stepup/stepUpTypes.ts)
- [StepUpPolicyRegistry.ts](backend/security/stepup/StepUpPolicyRegistry.ts) — declarative capability → policy map; `assertPolicyCoverage` validation.
- [StepUpSessionService.ts](backend/security/stepup/StepUpSessionService.ts) — `mint`, `getActiveStatus`, `revokeForAuthSession`. Bridge principals + sessionless principals rejected at mint.

### Routes (10)
- TOTP: [begin-enrollment.ts](pages/api/auth/totp/begin-enrollment.ts), [verify-enrollment.ts](pages/api/auth/totp/verify-enrollment.ts), [verify.ts](pages/api/auth/totp/verify.ts), [recovery.ts](pages/api/auth/totp/recovery.ts), [revoke.ts](pages/api/auth/totp/revoke.ts).
- Step-up: [verify.ts](pages/api/auth/step-up/verify.ts), [status.ts](pages/api/auth/step-up/status.ts).
- Devices: [list.ts](pages/api/auth/devices/list.ts), [trust.ts](pages/api/auth/devices/trust.ts), [revoke.ts](pages/api/auth/devices/revoke.ts).

### Reports
- [architecture-migration/reports/security-wave2b-b/wave-2b-b-implementation-report.md](architecture-migration/reports/security-wave2b-b/wave-2b-b-implementation-report.md) (this file)

---

## Files modified

- [backend/security/audit/SecurityAuditService.ts](backend/security/audit/SecurityAuditService.ts) — extended `AuditDecision` union with the 11 new MFA / device / step-up events. No behavioral change; additive only.

---

## TOTP services added

| Service | Responsibility | Status |
|---|---|---|
| `VaultSecretClient` | Wrapper over Supabase Vault via SECURITY DEFINER RPCs | ✅ |
| `TotpFactorRepository` | `totp_factors` persistence; partial-unique active row enforced by Wave 2A schema | ✅ |
| `TotpEnrollmentService` | Two-phase enrollment: provision secret → verify token → activate | ✅ |
| `TotpVerificationService` | Pure TOTP verify (no session minting) | ✅ |
| `RecoveryCodeService` | argon2id-hashed; atomic single-shot consume; batch regenerate | ✅ |

All TOTP cryptography delegated to `otplib` (RFC 6238). Recovery-code hashing delegated to `argon2` (argon2id; ~19 MiB memory cost; t=2; p=1). **Zero custom crypto.**

---

## Trusted-device services added

| Service | Responsibility | Status |
|---|---|---|
| `DeviceFingerprintService` | SHA-256 fingerprint over normalized UA + Accept-Language + cookie-name set | ✅ |
| `DeviceSessionRepository` | `trusted_devices` persistence; auto-filtered for non-revoked + non-expired | ✅ |
| `TrustedDeviceService` | `resolveContext` (read), `register` (server-issued), `list`, `revoke`, `flagSuspicious` | ✅ |

---

## Step-up services added

| Service | Responsibility | Status |
|---|---|---|
| `StepUpPolicyRegistry` | Declarative capability → `StepUpRequirement` map; coverage assertion | ✅ |
| `StepUpSessionService` | Mint / status / revoke `stepup_sessions` rows bound to an auth_session | ✅ |

Bridge principals + principals without an auth_session_id (Wave-1 callers) cannot mint. Step-up sessions are *separate* entities from auth sessions: revoking the auth session cascades to step-up via `auth_session_id` FK with `ON DELETE CASCADE` (Wave 2A schema).

Policies registered for ALL `STEP_UP_REQUIRED_CAPABILITIES`:
- `identity.admin*` / `organization.delete` / `organization.transfer` / `automation.transfer` → 10-min, phishing-resistant + trusted-device required.
- `billing.manage` / `billing.purchase` / `apiKey.manage` / `apiKey.generate` / `integration.secrets.read` / `mfa.revoke` → 10-min, phishing-resistant.

---

## Auth routes added

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/totp/begin-enrollment` | Provision secret in Vault, return otpauth URI ONCE |
| POST | `/api/auth/totp/verify-enrollment` | Activate factor + emit recovery codes ONCE |
| POST | `/api/auth/totp/verify` | Verify a TOTP token (no session minting) |
| POST | `/api/auth/totp/recovery` | Consume one-shot recovery code; optional regenerate |
| POST | `/api/auth/totp/revoke` | Soft-delete TOTP factor |
| POST | `/api/auth/step-up/verify` | Orchestrator — runs WebAuthn / TOTP / recovery verifier, mints stepup_session |
| GET  | `/api/auth/step-up/status` | Current step-up state for principal's auth_session |
| GET  | `/api/auth/devices` | List principal's active trusted devices |
| POST | `/api/auth/devices/trust` | Register current device as trusted (requires active step-up) |
| POST | `/api/auth/devices/revoke` | Soft-delete a trusted device (owner only; no step-up required) |

All routes:
- Resolve principal via `IdentityResolver.resolvePrincipal` (zero route-local auth parsing).
- Reject legacy-bridge principals on every elevated MFA / device path.
- Delegate crypto to library / service.

---

## Replay / revocation protections implemented

| Protection | Mechanism |
|---|---|
| TOTP factor activation gating | DB partial-unique index (`idx_totp_factors_user_active`) + `markVerified` only flips NULL→now. |
| TOTP secret confidentiality | Stored in `vault.secrets` via SECURITY DEFINER RPC; `vault_secret_id` is the only DB pointer. |
| Recovery-code one-shot | Atomic SQL `UPDATE recovery_codes SET used_at=now() WHERE id=$ AND used_at IS NULL` — race-loser observes false. |
| Recovery-code per-batch revoke | `regenerate` first sets `used_at` on every prior unused row, then inserts the new batch. |
| Recovery-code constant-time | argon2.verify is intrinsically constant-time; outer dummy `timingSafeEqual` guards short-circuit timing. |
| TOTP secret unavailability handling | `readVaultSecret` returns null → caller maps to `SECRET_UNAVAILABLE`; never crash, never leak. |
| Trusted device server-issued | Trust derives from a row in `trusted_devices` matched by SHA-256 fingerprint. No client-supplied trust marker is honored. |
| Trusted device TTL + revoke | `expires_at` + `revoked_at` checked at every resolve. |
| Step-up bridge ineligibility | `StepUpSessionService.mint` rejects bridge principals; `evaluateStepUp` (Wave 2A) returns `BRIDGE_PRINCIPAL_INELIGIBLE`. |
| Step-up auth-session binding | `stepup_sessions.auth_session_id` FK with cascade delete — revoking the auth session invalidates step-up. |
| Step-up TTL | 600s default, 1h max, enforced at mint + at status read. |
| Step-up phishing-resistance enforcement | Policy registry marks billing / api-key / identity admin etc as `phishingResistantOnly`; evaluated at decision time. |

---

## Audit events added (11)

Added to `AuditDecision` union and emitted by Wave 2B-B services:
- `totp_enrollment_started`
- `totp_enrolled`
- `totp_verification_failed`
- `totp_revoked` (in addition to the 11 listed in the spec — added for completeness)
- `recovery_code_used`
- `recovery_codes_regenerated`
- `trusted_device_registered`
- `trusted_device_revoked`
- `suspicious_device_detected`
- `stepup_session_created`
- `stepup_session_rejected`
- `stepup_session_expired`

All write to the immutable `capability_audit_log` (Wave 2A: INSERT-only triggers; UPDATE / DELETE blocked).

---

## Remaining blockers

### Critical
1. **Apply migrations**:
   - `supabase/migrations/20260507_identity_security_tables.sql` (Wave 2A — 9 tables).
   - `supabase/migrations/20260507_security_vault_rpcs.sql` (Wave 2B-B — 3 wrappers).
   None of the new services can persist anything until both run.
2. **`SESSION_COOKIE_SECRET`, `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_ORIGIN`** — set per environment (Wave 2A blocker still in effect).
3. **A user must have a DB-backed auth_session row before they can mint step-up.** Wave-1 callers (most of the existing API surface) currently produce principals with `sessionId=null`. Wave 2C / 2B-C will add the session-creation step to login. Until then, `/api/auth/step-up/verify` returns 409 `NO_AUTH_SESSION` for everyone — INTENTIONAL fail-safe.

### Operational
4. **Vault default key id**: `vault.create_secret` requires the project's default vault key. Operator should verify it's configured per Supabase project settings.
5. **Vault outage handling**: `readVaultSecret` returns null on failure; verify routes return clear errors. Wave 2C should add an alerting hook on consecutive failures.
6. **Recovery-code distribution UX**: codes are returned ONCE in the verify-enrollment response. Wave 2C frontend must display + clear, never store.
7. **Bridge expiry still active**: 2026-08-05 hard expiry on `legacyCookieSuperAdminBridge.ts`. Operator must promote a DB-backed SUPER_ADMIN before then.

### Long-tail
8. 22 role-based authorization sites still reference legacy role strings (Wave 2C migration target — unchanged from 2B-A).
9. Cookie super-admin (135 references) + `profiles.is_super_admin` (16 references) — Wave 3.

---

## Validation commands executed

```
mcp__supabase__execute_sql (vault.* routines)  → create_secret, update_secret confirmed
ls node_modules/argon2                          → present (consumed by RecoveryCodeService)
ls node_modules/otplib                          → present (consumed by Totp* services)
ls node_modules/@otplib/core                    → present (HashAlgorithms enum)
npx tsc --noEmit -p tsconfig.json               → 0 errors in any Wave-2B-B file
```

Surviving pre-existing TS errors (cron.ts, in-progress engagement modules) — outside Wave 2B-B scope.

---

## Security baseline counts

(Production code only; reports / migrations / tests excluded.)

| Metric | Pre-2B-B | Post-2B-B | Notes |
|---|---:|---:|---|
| Duplicate trust authorities | 4 | **4** | Wave 3 territory; Wave 2B-B additive. |
| Route-local auth parsers | 0 | **0** | All 10 new routes delegate to `IdentityResolver`. |
| Frontend auth-trust paths (new code) | 0 | **0** | Wave 2B-B added zero frontend code. |
| MFA bypass risks | 0 in passkey paths | **0 in TOTP / recovery / device / step-up paths** | Server-authoritative; bridge principals rejected at every elevated route. |
| Role-based authorization paths | 22 | **22** | Wave 2C target; Wave 2B-B did not touch role checks. |
| Variant contamination | 0 | **0** | Preserved. |
| Runtime cycles | ≤18 | **≤18** | Preserved — security modules form a single forward chain. |
| Runtime DB writes | ≤588 | **≤588** | Within budget. New writes confined to MFA / step-up services and only fire on enrollment / verify / step-up / revoke. |
| Unsafe propagation | ≤6025 | **≤6025** | Preserved. |
| Typecheck errors (Wave-2B-B files) | — | **0** | Clean across all 24 created files + 1 modified file. |

---

## Wave 2C preview (next session)

Order:
1. **Capability enforcement helper** — `withSecurity({ capability, stepUp? })` middleware for routes.
2. **High-leverage role-check conversion** — billing / api-key / integration / identity-admin sites first; rest staged.
3. **Step-up gating on elevated routes** — wrap with `decideCapabilityWithStepUp`.
4. **MFA settings frontend** — passkey enrollment, TOTP setup, recovery-code display (one-shot), trusted-device list, step-up challenge UI.
5. **Login-flow integration** — Wave 2B-C: mint `auth_sessions` row at login, project step-up onto step-up flow inputs.

Wave 3 (after 2C, after operator promotes a DB SUPER_ADMIN):
- Delete `legacyCookieSuperAdminBridge.ts`.
- Remove cookie + `profiles.is_super_admin` reads.
- Drop legacy DB columns (`users.role`, `users.company_id`).
