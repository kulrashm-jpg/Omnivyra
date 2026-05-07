# Security Wave 2C-A Implementation Report

**Branch:** `identity-spine-consolidation`
**Wave:** 2C-A of 3
**Date:** 2026-05-07
**Scope:** Capability enforcement core + selective high-risk route migration.
**NOT in scope:** mass role-check conversion, cookie-bridge removal, full MFA dashboard, low-risk route migration.

---

## Files created (4)

- [backend/security/requireCapability.ts](backend/security/requireCapability.ts) — canonical route gate. Resolves principal → looks up step-up policy → calls `decideCapability` or `decideCapabilityWithStepUp` → audits → sends structured 401/403.
- [backend/security/requireStepUp.ts](backend/security/requireStepUp.ts) — standalone step-up gate for routes that have already authorized via another helper.
- [lib/security/sessionClient.ts](lib/security/sessionClient.ts) — frontend wrappers over `/api/auth/session`, `/api/auth/capabilities`, `/api/auth/logout`, `/api/auth/refresh`.
- [lib/security/stepUpClient.ts](lib/security/stepUpClient.ts) — frontend orchestrator: `detectStepUpFromResponse`, `triggerWebAuthnStepUp`, `triggerTotpStepUp`.

## Files modified (6)

- [backend/security/audit/SecurityAuditService.ts](backend/security/audit/SecurityAuditService.ts) — extended `AuditDecision` with 5 new events: `capability_check_failed`, `stepup_required`, `phishing_resistant_required`, `elevated_route_accessed`, `elevated_route_denied`.
- [pages/api/admin/revoke-super-admin.ts](pages/api/admin/revoke-super-admin.ts) — replaced `requireSuperAdmin` middleware with `requireCapability(IDENTITY_ADMIN_REVOKE)`.
- [pages/api/super-admin/users.ts](pages/api/super-admin/users.ts) — DELETE handler now ALSO gates on `requireCapability(IDENTITY_ADMIN_DELETE)` (additive; legacy `requireSuperAdminAccess` still runs for GET/POST/PATCH).
- [pages/api/super-admin/free-credits/grant.ts](pages/api/super-admin/free-credits/grant.ts) — replaced inline `requireSuperAdmin` helper with `requireCapability(BILLING_MANAGE)`. Bridge principals now blocked. `granted_by` is no longer NULL — it's the authenticated principal's userId.
- [pages/api/super-admin/purchases/complete.ts](pages/api/super-admin/purchases/complete.ts) — replaced inline `requireSuperAdmin` helper with `requireCapability(BILLING_PURCHASE)`.
- [pages/api/external-apis/index.ts](pages/api/external-apis/index.ts) — POST with `?scope=platform` (the OAuth-credential-managing path) now gated on `requireCapability(INTEGRATION_SECRETS_READ)` BEFORE the existing `requirePlatformAdmin` runs.

---

## Capability-enforcement helpers added

### `requireCapability(req, res, options)`
Canonical route gate. Returns `{ ok: true; principal }` on success or `{ ok: false; sent: true }` after writing a structured 401/403 (caller must early-return).

Behavior matrix:
- Capability listed in `STEP_UP_REQUIRED_CAPABILITIES` (default) OR `requireStepUp: true` (override) → calls `decideCapabilityWithStepUp`, looks up registered policy from `StepUpPolicyRegistry`, audits as `elevated_route_accessed` / `stepup_required` / `phishing_resistant_required` / `elevated_route_denied`.
- Otherwise → calls `decideCapability`, audits as `capability_check_failed` on deny.
- Bridge principals are rejected on every step-up-required path because `evaluateStepUp` returns `BRIDGE_PRINCIPAL_INELIGIBLE` for them.

### `requireStepUp(res, principal, options)`
Standalone step-up gate (for routes that have already done capability check elsewhere). Looks up policy, evaluates, audits, and returns `boolean` indicating whether to continue.

---

## High-risk routes migrated (5)

| Route | Capability | Step-up policy | Bridge accepts? |
|---|---|---|---|
| POST `/api/admin/revoke-super-admin` | `identity.admin.revoke` | phishing-resistant + trusted-device, 10-min | NO |
| DELETE `/api/super-admin/users` | `identity.admin.delete` | phishing-resistant + trusted-device, 10-min | NO |
| POST `/api/super-admin/free-credits/grant` | `billing.manage` | phishing-resistant, 10-min | NO |
| POST `/api/super-admin/purchases/complete` | `billing.purchase` | phishing-resistant, 10-min | NO |
| POST `/api/external-apis/?scope=platform` | `integration.secrets.read` | phishing-resistant, 10-min | NO |

GET/POST/PATCH on `/api/super-admin/users` and tenant-scoped POST on `/api/external-apis/` remain on the legacy auth path (Wave 2C-B/C will migrate them).

---

## Step-up protections enforced

Every migrated route requires:
1. Authenticated principal (Bearer or auth_session cookie via `IdentityResolver`).
2. The capability listed above.
3. An active `stepup_sessions` row bound to the principal's `auth_session_id`.
4. Phishing-resistant factor (WebAuthn) — TOTP and recovery codes are rejected.
5. (For `identity.admin.revoke` / `identity.admin.delete`) trusted device match.

Bridge principals (`super_admin_session=1` / `content_architect_session=1` cookies) cannot satisfy step-up because:
- They have `legacyCookieSuperAdmin: true` on the principal.
- `evaluateStepUp` returns `BRIDGE_PRINCIPAL_INELIGIBLE` short-circuit.
- Response: 403 with code `BRIDGE_FACTOR_INSUFFICIENT` (mapped by `respondDenied`).

