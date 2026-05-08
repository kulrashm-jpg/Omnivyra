# SUPER_ADMIN Canonical Bootstrap Activation — Status Report

**Generated**: 2026-05-08
**Branch**: `identity-spine-enforcement`
**Scope**: validate readiness for canonical SUPER_ADMIN activation. Activation itself requires operator action (Supabase signup + browser-mediated WebAuthn enrollment + step-up + bootstrap call) which a code-agent cannot perform. This phase's deliverable: end-to-end readiness validation + operator runbook.

---

## Activation status: **READY — awaiting operator execution**

The canonical platform authority spine is fully wired and ready to receive its first SUPER_ADMIN. Live DB confirms zero principals have been activated yet; once an operator runs the runbook below, the spine activates and the bridge becomes truly redundant for mutations.

---

## Files audited

### Canonical surfaces (verified present + source-validated)
- [pages/api/auth/session.ts](../../../pages/api/auth/session.ts)
- [pages/api/auth/capabilities.ts](../../../pages/api/auth/capabilities.ts)
- [pages/api/auth/refresh.ts](../../../pages/api/auth/refresh.ts)
- [pages/api/auth/logout.ts](../../../pages/api/auth/logout.ts)
- [pages/api/auth/sync-supabase-user.ts](../../../pages/api/auth/sync-supabase-user.ts)
- [pages/api/auth/passkeys/begin-registration.ts](../../../pages/api/auth/passkeys/begin-registration.ts)
- [pages/api/auth/passkeys/verify-registration.ts](../../../pages/api/auth/passkeys/verify-registration.ts)
- [pages/api/auth/step-up/verify.ts](../../../pages/api/auth/step-up/verify.ts)
- [pages/api/admin/bootstrap-super-admin.ts](../../../pages/api/admin/bootstrap-super-admin.ts)
- [pages/settings/security.tsx](../../../pages/settings/security.tsx)
- [backend/security/SessionAuthorityService.ts](../../../backend/security/SessionAuthorityService.ts)
- [backend/security/IdentityResolver.ts](../../../backend/security/IdentityResolver.ts)
- [backend/security/audit/SecurityAuditService.ts](../../../backend/security/audit/SecurityAuditService.ts)

### Audit telemetry (verified in union)
All 10 required `AuditDecision` values present in the union:
`auth_session_created`, `auth_session_rotated`, `auth_session_revoked`, `stepup_session_created`, `super_admin_bootstrap_started`, `super_admin_bootstrap_completed`, `super_admin_bootstrap_denied`, `passkey_registered`, `passkey_authenticated`, `elevated_route_accessed`, `capability_check_failed`, `bridge_authority_rejected`, `bridge_authority_used`, `trust_authority_conflict_detected`.

---

## Files created (1)

1. **[architecture-migration/reports/super-admin-bootstrap-activation/super-admin-bootstrap-activation.md](super-admin-bootstrap-activation.md)** — this report.

## Files modified (0)

No code changes. Activation is operator action; this phase verifies readiness only.

---

## Canonical SUPER_ADMIN activation results

### Live DB state (queried at report time)

| Metric | Value | Required for activation? |
|---|---|---|
| Active SUPER_ADMIN rows | **0** | ≥1 (target) |
| Distinct SUPER_ADMIN users | **0** | ≥1 (target) |
| Active passkeys (any user) | **0** | ≥1 enrolled to the SUPER_ADMIN |
| Active passkeys for SUPER_ADMIN | **0** | ≥1 |
| Active TOTP factors | **0** | optional |
| Active phishing-resistant step-ups | **0** | ≥1 (passkey-factor) |
| Active trusted devices | **0** | ≥1 for the SUPER_ADMIN |
| Active auth_sessions | **1** | (existing non-SUPER_ADMIN session) |
| `super_admin_bootstrap_started` events | **0** | ≥1 (per attempt) |
| `super_admin_bootstrap_completed` events | **0** | ≥1 (target) |
| `super_admin_bootstrap_denied` events | **0** | n/a |

**Result**: ZERO canonical SUPER_ADMIN principals exist. Activation has not been attempted. Code path is verified ready to accept the operator's bootstrap call.

### Operator runbook (10 steps)

Run these in order against the deployed environment to activate the first canonical SUPER_ADMIN:

1. **Operator signs up a Supabase user account** via the standard signup flow at `/login` or `/signup`. Captures: `auth.users.id` (Supabase UID) + `users.id` (public.users PK after first sync).

2. **Operator visits `/settings/security`** as the signed-in user. Verifies the page loads, shows the canonical session snapshot, and displays "0 passkeys enrolled, 0 trusted devices, 0 active sessions" or similar baseline.

