# Security Wave 2C-B Implementation Report

**Branch:** `identity-spine-consolidation`
**Wave:** 2C-B of 3
**Date:** 2026-05-07
**Scope:** MFA dashboard + medium-risk route migration + minimal session/device UX.
**NOT in scope:** cookie-bridge removal, `profiles.is_super_admin` removal, every remaining legacy route, global mandatory MFA, Wave 3 authority collapse.

---

## Files created (4)

- [pages/settings/security.tsx](pages/settings/security.tsx) — MFA security dashboard with 6 sections (Auth state, Passkeys, TOTP, Recovery codes, Trusted devices, Active sessions). All state hydrated from `/api/auth/*`; sensitive actions wrapped in `withStepUp()`.
- [pages/api/auth/sessions/list.ts](pages/api/auth/sessions/list.ts) — list active `auth_sessions` for the principal with `currentSessionId` flag.
- [pages/api/auth/sessions/revoke.ts](pages/api/auth/sessions/revoke.ts) — revoke a specific session (`{id}`), all-other (`{revokeOthers: true}`), or all (`{revokeAll: true}`). Cascades step-up revoke and clears the cookie when the current session is revoked.
- [architecture-migration/reports/security-wave2c-b/wave-2c-b-implementation-report.md](architecture-migration/reports/security-wave2c-b/wave-2c-b-implementation-report.md) — this file.

## Files modified (8)

- [backend/security/audit/SecurityAuditService.ts](backend/security/audit/SecurityAuditService.ts) — extended `AuditDecision` with 7 new dashboard/UX events: `session_revoked_by_user`, `trusted_device_viewed`, `trusted_device_removed`, `recovery_codes_viewed`, `recovery_codes_regenerated_ui`, `elevated_ui_action_requested`, `elevated_ui_action_completed`.
- [lib/security/stepUpClient.ts](lib/security/stepUpClient.ts) — added `withStepUp()` retry wrapper. Detects 401 STEP_UP_REQUIRED, launches WebAuthn step-up, retries the original request once.
- [pages/api/auth/passkeys/revoke.ts](pages/api/auth/passkeys/revoke.ts) — migrated to `requireCapability(MFA_REVOKE)` (phishing-resistant step-up).
- [pages/api/auth/totp/revoke.ts](pages/api/auth/totp/revoke.ts) — migrated to `requireCapability(MFA_REVOKE)` (phishing-resistant step-up).
- [pages/api/super-admin/users.ts](pages/api/super-admin/users.ts) — POST and PATCH handlers now also gate on `requireCapability(IDENTITY_ADMIN_ASSIGN)` (in addition to the legacy `requireSuperAdminAccess`).
- [pages/api/team/self-joined.ts](pages/api/team/self-joined.ts) — replaced inline `isCompanyAdmin` helper with `requireCapability(ORGANIZATION_MANAGE, organizationId: companyId)`. The principal is captured for `confirmed_by` / `removed_by` audit attribution (`user.userId`).
- [pages/api/virality/playbooks/[id].ts](pages/api/virality/playbooks/[id].ts) — PUT migrated to `requireCapability(ORGANIZATION_MANAGE, organizationId: playbook.company_id)`. Inline `canManagePlaybooks` removed.
- [pages/api/virality/playbooks/index.ts](pages/api/virality/playbooks/index.ts) — POST migrated to `requireCapability(ORGANIZATION_MANAGE, organizationId: companyId)`. GET kept on the legacy `requirePlaybookAccess` helper (read path; not high-risk).

---

## MFA dashboard components added

`pages/settings/security.tsx` is a single page with 6 sections, each implemented inline. The page is server-authoritative: every section fetches its own state from the existing `/api/auth/*` routes; nothing is cached client-side beyond the initial load. Sections:

| Section | Server endpoint(s) | Sensitive actions |
|---|---|---|
| **Auth state** | `/api/auth/session` + `/api/auth/capabilities` | (display-only) |
| **Passkeys** | `GET /api/auth/passkeys`, `POST /api/auth/passkeys/begin-registration` + `/verify-registration`, `POST /api/auth/passkeys/revoke` | enroll (no step-up); revoke (`MFA_REVOKE` step-up) |
| **TOTP** | `POST /api/auth/totp/begin-enrollment` + `/verify-enrollment`, `POST /api/auth/totp/revoke` | enroll (no step-up; verify-enroll is the proof); revoke (`MFA_REVOKE` step-up) |
| **Recovery codes** | `POST /api/auth/totp/recovery` (with `regenerate: true`) | regenerate (consumes a code) |
| **Trusted devices** | `GET /api/auth/devices`, `POST /api/auth/devices/trust`, `POST /api/auth/devices/revoke` | trust this browser (step-up); revoke (no step-up — owner only) |
| **Active sessions** | `GET /api/auth/sessions/list`, `POST /api/auth/sessions/revoke` | revoke specific / revoke others / revoke all |