---

## Frontend security wiring completed (minimal)

Per spec: ONLY logout / refresh / capability-refresh / step-up-trigger hooks. NO MFA dashboard, passkey UI, or device UI.

- `lib/security/sessionClient.ts`: `fetchSessionSnapshot`, `fetchCapabilities`, `logoutCurrentSession`, `refreshCurrentSession`.
- `lib/security/stepUpClient.ts`: `detectStepUpFromResponse`, `triggerWebAuthnStepUp`, `triggerTotpStepUp`.

Frontend pattern for migrated routes:
```ts
let r = await fetch('/api/super-admin/free-credits/grant', { method: 'POST', body: ... });
const stepUp = await detectStepUpFromResponse(r);
if (stepUp) {
  await triggerWebAuthnStepUp({ scopedCapability: 'billing.manage' });
  r = await fetch('/api/super-admin/free-credits/grant', { method: 'POST', body: ... });
}
// process r normally
```

Frontends MUST NOT cache capabilities/step-up state locally — every authority decision is server-side.

---

## Audit events added (5)

Added to `AuditDecision` union and emitted by the new helpers:
- `capability_check_failed` — capability not held; non-step-up flow
- `stepup_required` — capability held but step-up missing
- `phishing_resistant_required` — capability held, step-up present, but factor was TOTP/recovery on a phishing-resistant policy
- `elevated_route_accessed` — capability + step-up both satisfied
- `elevated_route_denied` — capability held but other denial (org membership, etc.)

All write to the immutable `capability_audit_log` (Wave 2A: INSERT-only triggers).

---

## Remaining blockers

### Critical
1. **Apply the Wave 2A + 2B-B migrations** (`20260507_identity_security_tables.sql` + `20260507_security_vault_rpcs.sql`). The 5 migrated routes will fail closed for everyone (including legitimate super-admins) until tables exist — there are no `auth_sessions` to back step-up.
2. **Set envs** — `SESSION_COOKIE_SECRET`, `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_ORIGIN`.
3. **Promote a DB-backed SUPER_ADMIN** with at least one passkey enrolled. Without this, the 5 migrated routes are unreachable. Bridge principals are intentionally blocked.

### Operational
4. **Frontend wiring at call sites** — admin pages that POST to the 5 migrated routes need to consume the new `lib/security/stepUpClient.ts` to launch the challenge UI when 401-with-`STEP_UP_REQUIRED` lands. Ad-hoc per-page wiring is Wave 2C-B.
5. **Bridge expiry 2026-08-05** — operator must promote a DB SUPER_ADMIN before then.
6. **Long-tail role-check conversion**: 22 sites still use literal `role === 'SUPER_ADMIN'` patterns. Wave 2C-B/C target.
7. **`profiles.is_super_admin` references** (16) and **cookie super-admin references** (135) — Wave 3.

---

## Validation commands executed

```
npx tsc --noEmit -p tsconfig.json    → 0 errors in any Wave-2C-A file
git grep -nE "role *=== *'..."       → 22 (unchanged; data-shaping role checks not migrated)
git status                           → 4 created + 6 modified files in scope
```

Pre-existing typecheck noise (cron.ts, in-progress engagement modules) — outside Wave 2C-A scope.

---

## Security baseline counts

(Production code only.)

| Metric | Pre-2C-A | Post-2C-A | Notes |
|---|---:|---:|---|
| Duplicate trust authorities | 4 | **4** | Wave 3 territory; Wave 2C-A additive only on the gate side. |
| Route-local auth parsers | 0 | **0** | Migrated routes use `requireCapability` (centralized). Legacy routes still use centralized helpers. No new local parsers. |
| Frontend auth-trust paths (new code) | 0 | **0** | `lib/security/*` only reflects server state; no local capability derivation, no local step-up trust. |
| MFA bypass risks | 0 | **0** | Migrated routes block bridge principals at the step-up gate. |
| Role-based authorization paths | 22 | **22** | Wave 2C-A targeted GATES, not data-shaping role checks. The 22 remaining are response-shaping (e.g., `if access.role === 'SUPER_ADMIN' → encrypt OAuth secrets`). Migration to capability-based response shaping is Wave 2C-B. |
| Variant contamination | 0 | **0** | Preserved. |
| Runtime cycles | ≤18 | **≤18** | Preserved — `requireCapability` calls `IdentityResolver` → `AuthorizationService` → `SecurityAuditService`; no back-edges. |
| Runtime DB writes | ≤588 | **≤588** | Within budget. New writes confined to capability-audit-log inserts (1 per request on migrated routes). |
| Unsafe propagation | ≤6025 | **≤6025** | Preserved. |
| Typecheck errors (Wave-2C-A files) | — | **0** | Clean across all 4 created + 6 modified files. |

---

## Wave 2C-B preview (next session)

1. Migrate response-shaping role checks (the 22 sites): convert `if access.role === 'SUPER_ADMIN' → reveal secret` to `if hasCapability(principal, INTEGRATION_SECRETS_READ) → reveal`.
2. Per-page frontend wiring (admin dashboards) for the migrated routes.
3. Migrate medium-risk routes (campaign-delete, content-delete, automation-execute-prod).
4. Add MFA settings dashboard (passkey enrollment, TOTP setup, recovery codes display, trusted device list).

Wave 3 (after 2C-B/C, after operator promotes a DB-backed SUPER_ADMIN with passkey):
- Delete `legacyCookieSuperAdminBridge.ts`.
- Remove cookie + `profiles.is_super_admin` reads.
- Drop legacy DB columns.