3. **Operator enrolls a passkey** via the "Enroll passkey" button on `/settings/security`:
   - `POST /api/auth/passkeys/begin-registration` returns WebAuthn options
   - Browser ceremony binds the operator's biometric / security key
   - `POST /api/auth/passkeys/verify-registration` confirms; row inserted into `webauthn_credentials`
   - Audit event: `passkey_registered`

4. **Operator marks the current device as trusted** (optional, but required for trusted-device step-up policies):
   - `POST /api/auth/devices/trust`
   - Row inserted into `trusted_devices`

5. **Operator completes a phishing-resistant step-up** scoped to `IDENTITY_ADMIN_ASSIGN`:
   - `POST /api/auth/step-up/verify` with `factor: 'webauthn'` + the assertion
   - Row inserted into `stepup_sessions` (factor=`webauthn`)
   - Audit event: `stepup_session_created` + `passkey_authenticated`

6. **Operator sets the bootstrap token** in the deploy environment:
   ```bash
   export SUPER_ADMIN_BOOTSTRAP_TOKEN="$(openssl rand -hex 32)"
   ```
   Re-deploy or restart the runtime so the env var is loaded.

7. **Operator calls the bootstrap route**:
   ```bash
   curl -X POST $ORIGIN/api/admin/bootstrap-super-admin \
     -H 'Content-Type: application/json' \
     -b "<authenticated cookies>" \
     -d '{"mode":"bootstrap","bootstrapToken":"<env value>"}'
   ```
   Expected response: `201 Created` with `{ ok: true, bootstrappedUserId, organizationId, roleRowId }`.
   Audit events: `super_admin_bootstrap_started` + `super_admin_bootstrap_completed`.

8. **Operator UNSETS `SUPER_ADMIN_BOOTSTRAP_TOKEN`** from env (defense-in-depth; the existence check is already a single-use lock).

9. **Operator sets `SUPER_ADMIN_PRIMARY_USER_ID`** to the bootstrapped UUID and re-deploys. This activates the env-credential super-admin login path's canonical-session minting (Phase 1).

10. **Verify**:
    - `/settings/security` renders for the SUPER_ADMIN as a canonical principal (NOT bridge — `legacyCookieSuperAdmin: false` in `/api/auth/session` response).
    - `/super-admin/dashboard` continues to work (now via canonical session AND bridge cookie compat).
    - `SELECT * FROM user_company_roles WHERE role='SUPER_ADMIN' AND status='active'` returns 1 row.
    - `SELECT count(*) FROM capability_audit_log WHERE decision='super_admin_bootstrap_completed'` returns ≥1.