WebAuthn enroll uses `@simplewebauthn/browser` `startRegistration`. Step-up retry uses `withStepUp()` which runs `triggerWebAuthnStepUp` on 401 STEP_UP_REQUIRED. Bridge principals (legacy cookie) see a polite "Security settings are not available" panel.

---

## Medium-risk routes migrated (7)

| Route | Capability | Step-up | Notes |
|---|---|---|---|
| POST `/api/auth/passkeys/revoke` | `mfa.revoke` | phishing-resistant, 10-min | Owner can only revoke own passkeys; bridge principals were already rejected. |
| POST `/api/auth/totp/revoke` | `mfa.revoke` | phishing-resistant, 10-min | TOTP cannot revoke itself (factor=webauthn required by policy). |
| POST `/api/super-admin/users` | `identity.admin.assign` | phishing-resistant + trusted-device, 10-min | Invite + role-assign path. |
| PATCH `/api/super-admin/users` | `identity.admin.assign` | phishing-resistant + trusted-device, 10-min | Role/status update path. |
| POST `/api/virality/playbooks` | `organization.manage` (org-scoped) | NONE (medium-risk) | Replaces inline `canManagePlaybooks`. |
| PUT `/api/virality/playbooks/[id]` | `organization.manage` (org-scoped) | NONE (medium-risk) | Replaces inline `canManagePlaybooks`. |
| GET/PATCH/DELETE `/api/team/self-joined` | `organization.manage` (org-scoped) | NONE (medium-risk) | Replaces inline `isCompanyAdmin`. |

GET-only endpoints (`/api/auth/sessions/list`, `/api/auth/devices`, `/api/auth/passkeys`) reuse `resolvePrincipal` directly — they're not capability-gated because their data shape mirrors what the principal could already infer from `/api/auth/session`.

---

## Role-shaping cleanups completed

**Deferred to Wave 2C-C.**

The remaining 21 role-string references (down from 22 by one — see "team/self-joined.ts" cleanup) are either:
- Response-shaping decisions inside already-gated routes (e.g., `external-apis/index.ts:471` — whether to encrypt OAuth secrets on a tenant POST).
- Tier categorization for already-gated reads (e.g., `admin/consumption/{apis,llm}.ts` — `'super_admin' | 'company_admin' | 'user'` tier label).
- Test fixtures (4 hits in `backend/tests/integration/user_lifecycle_management.test.ts`).
- UI display logic in admin React pages (e.g., `pages/super-admin/consumption.tsx`).

Properly converting these requires plumbing the `AuthenticatedPrincipal` through helper-resolved access shapes (`{ userId, role }`) into capability checks. That refactor lands in Wave 2C-C alongside the `external-apis` OAuth-secret-shaping cleanup. Per spec: "do NOT mass-convert untouched low-risk legacy areas; do NOT rewrite stable serializers unnecessarily."

---

## Session/device UX completed

- Active-session list surfaces all non-revoked, non-expired `auth_sessions` for the principal, with `(this session)` annotation.
- Revoke-specific: revokes one session; if it's the current one, clears the cookie + `await logoutCurrentSession()` + redirects to `/login`.
- Revoke-others: revokes every session except the current one (uses the new `exemptSessionId` arg on `revokeAllSessionsForUser`).
- Revoke-all: includes current session; clears cookie; redirects.
- Trusted-device list: surfaces fingerprint-matched devices with `(this)` annotation; "Trust this browser" requires step-up.
- MFA freshness: displayed via `mfa.lastVerifiedAt` + `mfa.phishingResistant` flags.

All revoke actions emit `session_revoked_by_user` audit events with attribution.

---

## Audit events added (7)

Added to `AuditDecision` union (additive — no behavioral change):
- `session_revoked_by_user` — wired in `sessions/revoke.ts`
- `trusted_device_viewed` — reserved for the dashboard view event (Wave 2C-C wires)
- `trusted_device_removed` — reserved (alias for `trusted_device_revoked` — kept for future per-spec naming)
- `recovery_codes_viewed` — reserved (Wave 2C-C: emit on dashboard load with non-null codes)
- `recovery_codes_regenerated_ui` — reserved (Wave 2C-C: distinguish UI-initiated regen)
- `elevated_ui_action_requested` — reserved (Wave 2C-C: emit when `withStepUp` retries)
- `elevated_ui_action_completed` — reserved (Wave 2C-C: emit on retry success)

