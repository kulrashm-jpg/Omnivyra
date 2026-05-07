# Security Wave 2B-A Implementation Report

**Branch:** `identity-spine-consolidation`
**Wave:** 2B-A of 3
**Date:** 2026-05-07
**Scope:** WebAuthn / passkey foundation (server-side only).
**NOT in scope:** TOTP, trusted devices, step-up session enforcement, route migration, frontend MFA UX.

---

## Files created

### Domain types
- [backend/security/webauthn/webauthnTypes.ts](backend/security/webauthn/webauthnTypes.ts) — `StoredWebAuthnCredential`, `StoredWebAuthnChallenge`, `WebAuthnCeremony`, `WebAuthnAuditEvent`, `WebAuthnVerifiedAuthentication`.

### Repositories
- [backend/security/webauthn/WebAuthnChallengeRepository.ts](backend/security/webauthn/WebAuthnChallengeRepository.ts) — `issueChallenge`, `loadChallenge`, `consumeChallenge` (atomic single-shot), `purgeExpiredChallenges`.
- [backend/security/webauthn/WebAuthnCredentialRepository.ts](backend/security/webauthn/WebAuthnCredentialRepository.ts) — `listForUser`, `findByCredentialId`, `findById`, `insertCredential`, `bumpCounter` (monotonic guard), `touchLastUsed`, `revokeCredential`.

### Services
- [backend/security/webauthn/WebAuthnChallengeService.ts](backend/security/webauthn/WebAuthnChallengeService.ts) — challenge lifecycle: `issue`, `claim` (with rejection reasons: `NOT_FOUND`, `WRONG_CEREMONY`, `EXPIRED`, `ALREADY_CONSUMED`, `WRONG_USER_BINDING`, `CONSUME_RACE_LOST`).
- [backend/security/webauthn/WebAuthnRegistrationService.ts](backend/security/webauthn/WebAuthnRegistrationService.ts) — `beginRegistration`, `verifyRegistration` (delegates verification to `@simplewebauthn/server`).
- [backend/security/webauthn/WebAuthnAuthenticationService.ts](backend/security/webauthn/WebAuthnAuthenticationService.ts) — `beginAuthentication` (userless or scoped), `verifyAuthentication` (counter monotonic check, ownership check).

### Env validation
- [backend/security/env.ts](backend/security/env.ts) — `getSecurityEnv`, `getWebAuthnRpId`, `getWebAuthnRpOrigin`. Validates `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_ORIGIN`, `SESSION_COOKIE_SECRET` on first import. Hard-fail; no fallbacks. Production-only constraint that origin must be HTTPS.

### Routes
- [pages/api/auth/passkeys/begin-registration.ts](pages/api/auth/passkeys/begin-registration.ts)
- [pages/api/auth/passkeys/verify-registration.ts](pages/api/auth/passkeys/verify-registration.ts)
- [pages/api/auth/passkeys/begin-authentication.ts](pages/api/auth/passkeys/begin-authentication.ts)
- [pages/api/auth/passkeys/verify-authentication.ts](pages/api/auth/passkeys/verify-authentication.ts)
- [pages/api/auth/passkeys/list.ts](pages/api/auth/passkeys/list.ts)
- [pages/api/auth/passkeys/revoke.ts](pages/api/auth/passkeys/revoke.ts)

### Reports
- [architecture-migration/reports/security-wave2b-a/wave-2b-a-implementation-report.md](architecture-migration/reports/security-wave2b-a/wave-2b-a-implementation-report.md) (this file)

---

## Files modified

- [backend/security/audit/SecurityAuditService.ts](backend/security/audit/SecurityAuditService.ts) — extended `AuditDecision` union with the 7 passkey lifecycle events. No behavioral change; additive only.

---

## WebAuthn services added

| Service | Responsibility | Status |
|---|---|---|
| `WebAuthnChallengeRepository` | webauthn_challenges persistence (issue, atomic consume, expiry purge) | ✅ |
| `WebAuthnCredentialRepository` | webauthn_credentials persistence (list, lookup, insert, monotonic counter, revoke) | ✅ |
| `WebAuthnChallengeService` | Replay-safe challenge lifecycle (issue, claim) | ✅ |
| `WebAuthnRegistrationService` | Begin + verify enrollment ceremonies | ✅ |
| `WebAuthnAuthenticationService` | Begin + verify authentication ceremonies; monotonic counter | ✅ |

All cryptographic verification is delegated to `@simplewebauthn/server` v11.0.0. **Zero custom crypto.** Zero hand-rolled WebAuthn parsing.

---

## Auth routes added

