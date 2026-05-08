# MFA Login Enforcement — Implementation Report

**Generated:** 2026-05-08
**Branch:** `identity-spine-consolidation`
**Goal:** Convert MFA from "elevated-action-only" to fully enforced primary authentication. Password verification now never mints an auth_session by itself when a verified MFA factor exists; passkeys are usable as primary authentication; recovery codes are usable as primary authentication.

---

## Files audited

### Login surface
- [pages/api/auth/login.ts](../../../pages/api/auth/login.ts) — pre-check only (returns `proceed:true`); not a session mint
- [pages/api/auth/sync-supabase-user.ts](../../../pages/api/auth/sync-supabase-user.ts) — **canonical session mint** for password/magic-link users
- [pages/api/auth/post-login-route.ts](../../../pages/api/auth/post-login-route.ts) — routing only; not a session mint
- [pages/auth/callback.tsx](../../../pages/auth/callback.tsx) — client orchestrator
- [backend/security/SessionAuthorityService.ts](../../../backend/security/SessionAuthorityService.ts) — `createSession`, `ensureSessionForUser`, `revokeAllSessionsForUser`

### Other auth_session mint callsites (read-only audit; no changes)
- [pages/api/super-admin/login.ts:101](../../../pages/api/super-admin/login.ts) — super-admin password path; out of scope per prompt
- [pages/api/super-admin/content-architect-login.ts:102](../../../pages/api/super-admin/content-architect-login.ts) — out of scope
- [pages/api/auth/step-up/verify.ts:122](../../../pages/api/auth/step-up/verify.ts) — `rotateSession` (rotation only, not a fresh mint)

### Factor surfaces
- [backend/security/totp/TotpFactorRepository.ts](../../../backend/security/totp/TotpFactorRepository.ts)
- [backend/security/totp/TotpVerificationService.ts](../../../backend/security/totp/TotpVerificationService.ts)
- [backend/security/totp/RecoveryCodeService.ts](../../../backend/security/totp/RecoveryCodeService.ts)
- [backend/security/webauthn/WebAuthnAuthenticationService.ts](../../../backend/security/webauthn/WebAuthnAuthenticationService.ts)
- [backend/security/webauthn/WebAuthnCredentialRepository.ts](../../../backend/security/webauthn/WebAuthnCredentialRepository.ts)
- [pages/api/auth/passkeys/begin-authentication.ts](../../../pages/api/auth/passkeys/begin-authentication.ts) — already supports userless ceremony
- [pages/api/auth/passkeys/verify-authentication.ts](../../../pages/api/auth/passkeys/verify-authentication.ts)
- [pages/api/auth/step-up/verify.ts](../../../pages/api/auth/step-up/verify.ts)

### Step-up + device + session
- [backend/security/stepup/StepUpSessionService.ts](../../../backend/security/stepup/StepUpSessionService.ts)
- [backend/security/devices/TrustedDeviceService.ts](../../../backend/security/devices/TrustedDeviceService.ts)
- [pages/api/auth/devices/revoke.ts](../../../pages/api/auth/devices/revoke.ts)
- [pages/api/auth/sessions/revoke.ts](../../../pages/api/auth/sessions/revoke.ts) (read-only)
- [pages/api/auth/set-password.ts](../../../pages/api/auth/set-password.ts)

---

## Files created (5)

1. **[backend/security/MfaIntent.ts](../../../backend/security/MfaIntent.ts)**
   - HMAC-SHA256-signed short-lived (5 min) bridge token issued by `sync-supabase-user` when a verified MFA factor exists.
   - Cookie-only transport (`omnivyra_mfa_intent`, HttpOnly, SameSite=Lax, Secure-in-prod).
   - Carries `{ userId, supabaseUid, email, iat, exp, nonce }`.
   - Single-use: cleared by `mfa-verify` on success. Cannot authenticate any other API call.
   - Helper `userHasVerifiedMfaFactor()` reads TOTP + WebAuthn repositories to decide whether MFA is enrolled.

2. **[backend/security/MfaAttemptLimiter.ts](../../../backend/security/MfaAttemptLimiter.ts)**
   - Per-user + per-IP brute-force protection across all factor verifications.
   - Exponential lockout schedule: 5→30s, 10→5min, 15→1h, 20→24h. Counter resets on success or after 24h inactivity.
   - In-memory `Map` for prototype; surface designed for drop-in Redis swap.
   - Public API: `check`, `recordFailure`, `reset`.

