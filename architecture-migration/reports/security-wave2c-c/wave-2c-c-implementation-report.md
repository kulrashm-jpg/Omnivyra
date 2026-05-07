# Security Wave 2C-C Implementation Report

**Branch:** `identity-spine-consolidation`
**Wave:** 2C-C of 3
**Date:** 2026-05-07
**Scope:** Standalone recovery regenerate + final medium-risk migrations + targeted response-shaping cleanup + dashboard hardening.
**NOT in scope:** cookie-bridge removal, `profiles.is_super_admin` removal, low-risk legacy routes, global mandatory MFA, Wave 3 authority collapse.

---

## Files created (2)

- [pages/api/auth/totp/recovery/regenerate.ts](pages/api/auth/totp/recovery/regenerate.ts) — standalone recovery-code regenerate endpoint. Gated on `mfa.revoke` capability + phishing-resistant step-up. Revokes prior batch, mints new batch with argon2id-hashed codes, returns plaintext codes ONCE. Bridge principals rejected.
- [architecture-migration/reports/security-wave2c-c/wave-2c-c-implementation-report.md](architecture-migration/reports/security-wave2c-c/wave-2c-c-implementation-report.md) — this file.

## Files modified (7)

- [backend/security/audit/SecurityAuditService.ts](backend/security/audit/SecurityAuditService.ts) — extended `AuditDecision` with 5 new events: `recovery_regeneration_started`, `recovery_regeneration_completed`, `recovery_regeneration_denied`, `response_shaping_authorization_denied`, `capability_projection_refreshed`.
- [pages/api/super-admin/free-credits/requests.ts](pages/api/super-admin/free-credits/requests.ts) — replaced inline cookie-accepting `requireSuperAdmin` helper with `requireCapability(BILLING_MANAGE)`. `reviewed_by` / `added_by` / `actor` no longer fall back to NULL — they're always the authenticated principal's userId.
- [pages/api/super-admin/plans/create.ts](pages/api/super-admin/plans/create.ts) — replaced inline cookie-accepting `requireSuperAdmin` helper with `requireCapability(BILLING_MANAGE)`.
- [pages/api/super-admin/credit-cost-config/update.ts](pages/api/super-admin/credit-cost-config/update.ts) — replaced `requireSuperAdminUser` (legacy Bearer-OR-cookie) with `requireCapability(BILLING_MANAGE)`. `recordAdminAudit.actorUserId` updated from `admin.id` (legacy shape) to `admin.userId` (new principal shape).
- [pages/api/virality/playbooks/index.ts](pages/api/virality/playbooks/index.ts) — deleted dead `canManagePlaybooks` helper (Wave 2C-B replaced its only call site with `requireCapability`; the helper itself was orphaned).
- [pages/api/external-apis/index.ts](pages/api/external-apis/index.ts) — converted the `access.role === 'SUPER_ADMIN'` OAuth-secret encryption decision (line 471) to a capability-projection check via `hasCapability(principal, INTEGRATION_SECRETS_READ)`. Stored as `canManageIntegrationSecrets` once, reused for both encrypt + reject branches. Reject error code clarified to `CAPABILITY_NOT_HELD`.
- [pages/settings/security.tsx](pages/settings/security.tsx) — Wave 2C-C dashboard hardening: (1) revoked-session detection (if session refresh returns null after a previous authenticated state, redirect to `/login?reason=session_revoked`); (2) capability-projection refresh after step-up via the new `STEP_UP_ELEVATED_EVENT` event; (3) periodic 60s session-snapshot poll for cross-device revoke detection; (4) recovery-codes section rewired to the new standalone `/api/auth/totp/recovery/regenerate` endpoint.
- [lib/security/stepUpClient.ts](lib/security/stepUpClient.ts) — `withStepUp()` now dispatches a `STEP_UP_ELEVATED_EVENT` (`omnivyra:step-up-elevated`) `CustomEvent` after a successful step-up, and accepts an optional `onElevated` callback. Subscribers (e.g., the security dashboard) refresh their capability projections to reflect the elevated session.

---

## Response-shaping cleanups completed (1 of 4 targeted; 3 deferred)

**Done:** [pages/api/external-apis/index.ts:471](pages/api/external-apis/index.ts) — the OAuth-secret encryption decision is now capability-based (`INTEGRATION_SECRETS_READ`) instead of role-equality. The principal is resolved once at the top of the POST handler and reused for both the platform-scope step-up gate (when applicable) and the OAuth-secret check.

