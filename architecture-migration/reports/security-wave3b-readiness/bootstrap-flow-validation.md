# Wave 3B Readiness — Bootstrap Flow Validation

**Generated**: 2026-05-07
**Method**: source-grounded validation. End-to-end runtime testing requires operator action (no SUPER_ADMIN exists, no passkey enrolled, no live HTTP exercised). This report verifies the wiring; the operator confirms the runtime.

---

## 1. Bootstrap-super-admin route

[pages/api/admin/bootstrap-super-admin.ts](../../../pages/api/admin/bootstrap-super-admin.ts)

### Mode = `promote` (existing SUPER_ADMIN promotes another user)

Wiring:
1. `requireCapability(req, res, { capability: IDENTITY_ADMIN_ASSIGN, … })` ([pages/api/admin/bootstrap-super-admin.ts:78](../../../pages/api/admin/bootstrap-super-admin.ts))
   - Resolves principal via `IdentityResolver` (Bearer/cookie + DB)
   - Evaluates capability against the principal's set
   - Evaluates step-up policy `getStepUpPolicy(IDENTITY_ADMIN_ASSIGN)` → phishing-resistant + trusted-device, 10-min TTL
   - Bridge principal cannot satisfy step-up (rejected with `BRIDGE_PRINCIPAL_INELIGIBLE`)
   - Emits `elevated_route_accessed` audit on success or `capability_check_failed` on denial
2. On success, calls `assignSuperAdmin(targetUserId, organizationId)`:
   - Resolves org binding: override → `users.active_company_id` → most-recent role row → reject (412)
   - Idempotent: existing SUPER_ADMIN active row → returns same `roleRowId`
   - Otherwise UPSERT against `user_company_roles` with `status='active'`, `deactivated_at=null` (Wave 3A patch — schema-correct as of this readiness check)
3. Emits `super_admin_bootstrap_completed` audit row

### Mode = `bootstrap` (token-gated single-use self-promote)

Wiring (in order — every check is hard-fail and audited):
1. `bootstrapToken` body field present → 400 if missing
2. `process.env.SUPER_ADMIN_BOOTSTRAP_TOKEN` set + ≥32 chars → 503 `BOOTSTRAP_NOT_CONFIGURED` if not
3. Constant-time compare (`timingSafeEqual` over UTF-8 bytes) → 401 `BOOTSTRAP_TOKEN_INVALID` if mismatch
4. `SELECT count(*) FROM user_company_roles WHERE role='SUPER_ADMIN' AND status='active'` → 409 `BOOTSTRAP_ALREADY_CONSUMED` if any
5. `resolvePrincipal(req)` → 401 if unauthenticated
6. `principal.legacyCookieSuperAdmin === true` → 403 `BRIDGE_FACTOR_INSUFFICIENT` (bridge cannot self-promote)
7. `principal.sessionId` null → 409 `NO_AUTH_SESSION`
8. `principal.mfa.factors.includes('webauthn')` false → 412 `PASSKEY_REQUIRED`
9. `getStepUpPolicy(IDENTITY_ADMIN_ASSIGN)` returns null → 500 (policy not registered — should not happen; sanity check)
10. `evaluateStepUp(principal, policy).satisfied !== true` → 401 `STEP_UP_REQUIRED`
11. `assignSuperAdmin(p.userId, organizationId)` — same path as `promote` mode
12. Emit `super_admin_bootstrap_completed` audit; warn if `SUPER_ADMIN_BOOTSTRAP_TOKEN` still set

Every failure path emits `super_admin_bootstrap_denied` with a precise `reason` field — auditable for operator forensics.

### Wave 3A schema-patch verification

[pages/api/admin/bootstrap-super-admin.ts:131-132](../../../pages/api/admin/bootstrap-super-admin.ts) and [276-298](../../../pages/api/admin/bootstrap-super-admin.ts) now use `status='active'` + `deactivated_at` (the actual `user_company_roles` schema) instead of the non-existent `revoked_at` column. `grep -n 'revoked_at' pages/api/admin/bootstrap-super-admin.ts` returns only documentation comments. ✅

Typecheck after patch: `npx tsc --noEmit -p tsconfig.json` → exit 0. ✅

---

## 2. Passkey enrollment flow

| Step | Route | Service | Notes |
|---|---|---|---|
| Begin registration | [pages/api/auth/passkeys/begin-registration.ts](../../../pages/api/auth/passkeys/begin-registration.ts) | [backend/security/webauthn/WebAuthnRegistrationService.ts:57](../../../backend/security/webauthn/WebAuthnRegistrationService.ts) → `generateRegistrationOptions` from `@simplewebauthn/server` | Uses `getWebAuthnRpId()` + `getWebAuthnRpOrigin()` (env-validated). Issues `webauthn_challenges` row. |
| Verify registration | [pages/api/auth/passkeys/verify-registration.ts](../../../pages/api/auth/passkeys/verify-registration.ts) | [WebAuthnRegistrationService.ts:127-148](../../../backend/security/webauthn/WebAuthnRegistrationService.ts) → `verifyRegistrationResponse` | Atomic single-flight challenge consume via `consumeChallenge`; on verified=true inserts into `webauthn_credentials` (CASCADE on `users.id`). |