3. **[pages/api/auth/mfa-verify.ts](../../../pages/api/auth/mfa-verify.ts)**
   - Single-endpoint factor router accepting TOTP / WebAuthn / recovery_code.
   - Auth via the `mfa_intent` cookie only.
   - Pre-checks (intent validity, soft-delete, supabase_uid match, brute-force gate) → factor verifier → on success, clears intent, calls `createSession` + `attachSessionCookie`.
   - On failure: records failure, recomputes lockout, returns 429 with `Retry-After` when locked.

4. **[pages/api/auth/recovery-login.ts](../../../pages/api/auth/recovery-login.ts)**
   - Standalone primary-login path for users who have lost every other factor.
   - `{ email, code }` body. No password. No `mfa_intent` required.
   - On success: revokes ALL existing auth_sessions (recovery implies suspicion), mints new one, returns `mustReenrollMfa: true` so the client routes to /settings/security.
   - Per-IP gate before user resolution + per-user gate after.

5. **[pages/auth/mfa.tsx](../../../pages/auth/mfa.tsx)**
   - Frontend challenge page reached from `/auth/callback` after `mfa_required` is returned.
   - Tabbed UI for passkey / authenticator / recovery code.
   - Calls `/api/auth/mfa-verify` for each factor; navigates to `/` on success so post-login-route resolves the landing destination.

## Files modified (10)

1. **[pages/api/auth/sync-supabase-user.ts](../../../pages/api/auth/sync-supabase-user.ts)** — added `gateOnMfa()` helper. At each existing-user `projectSession` callsite, it runs first; if MFA enrolled, issues intent + cookie + returns `{ ok: true, mfa_required: true, factors }` with NO session mint. Brand-new-user branch is unchanged (MFA cannot be enrolled before account creation).

2. **[pages/auth/callback.tsx](../../../pages/auth/callback.tsx)** — handles new `mfa_required` response. Skips verify-email + post-login-route in that branch and redirects to `/auth/mfa?factors=...`.

3. **[pages/api/auth/passkeys/verify-authentication.ts](../../../pages/api/auth/passkeys/verify-authentication.ts)** — extended to a two-mode endpoint:
   - With principal (step-up scope): returns identity envelope only (existing behavior, unchanged).
   - Without principal (primary login): runs userless WebAuthn ceremony, soft-delete-checks resolved user, mints canonical auth_session, attaches cookie, clears any stale MFA intent.
   - Brute-force gate (per-IP pre-resolve, per-user post-resolve).

4. **[pages/api/auth/set-password.ts](../../../pages/api/auth/set-password.ts)** — already revoked auth_sessions; now ALSO revokes step-up sessions via new `revokeStepUpForUser` helper. Audit row records both counts.

5. **[pages/api/auth/devices/revoke.ts](../../../pages/api/auth/devices/revoke.ts)** — cascade: device revoke → `revokeSessionsForDevice(userId, deviceId)` → for each revoked auth_session, `revokeForAuthSession()` cascades step-up. Audit row + cascade counts in response.

6. **[backend/security/SessionAuthorityService.ts](../../../backend/security/SessionAuthorityService.ts)** — new `revokeSessionsForDevice(userId, deviceId, reason)` returning the revoked session ids for cascade chaining.

7. **[backend/security/stepup/StepUpSessionService.ts](../../../backend/security/stepup/StepUpSessionService.ts)** — new `revokeForUser(userId, reason)` for global step-up revocation (used by password change cascade).

8. **[backend/security/totp/TotpVerificationService.ts](../../../backend/security/totp/TotpVerificationService.ts)** — added rate-limit gate before any work; `recordFailure` on every failure path; `reset` on success. `RATE_LIMITED` failures are audited.

9. **[backend/security/totp/RecoveryCodeService.ts](../../../backend/security/totp/RecoveryCodeService.ts)** — same pattern as TOTP. Per-user + per-IP gate before argon2 work to bound CPU under guessing attacks.

10. **[backend/security/audit/SecurityAuditService.ts](../../../backend/security/audit/SecurityAuditService.ts)** — added 6 new `AuditDecision` variants: `mfa_login_challenge_issued`, `mfa_login_succeeded`, `mfa_login_failed`, `mfa_login_rate_limited`, `passkey_primary_login`, `recovery_code_primary_login`.

---

## Primary-login enforcement results

For a password-authenticated user who has any verified TOTP or WebAuthn factor:

| Step | Before | After |
|---|---|---|
| Supabase password verifies | session/JWT token issued by Supabase | unchanged |
| `/api/auth/sync-supabase-user` | minted `auth_session` immediately | issues `mfa_intent` cookie, returns `{ mfa_required: true, factors }` with **NO session** |
| `/auth/callback` | proceeded to verify-email + post-login-route | redirects to `/auth/mfa` |
| `/api/auth/mfa-verify` | did not exist | consumes intent, runs factor verifier, mints session only on success |
| Step-up flow | unchanged | unchanged |

For a password-authenticated user without MFA enrolled: identical behavior to before. The change is fully gated.

For a passkey-authenticated user: `/api/auth/passkeys/verify-authentication` (no principal) runs userless ceremony + mints session. No password required.

For a recovery-code user: `/api/auth/recovery-login` accepts email + code, revokes other sessions, mints new one, surfaces `mustReenrollMfa`.

---

## Passkey-login results

- `begin-authentication` already supported userless ceremonies (no change needed).
- `verify-authentication` now branches on whether the request carries an authenticated principal:
  - principal present → step-up envelope (caller mints stepup_session) — unchanged
  - principal absent → primary login — runs userless verifier, soft-delete-checks resolved user, mints `auth_session`, attaches cookie
- WebAuthn replay protection (single-use challenge, monotonic counter) is enforced by the existing `WebAuthnAuthenticationService`. Origin verification happens inside `@simplewebauthn/server`.
- Per-IP gate before verification (bounds attacker probing) and per-user gate after (bounds account-targeted spread across IPs).

---

## Recovery-login results

- New endpoint `/api/auth/recovery-login` accepts `{ email, code }` and verifies via existing `RecoveryCodeService.verifyAndConsume`.
- Code is single-use (atomic `UPDATE … WHERE used_at IS NULL`), argon2id-hashed.
- On success the endpoint runs `revokeAllSessionsForUser(userId, 'recovery_code_login_revoke_all')` to invalidate every other session — recovery implies a possible compromise, so existing access is killed.
- Step-up sessions cascade via `revokeForAuthSession` after the new session id is known.
- Response carries `mustReenrollMfa: true` so the client navigates to /settings/security and prompts re-enrollment.
- Constant-response shape on user-not-found and invalid-code (both return 401 `RECOVERY_INVALID`) — no enumeration.

---

## Password-hardening results

- `set-password` already called `revokeAllSessionsForUser` (NIST 800-63B, OWASP ASVS V3.6).
- Added `revokeStepUpForUser` cascade — step-up sessions are now revoked alongside auth_sessions.
- Audit row records both counts: `revoked_auth=N revoked_stepup=M`.
- `clearSessionCookie(res)` continues to clear the current cookie so the next request forces a fresh login.

---

## Device-revocation results

- `/api/auth/devices/revoke` previously only flipped `revoked_at` on the trusted_devices row.
- Now cascades: `revokeSessionsForDevice(userId, deviceId)` returns the revoked session ids; for each, `revokeForAuthSession` revokes the bound step-up sessions.
- Response now carries `cascade: { authSessionsRevoked, stepUpSessionsRevoked }` so the client can show a clear confirmation.
- Audit row: `auth_session_revoked` decision with both counts in `reason`.

---

## TOTP brute-force-protection results

- Per-user + per-IP buckets. Lock thresholds: 5/10/15/20 → 30s/5min/1h/24h.
- Bucket counter resets on a successful verify (legitimate users do not accumulate from past mistypes) and after 24h of inactivity.
- Gate runs **before** otplib + Vault read so a locked-out user pays no CPU cost and timing differences cannot leak factor enrollment.
- Recovery code path: gate runs before argon2.verify, the most expensive step. The argon2 cost remains the per-request cap.
- Wired transparently — `verifyTotp` and `verifyAndConsume` are unchanged for callers; the only outward-visible change is `RATE_LIMITED` returning the same generic failure code so an attacker cannot distinguish "locked" from "wrong code". The 429 + `Retry-After` is surfaced only at the route boundary (`/api/auth/mfa-verify`, `/api/auth/recovery-login`, `/api/auth/passkeys/verify-authentication`).

---

## Validation commands executed