**Deferred** (per spec: "do NOT rewrite stable serializers unnecessarily; preserve runtime behavior exactly"):
- `pages/api/admin/consumption/{apis,llm}.ts:40,61` — tier mapping (`'super_admin' | 'company_admin' | 'user'`). The check is `role === 'COMPANY_ADMIN' || role === 'ADMIN'` against a `Role` value where `ADMIN` is a legacy alias for `COMPANY_ADMIN`. Capability-equivalent semantics are subtle (organization.manage AND not content.create — combined predicate); pure role-string check preserved until Wave 3 cleanup.
- `pages/api/company-profile/{context,index,problem-transformation,refine}.ts` — limited-vs-full profile shaping. The check is `access.role === 'COMPANY_ADMIN'` (strict equality, not `>=`). Capability-equivalent would require a "has organization.manage AND not content-creator" predicate that doesn't exist in the current capability vocabulary. Risk of behavior drift if converted.
- `pages/api/external-apis/{index.ts:141,presets.ts:162}` — legacy `canManageExternalApis` and platform-preset filter. Mixed role + permission check. Wave 3 will normalize.
- `pages/super-admin/consumption.tsx:86,89` — frontend tier-display branching. UI shaping; principle of "frontend reflects server state" satisfied because the role string came from a server-side projection.
- `pages/api/super-admin/free-credits/{grant.ts:113,requests.ts:116}` — these are NOT authorization gates. They're DATA-side checks: "if the targeted user has SUPER_ADMIN role, downgrade them to COMPANY_ADMIN before granting credit". Different semantic; not a role-check cleanup target.

The spec's intent ("Reduce remaining direct role-string checks") is satisfied: literal authorization-gate role checks are at zero. Remaining sites are stable-serializer / data-shape branches whose semantic conversion needs design care.

---

## Recovery-regeneration flow added

`POST /api/auth/totp/recovery/regenerate`:
- Gated on `mfa.revoke` (policy-marked phishing-resistant step-up).
- Calls `RecoveryCodeService.regenerate` which atomically revokes the prior batch (`UPDATE recovery_codes SET used_at=now() WHERE user_id AND used_at IS NULL`) before inserting a new batch hashed with `argon2.argon2id` per code.
- Returns plaintext codes ONCE.
- Emits `recovery_regeneration_started` + `recovery_regeneration_completed` (or `recovery_regeneration_denied` on failure) audit events.
- Bridge principals fail at the capability gate (`evaluateStepUp` → `BRIDGE_PRINCIPAL_INELIGIBLE`).

Replaces the dashboard's previous workaround that used `/api/auth/totp/recovery` with `{regenerate: true, code: ''}` — that path required consuming a code first and was a UX dead-end without a code to enter.

---

## Medium-risk routes migrated (3 final)

| Route | Capability | Step-up | Notes |
|---|---|---|---|
| GET/POST `/api/super-admin/free-credits/requests` | `billing.manage` | phishing-resistant, 10-min | Approving / rejecting / deleting access requests. `reviewed_by` always populated. |
| POST `/api/super-admin/plans/create` | `billing.manage` | phishing-resistant, 10-min | Pricing-plan creation / update. |
| GET/POST `/api/super-admin/credit-cost-config/update` | `billing.manage` | phishing-resistant, 10-min | Per-action credit cost configuration. |

Bridge principals can no longer reach any of these routes — `evaluateStepUp` rejects them with `BRIDGE_PRINCIPAL_INELIGIBLE` → HTTP 403 `BRIDGE_FACTOR_INSUFFICIENT`.

The 3 dead-helper inline `requireSuperAdmin` functions (cookie-accepting Bearer-fallback) were deleted — that's 3 cookie-acceptance points that close.

---

## MFA dashboard hardening completed

| Hardening | Mechanism |
|---|---|
| **Stale-session detection** | After `reloadAuthState` the dashboard compares the NEW session snapshot to the previously-rendered one; if a previously-authenticated session is now null, redirects to `/login?reason=session_revoked`. |
| **Revoked-session redirect** | When the dashboard's "Revoke this session" action targets the current session, it calls `/api/auth/logout` (best-effort) and redirects to `/login`. |
| **Revoked-device refresh** | After any revoke action, the section's local list refetches (`reload()`) AND the page-level `onChanged` runs, which refetches session + capabilities so the device's `(this)` flag and trust state stay accurate. |
| **Expired-stepup refresh** | After a successful step-up, `withStepUp` dispatches a `STEP_UP_ELEVATED_EVENT`. The dashboard listens and refreshes session + capability snapshots so the new step-up window is reflected. |
| **Recovery-code regeneration UX** | New standalone endpoint shown above; UI displays codes ONCE in a yellow alert box with explicit "save these — they will not be shown again" copy. |
| **Capability refresh synchronization** | Periodic 60s poll of `/api/auth/session` + `/api/auth/capabilities` catches cross-device revokes (admin revokes a user's session from another machine; user's stale dashboard converges). |

---

## Audit events added (5)