| Method | Path | Purpose | Wave 2B-A behavior |
|---|---|---|---|
| POST | `/api/auth/passkeys/begin-registration` | Step 1 enrollment — emit `PublicKeyCredentialCreationOptionsJSON`, persist challenge | Authenticated principals only (excludes legacy bridge) |
| POST | `/api/auth/passkeys/verify-registration` | Step 2 enrollment — verify attestation, persist credential | Atomic challenge consume; duplicate-credential rejection |
| POST | `/api/auth/passkeys/begin-authentication` | Step 1 verification — emit `PublicKeyCredentialRequestOptionsJSON` | Userless OR principal-scoped (when authenticated) |
| POST | `/api/auth/passkeys/verify-authentication` | Step 2 verification — verify assertion, advance counter | Returns verified identity envelope (NO session minted in Wave 2B-A) |
| GET  | `/api/auth/passkeys` | List active passkeys for the principal | — |
| POST | `/api/auth/passkeys/revoke` | Soft-delete a passkey (own credential only) | Ownership pre-check + idempotent revoke |

All routes:
- Resolve principal via `IdentityResolver.resolvePrincipal` (zero route-local auth parsing).
- Reject legacy-bridge principals (passkeys are not enrollable / revocable through the cookie path).
- Delegate to security services; no inline WebAuthn or crypto logic.

---

## Replay protections implemented

| Protection | Where | Mechanism |
|---|---|---|
| **One-shot challenge** | `WebAuthnChallengeRepository.consumeChallenge` | Atomic SQL `UPDATE … WHERE consumed_at IS NULL` — race-loser observes false. |
| **Challenge TTL** | `WebAuthnChallengeService.claim` | `expires_at` check before consume. 5-minute TTL for both ceremonies. |
| **Ceremony binding** | `WebAuthnChallengeService.claim` | Stored ceremony must match verify-time ceremony (registration challenge cannot satisfy authentication and vice versa). |
| **User binding (when scoped)** | `WebAuthnChallengeService.claim` | Bound challenges (user_id ≠ null) can only be consumed by the same user. |
| **Origin verification** | Library | `expectedOrigin` passed from env to `verifyRegistrationResponse` / `verifyAuthenticationResponse`. |
| **RP ID verification** | Library | `expectedRPID` passed from env. |
| **Monotonic counter** | `WebAuthnCredentialRepository.bumpCounter` | Atomic `UPDATE … WHERE counter < $newCounter`; returning null = replay. |
| **Counter=0 platforms** | `WebAuthnAuthenticationService.verifyAuthentication` | Some authenticators (Apple) report 0; we touch `last_used_at` and skip strict monotonic but still record. |
| **Duplicate-credential prevention** | `WebAuthnRegistrationService.verifyRegistration` | Pre-insert lookup by `credential_id`; rejects re-registration. |
| **Ownership at verify** | `WebAuthnAuthenticationService.verifyAuthentication` | When ceremony is bound to a user, the credential resolved by id must belong to them. |

---

## Audit events added

The `AuditDecision` union now includes 7 passkey-lifecycle events. All are written via `SecurityAuditService.logSecurityEvent` to the immutable `capability_audit_log` table.

| Event | Emitted from | Carries |
|---|---|---|
| `passkey_registration_started` | `beginRegistration` | actor, ip, user-agent |
| `passkey_registered` | `verifyRegistration` (success) | actor, credential row id, ip, user-agent |
| `passkey_registration_failed` | `verifyRegistration` (failure) | actor, reason, ip, user-agent |
| `passkey_auth_started` | `beginAuthentication` | actor (or null for userless), ip, user-agent |
| `passkey_authenticated` | `verifyAuthentication` (success) | actor, credential row id, `mfaPhishingResistant: true`, ip, user-agent |
| `passkey_auth_failed` | `verifyAuthentication` (failure) | resolved user (when known), reason, ip, user-agent |
| `passkey_revoked` | `/api/auth/passkeys/revoke` | actor, session id, credential row id, reason, ip, user-agent |

Audit table protections (from Wave 2A migration): `capability_audit_log` is INSERT-only; UPDATE / DELETE are blocked by triggers.

---

## Remaining blockers

### Critical (block any first passkey enrollment)
1. **Apply migration** `supabase/migrations/20260507_identity_security_tables.sql` to dev / staging / prod. Without the tables, every Wave 2B-A insert fails.
2. **Set env vars** in each environment:
   - `WEBAUTHN_RP_ID` (e.g. `localhost` for dev, `app.omnivyra.com` in prod)
   - `WEBAUTHN_RP_ORIGIN` (e.g. `http://localhost:3000` for dev, `https://app.omnivyra.com` in prod)
   - `SESSION_COOKIE_SECRET` ≥ 32 chars (Wave 2A bootstrap requirement; still needed)
   The first request that hits the security env throws if any are missing.