Flow gates:
- Challenge expires_at enforced
- Single-flight consume (race-loser sees verified=false)
- RP id + origin must match env-validated values
- User must have an authenticated principal (route gates with `resolvePrincipal`)

Bridge principals cannot enroll: `principal.userId` is the sentinel `'legacy:cookie-super-admin'` which is not a UUID, FK insert fails. ✅

---

## 3. Phishing-resistant step-up flow

| Step | Route | Service | Notes |
|---|---|---|---|
| Status | [pages/api/auth/step-up/status.ts](../../../pages/api/auth/step-up/status.ts) | [StepUpSessionService.ts:119](../../../backend/security/stepup/StepUpSessionService.ts) → `getActiveStatus` | Returns `{ active, expiresAt, factor }` for the principal. |
| Verify (passkey path) | [pages/api/auth/step-up/verify.ts](../../../pages/api/auth/step-up/verify.ts) | `WebAuthnAuthenticationService.verifyAuthenticationResponse` → `mint({ userId, authSessionId, factor: 'webauthn', maxAgeSeconds })` | On verified=true, inserts into `stepup_sessions` bound to `auth_sessions.id` via FK CASCADE. Emits `passkey_verified` + `stepup_session_created`. |

Step-up policy resolution:
- `getStepUpPolicy(capability)` → `StepUpRequirement` or null
- For `IDENTITY_ADMIN_ASSIGN` → `{ phishingResistantOnly: true, trustedDeviceRequired: true, maxAgeSeconds: 600 }`
- `evaluateStepUp(principal, requirement)` → `{ satisfied, reason }` (Wave 2A)
- Bridge principal: rejected with `BRIDGE_PRINCIPAL_INELIGIBLE` (cannot satisfy step-up)

---

## 4. auth_sessions minting

| Trigger | Service | Notes |
|---|---|---|
| `pages/api/auth/sync-supabase-user.ts` | `ensureSessionForUser` from [SessionAuthorityService.ts:281](../../../backend/security/SessionAuthorityService.ts) | Mints `auth_sessions` row + sets HMAC-SHA256-signed `omnivyra_session` cookie. Best-effort: returns `{sessionId: null, minted: false}` on errors so existing Bearer-token auth continues working until first cookie mint. |

Cookie shape: `<sessionId>.<signature>`; signature = `HMAC-SHA256(SESSION_COOKIE_SECRET, "${sessionId}|${createdAtIso}")` base64url. ✅

`SameSite=Lax`, `HttpOnly`, `Secure` (in prod). ✅

---

## 5. End-to-end runtime status (queried from DB)

| Metric | Value | Implication |
|---|---|---|
| Active SUPER_ADMIN rows | **0** | bootstrap NOT yet executed |
| Distinct SUPER_ADMIN users | **0** | same |
| Active passkeys (any user) | **0** | no enrollment yet |
| Active passkeys (SUPER_ADMIN) | **0** | (vacuously true) |
| Active auth_sessions | **0** | no operator login yet |
| Active phishing-resistant step-ups | **0** | no step-up performed yet |
| Audit log rows total | **1** | the readiness probe row only |
| `super_admin_bootstrap_completed` events | **0** | bootstrap NOT run |
| `bridge_authority_rejected` events | **0** | dry-run NOT enabled |
| Lifetime `via_legacy_bridge=true` events | **0** | bridge has never granted authority since the audit table was created |

---

## Verdict — bootstrap flow

**SOURCE-WIRED ✅; RUNTIME-UNEXERCISED ❌**.

The route, services, and migrations are all correctly wired. Without operator action — sign up the operator user, enroll a passkey, complete a phishing-resistant step-up, set the bootstrap token, call `/api/admin/bootstrap-super-admin` — Wave 3B remains blocked.

Operator runbook (verbatim from Wave 3A implementation report):
1. Sign up a normal Supabase user account.
2. Enroll a passkey at `/settings/security`.
3. Set `SUPER_ADMIN_BOOTSTRAP_TOKEN="$(openssl rand -hex 32)"` in env.
4. Complete a phishing-resistant step-up via `/api/auth/step-up/verify` (passkey factor).
5. `curl -X POST $ORIGIN/api/admin/bootstrap-super-admin -d '{"mode":"bootstrap","bootstrapToken":"<env>"}'`
6. Unset `SUPER_ADMIN_BOOTSTRAP_TOKEN`.