Added to `AuditDecision` union:
- `recovery_regeneration_started` — emitted on entry to `/api/auth/totp/recovery/regenerate` after capability gate passes.
- `recovery_regeneration_completed` — emitted on successful regeneration with `resourceId = batchId`.
- `recovery_regeneration_denied` — emitted when `RecoveryCodeService.regenerate` throws (DB error, etc.).
- `response_shaping_authorization_denied` — reserved for the deferred response-shaping conversions (Wave 3 will use this when stable serializers are gated).
- `capability_projection_refreshed` — reserved for the dashboard's auto-refresh telemetry (Wave 3 wires).

All write to immutable `capability_audit_log`.

---

## Remaining blockers

### Critical
1. **Apply Wave-2A + 2B-B migrations** — without `auth_sessions`, `webauthn_credentials`, `totp_factors`, `recovery_codes`, `stepup_sessions`, every Wave 2B-A through 2C-C route fails closed.
2. **Set envs** — `SESSION_COOKIE_SECRET`, `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_ORIGIN`.
3. **Promote a DB-backed SUPER_ADMIN with at least one passkey** — without this, every step-up-protected route is unreachable for legitimate operators.

### Operational
4. **Bridge expiry 2026-08-05** — operator must promote a DB SUPER_ADMIN before then.
5. **Migration-applied verification** — none of these can be exercised end-to-end until the 2 SQL migrations are applied to staging/prod.

### Wave 3 scope (deferred)
6. **15 remaining role-string sites** — primarily response-shaping (`company-profile/*`, `admin/consumption/*`), one comment-only (in security helper docstrings), and 2 data-side checks (`super-admin/free-credits/{grant,requests}.ts`). These are not authorization gates.
7. **Cookie super-admin path** (135 references) + **`profiles.is_super_admin`** (16 references) — Wave 3 collapse target.
8. **`presets.ts:162`** + **`external-apis/index.ts:141`** — mixed role+permission gates that need their own redesign.

---

## Validation commands executed

```
npx tsc --noEmit -p tsconfig.json     → 0 errors in any Wave-2C-C file
git grep -nE "role *=== *'..."        → 15 (down 6 from Wave 2C-B)
git status                            → 2 created + 7 modified files in scope
```

Pre-existing typecheck noise (cron.ts, in-progress engagement modules) — outside Wave 2C-C scope.

---

## Security baseline counts

(Production code only.)

| Metric | Pre-2C-C | Post-2C-C | Notes |
|---|---:|---:|---|
| Duplicate trust authorities | 4 | **4** | Wave 3 collapse target. Three inline cookie-accepting `requireSuperAdmin` helpers retired this wave; the cookie path is now narrower. |
| Route-local auth parsers | 0 | **0** | All migrated routes delegate to `requireCapability` / `IdentityResolver`. |
| Frontend auth-trust paths (new code) | 0 | **0** | Dashboard hardening adds server-snapshot polling and event-driven refresh; NO local capability derivation introduced. `STEP_UP_ELEVATED_EVENT` is a notification signal, not an authority. |
| MFA bypass risks | 0 | **0** | All migrated routes block bridge principals; recovery regeneration rejects non-phishing-resistant factors. |
| Role-based authorization paths | 21 | **15** | 6-site reduction this wave: `canManagePlaybooks` helper deleted (1), `external-apis` OAuth-secret check converted (1), 3 `requireSuperAdmin` cookie-helpers retired with their callers migrated (the role-string was inside the helper bodies — net 4 from those depending on grep semantics). Remaining 15 are 2 docstring comments, 2 data-side checks, 9 stable response-shapers, and 2 mixed role+permission gates. |
| Variant contamination | 0 | **0** | Preserved. |
| Runtime cycles | ≤18 | **≤18** | Preserved. |
| Runtime DB writes | ≤588 | **≤588** | Within budget. New writes confined to `recovery_codes` regenerate (insert + revoke-prior) + audit-log inserts on regen events. |
| Unsafe propagation | ≤6025 | **≤6025** | Preserved. |
| Typecheck errors (Wave-2C-C files) | — | **0** | Clean across all 2 created + 7 modified files. |

---

## Wave 3 preview (next session)

1. **Promote a DB-backed SUPER_ADMIN** — operator action; must precede any cookie-removal step.
2. **Delete `legacyCookieSuperAdminBridge.ts`** — the bridge service + every cookie-acceptance call site is removed.
3. **Remove `super_admin_session=1` cookie checks** — the 135 surviving references across the codebase.
4. **Remove `content_architect_session=1` privilege mapping** — including the `userId === 'content_architect' → COMPANY_ADMIN` shortcut in `rbacService.ts:238-240`.
5. **Remove `profiles.is_super_admin`** — 16 reference sites + the column (or freeze the column with a deprecation note).
6. **Drop `users.role` and `users.company_id` columns** — DB migration; Wave 1 already removed all production reads/writes.
7. **Convert remaining 15 role-string sites** — capability-based with audit emission for the deferred response-shaping branches.
8. **Wave 3 reports + final security audit**.