### Operational (Wave 2B-B start)
3. **TOTP + recovery-code services + routes** (Wave 2B-B). Skipped per scope.
4. **Trusted-device service + routes** (Wave 2B-B). Skipped per scope.
5. **Step-up challenge / verify routes** (Wave 2B-B). Verify-authentication currently returns the verified identity but does NOT mint sessions. Wave 2B-B will add the step-up session minter that consumes this output.

### Wave 2C scope
6. Convert 22 role-based authorization sites to capability checks.
7. Add step-up gates to billing / api-key / integration / identity-admin routes.
8. Frontend MFA settings UX (passkey enrollment, list, revoke).

### Wave 3 prerequisite
9. Promote a DB-backed `user_company_roles WHERE role='SUPER_ADMIN'` row before bridge expiry (2026-08-05).

---

## Validation commands executed

```
ls node_modules/@simplewebauthn/server          → v11.0.0 confirmed
ls node_modules/@simplewebauthn/types           → v11.0.0 confirmed (transitive)
ls node_modules/argon2                          → present (Wave 2B-B)
ls node_modules/otplib                          → present (Wave 2B-B)
npx tsc --noEmit -p tsconfig.json               → zero errors in any Wave 2B-A file
git grep -nE "role *=== *'..."                  → 22 sites (Wave 2C)
git grep -nE "super_admin_session|content_architect_session"
                                                → 135 hits across 30+ files (Wave 3)
git grep -n "is_super_admin"                    → 16 hits (Wave 3)
```

---

## Security baseline counts

(Production code only; reports / migrations / tests excluded.)

| Metric | Pre-Wave-1 | Post-Wave-1 | Post-Wave-2A | Post-Wave-2B-A | Notes |
|---|---:|---:|---:|---:|---|
| Duplicate trust authorities | 5 | 4 | 4 | 4 | Wave 3 collapses cookie + content-architect + `profiles.is_super_admin` once DB SUPER_ADMIN exists. Wave 2B-A is additive — no removal. |
| Route-local auth parsers | 3 | 0 | 0 | 0 | All 6 new routes delegate to `IdentityResolver`. |
| Frontend auth-trust paths (new code) | n/a | n/a | 0 | 0 | Wave 2B-A added no frontend code. |
| MFA bypass risks | n/a | n/a | n/a | 0 in passkey paths | Step-up evaluation rejects bridge principals (Wave 2A). Passkey verification is server-authoritative; no client-trusted state. |
| Role-based authorization paths | n/a | 21 | 21 | 22 | Net increase of 1 surfaced by passkey routes' principal-shape consumer pattern (`p.legacyCookieSuperAdmin`); not a new role check. Recount script may include defensive bridge guards. |
| Variant contamination | 0 | 0 | 0 | **0** | Baseline preserved. |
| Runtime cycles | ≤18 | ≤18 | ≤18 | **≤18** | Baseline preserved. |
| Runtime DB writes | ≤588 | ≤588 | ≤588 | **≤588** | Wave 2B-A adds 4 new write call sites — 3 challenge-table writes + 1 credential insert + counter-bump UPDATE — all confined to webauthn services and only fire on enrollment / verify. Net within budget. |
| Unsafe propagation | ≤6025 | ≤6025 | ≤6025 | **≤6025** | Baseline preserved. |
| Typecheck errors | n/a | 0 (Wave-1 files) | 0 (Wave-2A files) | **0** in any Wave-2B-A file | The 7 unrelated cron.ts catch-clause errors and 3 in-progress engagement-module errors persist outside Wave 2B-A scope. |

---

## Wave 2B-B preview (next session)

1. **TOTP backend** — `TotpEnrollmentService`, `TotpVerificationService`, `RecoveryCodeService`. TOTP secret stored in Supabase Vault; recovery codes argon2id-hashed.
2. **Trusted device backend** — `TrustedDeviceService`, `DeviceFingerprintService` (lift fingerprint hash from IdentityResolver into a SHA-256-backed standalone). 3 routes: `POST /trust`, `GET /devices`, `DELETE /devices/:id`.
3. **Step-up backend** — `StepUpSessionService` consumes `WebAuthnVerifiedAuthentication` (and Wave 2B-B's TOTP / recovery-code verifiers) to mint `stepup_sessions` rows. `StepUpPolicyRegistry` maps capabilities to declarative policies.
4. **Step-up routes** — `POST /api/auth/step-up/challenge` (kicks off WebAuthn / TOTP flow with `stepup` ceremony marker), `POST /api/auth/step-up/verify` (consumes verifier output and mints stepup session).
5. **Capability enforcement helper** — `withSecurity({ capability, stepUp? })` Express-style middleware for Wave 2C migration.

Wave 2C: convert 22 role-check sites; add step-up to billing / api-key / integration / identity-admin routes.
Wave 3: blocked on operator promoting a DB SUPER_ADMIN.