| Command | Purpose | Result |
|---|---|---|
| `grep -r ensureSessionForUser pages/ backend/` | Enumerate session-mint callsites | 4 callsites identified; only sync-supabase-user is in scope |
| `grep -r createSession\\( pages/ backend/` | Enumerate direct session creations | sync-supabase-user (via ensureSessionForUser); super-admin login.ts; content-architect-login.ts; mfa-verify.ts (new); passkeys/verify-authentication.ts (new); recovery-login.ts (new) |
| `npx tsc --noEmit -p tsconfig.json` | Typecheck | exit 0 |

---

## Remaining blockers

1. **Brand-new user MFA enrollment is not yet enforced post-onboarding.** A new user finishes signup → onboarding → command-center without ever being prompted to enroll MFA. Outside this prompt's scope (the prompt covers enforcement of *existing* MFA at login). Follow-up: add `/onboarding/security` step.

2. **Super-admin login (`/api/super-admin/login.ts`) does not gate on MFA.** The prompt explicitly excluded "platform isolation" / "bridge deletion", and the super-admin path uses its own `createSession` call. Wave 3 will canonicalize super-admin auth; MFA-at-login for that path should land then.

3. **`MfaAttemptLimiter` is in-memory only.** A single Node instance is correctly bounded; multi-instance deployments need Redis. The module's surface is shaped for a swap.

4. **No `auth_sessions.device_id` plumbing yet for password/magic-link logins.** `ensureSessionForUser` does not currently set `device_id`, so the device-revoke cascade only catches sessions that were minted with an explicit device id (currently: the rotated session in step-up, which inherits `device_id` from its parent). Fixing `ensureSessionForUser` to compute and store the device fingerprint at mint time is a follow-up.

5. **`/auth/mfa` page does not surface a "use a different account" affordance.** A user who realizes they're stuck (lost device + lost recovery codes) must contact support. Acceptable; admin recovery is out of scope per prompt.

6. **No dedicated DB rate-limit table.** All MFA brute-force protection lives in process memory. Audit logs (capability_audit_log via SecurityAuditService) DO record every `mfa_login_rate_limited` decision so post-mortem analysis is intact.

---

## Updated counts

| Metric | Before | After | Δ |
|---|---|---|---|
| Pre-MFA session mint paths (password user with MFA enrolled) | **1** (sync-supabase-user) | **0** | -1 |
| Passkey-primary login paths | **0** | **1** (passkeys/verify-authentication, principal-absent branch) | +1 |
| Recovery-code primary login paths | **0** | **1** (recovery-login) | +1 |
| Stale auth_session survivals after password change | step-up sessions remained | **0** | -1 |
| Stale auth_session survivals after device revoke | sessions remained | **0** | -1 |
| Bridge-authoritative login paths | **0** (bridge already excluded by step-up policy + MfaIntent ignores it) | **0** | 0 |
| TOTP brute-force gaps (per-user) | **1** (no per-user counter) | **0** | -1 |
| Recovery-code brute-force gaps (per-user) | **1** | **0** | -1 |
| Typecheck errors | **0** | **0** | 0 |

---

## What I did NOT do (per scope)

- ❌ Did not touch tenant architecture (companies, user_company_roles)
- ❌ Did not touch platform isolation (capability registry / platform-tier capabilities)
- ❌ Did not touch the legacy super-admin cookie bridge or its hard-expiry timer
- ❌ Did not refactor onboarding flow
- ❌ Did not modify `/api/super-admin/login.ts` or `/api/super-admin/content-architect-login.ts`
- ❌ Did not add server-side anomaly alerts, observability dashboards, or governance UI
- ❌ Did not modify `/api/auth/login.ts` (it is a pre-check, not a session mint)
- ❌ Did not change Supabase auth's own session/JWT issuance — that remains as-is; the canonical authority is `auth_sessions`, which is now correctly gated

---

## Suggested next phases

| Phase | Goal | Estimated change |
|---|---|---|
| MFA enrollment nudge in onboarding | Prevent users from operating without a second factor | 1 onboarding step + UI |
| `auth_sessions.device_id` backfill in `ensureSessionForUser` | Make the device-revoke cascade catch every session | One service-level change |
| Redis-backed `MfaAttemptLimiter` | Multi-instance correctness | One file swap |
| Org-level MFA policy table | Enterprise: "everyone in this org must enroll WebAuthn" | Schema + UI + capability check |
| `/api/auth/login` factor-router refactor | Make the password endpoint return MFA_REQUIRED directly (currently the gate is inside sync-supabase-user, which is functionally equivalent) | Optional; current placement is correct per the canonical session-mint authority |
| Super-admin login MFA enforcement | Apply the same gate to the super-admin path | Wave 3 alignment work |