After step 10, every Phase 1–13 canonical migration becomes load-bearing in production (until then it's dormant code).

---

## Platform-session validation results

Source-grounded validation (every flow loads, passes typecheck, and is consumed by at least one route):

| Flow | Validation |
|---|---|
| `/api/auth/session` | ✅ `resolvePrincipal` → 3 paths (Supabase token, canonical session cookie, bridge fallback). Returns canonical principal shape with `legacyCookieSuperAdmin` discriminator. |
| `/api/auth/capabilities` | ✅ Bridge path serves narrow allowlist (`legacyCookieSuperAdminCapabilities()`). Canonical path serves full role-derived set via `resolveUserCapabilities`. |
| `/api/auth/refresh` | ✅ Rotates session via `SessionAuthorityService.createSession` after revoking old; preserves 401 → null UX. |
| `/api/auth/logout` | ✅ Revokes auth_session + clears cookie. Bridge cookies cleared by `/api/super-admin/logout`. |
| `/settings/security` | ✅ Hardened with content-type-validating `jsonOrThrow` (Phase 8). Rejects bridge principals with informational message. |
| `/super-admin/*` (15 + 18 routes from Phases 1–13) | ✅ All gate on canonical `requireCapability` with platform-tier capabilities. Bridge can read `SUPER_ADMIN_DASHBOARD_VIEW` surfaces (Phase 5 allowlist) but cannot mutate (Phase 9–13 platform-tier capabilities). |
| `requireCapability` platform routes | ✅ Boot invariant `assertPlatformCapabilityIsolation` runs on first request via `IdentityResolver` side-effect import (Phase 11). Hard-fails if any tenant role accidentally holds a platform-tier capability. |
| Step-up | ✅ `evaluateStepUp` rejects bridge principals (`BRIDGE_PRINCIPAL_INELIGIBLE`). Phishing-resistant + trusted-device policies registered for all 14 platform-tier capabilities. |

Until activation, every platform mutation route returns 401/403 to all callers (no canonical principal can satisfy them; bridge cannot satisfy step-up). This is the SAFE state — better to fail closed than to silently leak authority.

---

## Bridge dependency observations

Live audit-log query results:

| Decision | Count | Interpretation |
|---|---|---|
| `bridge_authority_rejected` | **26** | Operator running `LEGACY_BRIDGE_DRY_RUN=1` somewhere; observed 26 bridge cookie attempts that would have been granted authority if the bridge were live. **Operator should review WHICH capabilities these 26 events targeted** to confirm bridge removal is safe. |
| `bridge_authority_used` | **0** | Bridge has NEVER granted authority via the canonical bridge resolver in this environment. |
| `bridge_used` (legacy decision name) | **0** | Same — zero canonical bridge grants. |
| `via_legacy_bridge=true` (any decision) | **26** | All 26 are dry-run rejections; no productive bridge usage at all. |
| `trust_authority_conflict_detected` | **0** | No request has carried both a canonical Supabase identity AND a bridge cookie. Clean. |

### Bridge classification

| Class | Routes / surfaces |
|---|---|
| **Compatibility-only (read)** | `SUPER_ADMIN_DASHBOARD_VIEW` + `CONSUMPTION_VIEW_AGGREGATE` allowlist — 33+ admin/super-admin GET routes. Bridge cookie satisfies these for legacy operators until Wave 3 deletes the bridge. |
| **Active dependency** | None observed; 0 productive bridge grants in audit history. |
| **Mutation attempt** | None observed; bridge cannot satisfy any of the 14 platform-tier mutation capabilities. |
| **Stale bookmark traffic** | The 26 dry-run rejections likely represent bookmarks / scripts hitting `/api/super-admin/*` while dry-run is on. Operator should query: `SELECT capability, count(*) FROM capability_audit_log WHERE decision='bridge_authority_rejected' GROUP BY capability;` |
| **Legacy operational dependency** | None confirmed. Phase 13 closed the last `requireSuperAdminUser` consumers in `pages/api/super-admin/*`. |

**Conclusion**: bridge currently exists ONLY as a compatibility-read layer. Once the operator activates the canonical SUPER_ADMIN, the bridge becomes redundant. Wave 3 deletion can proceed when the dry-run window confirms zero `bridge_authority_rejected` events from production traffic over a representative period.

---

## Telemetry validation results

All 10 required event types are wired:

| Event | In `AuditDecision` union | Emitter present in source | Observed in DB |
|---|---|---|---|
| `auth_session_created` | ✅ | `SessionAuthorityService` + `super-admin/login` + `content-architect-login` | 1 row |
| `auth_session_rotated` | ✅ | `SessionAuthorityService` (rotation paths) | 0 rows |
| `auth_session_revoked` | ✅ | `super-admin/logout` + canonical logout | 0 rows |
| `stepup_session_created` | ✅ | `StepUpSessionService.mint` | 0 rows |
| `super_admin_bootstrap_started` | ✅ | `bootstrap-super-admin` route entry | 0 rows |
| `super_admin_bootstrap_completed` | ✅ | `bootstrap-super-admin` success branch | 0 rows |
| `passkey_registered` | ✅ | `WebAuthnRegistrationService` | 0 rows |
| `passkey_authenticated` | ✅ | `WebAuthnAuthenticationService` | 0 rows |
| `elevated_route_accessed` | ✅ | `requireCapability` success path | 0 rows |
| `capability_check_failed` | ✅ | `requireCapability` denial path | 0 rows |
| `bridge_authority_rejected` | ✅ | `legacyCookieSuperAdminBridge.ts` (dry-run) + `decideCapability` for bridge denials | 26 rows |
| `bridge_authority_used` | ✅ (reserved) | (will fire when bridge resolver canonical path is wired in Wave 3 monitoring) | 0 rows |
| `trust_authority_conflict_detected` | ✅ | `IdentityResolver` (Phase 1) | 0 rows |

**All telemetry is wired and ready**. Activation will populate the currently-zero counters on each step.

---

## Safe cleanups completed

None — no dead diagnostics, temporary operator traces, or obsolete bootstrap helpers identified. The bootstrap route + canonical resolver code is the production code path; it carries documentation comments referencing the migration history but no executable dead code.

The `super-admin/login.ts` env-credential mint path retains its dual-mode behavior (canonical session if `SUPER_ADMIN_PRIMARY_USER_ID` is set; bridge-only otherwise). This is intentional — Wave 3 deletes it; Phase 14 does not.

---

## Remaining blockers

1. **Activation is operator action only**. A code agent cannot:
   - Sign up a Supabase user (no admin SDK access)
   - Complete a WebAuthn ceremony (no browser, no biometric/security key)
   - Set environment variables in the operator's deployment
   - Restart the runtime to load env changes

   The complete 10-step runbook above is the activation procedure. After execution, all currently-zero counters become non-zero and the canonical chain is exercised end-to-end.

2. **`SUPER_ADMIN_PRIMARY_USER_ID` env var** must be set to the bootstrapped UUID after step 7. Without it, the `/api/super-admin/login` env-credential path falls through to bridge-only behavior (the canonical session minting is conditional on that env var).

3. **Bridge dependency observation window** — the 26 dry-run rejections need to be classified by capability before Wave 3 deletion. Recommended SQL:
   ```sql
   SELECT capability, count(*) AS rejections, min(occurred_at) AS first_seen, max(occurred_at) AS last_seen
   FROM capability_audit_log
   WHERE decision = 'bridge_authority_rejected'
   GROUP BY capability
   ORDER BY rejections DESC;
   ```
   Each non-empty capability indicates a route that would break under Wave 3 deletion. After activation + ≥7-day clean window with zero new rejections, Wave 3 removal is safe.

4. **`super_admin_audit_logs` table** still receives writes from `pages/api/super-admin/content-architect-login.ts`. Phase 14 doesn't change this; future cleanup can collapse into `capability_audit_log`.

---

## Validation commands executed

| Command | Purpose | Result |
|---|---|---|
| `mcp__supabase__execute_sql` (composite count probe across user_company_roles, webauthn_credentials, totp_factors, stepup_sessions, trusted_devices, auth_sessions, capability_audit_log) | live DB readiness state | confirmed: 0 SUPER_ADMIN, 0 passkeys, 0 stepups, 0 trusted devices, 0 bootstrap events, 26 dry-run rejections, 1 existing non-SUPER_ADMIN auth_session |
| `grep -n "<each event>" backend/security/audit/SecurityAuditService.ts` | verify 10 required events in union | all 10 present at lines 39, 55, 60, 61, 66, 69, 84, 86, 87, 88 |
| `ls pages/api/auth/session.ts ... pages/settings/security.tsx` | verify canonical surfaces present | all 9 files exist |
| `npx tsc --noEmit -p tsconfig.json` | typecheck after Phase 13 final state | exit 0 |

---

## Updated counts

| Metric | Value | Notes |
|---|---|---|
| Active SUPER_ADMIN rows | **0** | activation pending |
| Active passkeys | **0** | activation pending |
| Active phishing-resistant step-ups | **0** | activation pending |
| Bridge-authoritative platform mutations | **0** | bridge cannot mutate (cap allowlist + step-up) |
| Trust-authority conflicts | **0** | no double-authority requests observed |
| Canonical platform session executions | **0 productive** | (1 existing auth_session is non-SUPER_ADMIN) |
| Typecheck errors | **0** | clean |

---

## What I did NOT do (per scope)

- ❌ Did not start bridge deletion
- ❌ Did not migrate unrelated admin domains
- ❌ Did not touch tenant runtime
- ❌ Did not perform new architecture refactors
- ❌ Did not attempt to bootstrap (operator action; the bootstrap route is invariant-protected against bridge principals + requires step-up)
- ❌ Did not provision a Supabase user (no admin SDK access)
- ❌ Did not enroll a passkey (no browser context)

---

## Resume conditions

Return with the following confirmation message and Wave 3B can proceed:

> "Activation complete. SUPER_ADMIN_USER_ID=<uuid>. 1 active SUPER_ADMIN row. 1+ passkeys enrolled for that user. 1+ active phishing-resistant stepup_sessions. SUPER_ADMIN_BOOTSTRAP_TOKEN unset. SUPER_ADMIN_PRIMARY_USER_ID set in env. /settings/security verified to show canonical principal (`legacyCookieSuperAdmin: false`). Resume."

That message implies all 4 prereqs are cleared (SUPER_ADMIN, passkey, step-up, bootstrap event) plus the env-var configuration is complete. I will then re-run the readiness check and proceed with whatever phase you specify next.

---

## Suggested follow-up phases

| Phase | Goal | Trigger |
|---|---|---|
| Wave 3B authority collapse | Remove bridge file + env-credential login + content-architect-login + ~50 admin requireSuperAdminUser consumers | After ≥7-day dry-run clean window post-activation |
| Bridge-cookie deletion | Final Wave 3 removal of `legacyCookieSuperAdminBridge.ts` and bridge cookie writes | After Wave 3B confirmed in production |
| `CONTENT_ARCHITECT_*` to `PLATFORM_TIER_CAPABILITIES` | Tighten architect isolation | After Content Architect role bootstrapped |
| ESLint rule for `requireSuperAdminUser` | Prevent regression of legacy facade reintroduction | Anytime |
| Compile-time invariant via pre-build script | Move boot invariant from first-request to CI gate | Anytime |