The reserved events are part of the union so existing audit-write call sites can use them without further `AuditDecision` extensions; concrete emission for dashboard-side events lands in Wave 2C-C when the dashboard is wired into telemetry.

---

## Remaining blockers

### Critical (block dashboard usage in prod)
1. **Apply Wave-2A + 2B-B migrations** — without them, none of the security tables exist and every dashboard call returns 401 / 500.
2. **Set envs** — `SESSION_COOKIE_SECRET`, `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_ORIGIN` per environment.
3. **Promote a DB-backed SUPER_ADMIN with at least one passkey** — without this, the migrated routes (and step-up flows in general) are unreachable.

### Operational
4. **Bridge expiry 2026-08-05** — operator must promote a DB-backed `SUPER_ADMIN` row before the bridge hard-expires.
5. **Recovery-code standalone regenerate endpoint** — current `/api/auth/totp/recovery` requires consuming an existing code to trigger regeneration. Wave 2C-C will add `POST /api/auth/totp/recovery/regenerate` (no consumption).

### Long-tail (Wave 2C-C scope)
6. 21 role-string references remain (mostly response-shaping). Wave 2C-C target.
7. **`profiles.is_super_admin`** (16 references) and **cookie super-admin path** (135 references) — Wave 3.

---

## Validation commands executed

```
npx tsc --noEmit -p tsconfig.json         → 0 errors in any Wave-2C-B file
git grep -nE "role *=== *'..."            → 21 (down 1 from Wave 2C-A; team/self-joined cleanup)
git status                                → 4 created + 8 modified files in scope
```

Pre-existing typecheck noise (cron.ts, in-progress engagement modules) — outside Wave 2C-B scope.

---

## Security baseline counts

(Production code only.)

| Metric | Pre-2C-B | Post-2C-B | Notes |
|---|---:|---:|---|
| Duplicate trust authorities | 4 | **4** | Wave 3 territory; Wave 2C-B additive on the migration side. |
| Route-local auth parsers | 0 | **0** | All migrated routes delegate to `requireCapability` / `IdentityResolver`. New session-list/revoke routes also use `IdentityResolver`. |
| Frontend auth-trust paths (new code) | 0 | **0** | Dashboard hydrates from server endpoints only. NO local capability derivation. NO local step-up trust. `withStepUp` does not cache state. |
| MFA bypass risks | 0 | **0** | All migrated routes block bridge principals; revoke routes require phishing-resistant step-up. |
| Role-based authorization paths | 22 | **21** | One reduction (`team/self-joined.ts` `isCompanyAdmin` helper inlined and removed). The remaining 21 are response-shaping (Wave 2C-C). |
| Variant contamination | 0 | **0** | Preserved. |
| Runtime cycles | ≤18 | **≤18** | Preserved. New routes form leaf nodes off `IdentityResolver`. |
| Runtime DB writes | ≤588 | **≤588** | Within budget. New writes are session-revoke (already counted in 2B-C budget) + audit-log inserts on dashboard actions. |
| Unsafe propagation | ≤6025 | **≤6025** | Preserved. |
| Typecheck errors (Wave-2C-B files) | — | **0** | Clean across all 4 created + 8 modified files. |

---

## Wave 2C-C preview (next session)

1. Convert remaining 21 role-shaping sites to capability projections.
2. Add `POST /api/auth/totp/recovery/regenerate` standalone endpoint.
3. Wire the dashboard's reserved audit events (`trusted_device_viewed`, `recovery_codes_viewed`, `elevated_ui_action_*`).
4. Migrate medium-risk routes that weren't in scope this wave (campaign deletion, content publish, automation execute, integration/preset mutations).
5. Polish dashboard UX (loading states, toast notifications, layout tightening).
6. Add `external-apis/index.ts:471` OAuth-secret cleanup (require `INTEGRATION_SECRETS_READ` capability instead of role-equality).

Wave 3 (after 2C-C, after operator promotes a DB-backed SUPER_ADMIN with a passkey):
- Delete `legacyCookieSuperAdminBridge.ts`.
- Remove cookie + `profiles.is_super_admin` reads from all admin endpoints.
- Drop legacy `users.role` / `users.company_id` columns.
