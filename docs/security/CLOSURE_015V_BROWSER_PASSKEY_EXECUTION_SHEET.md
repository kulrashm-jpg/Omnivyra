# CLOSURE-015V — Browser passkey execution sheet (non-production only)

**Status: BLOCKED. Not run.** Journeys J1–J13 are from `CLOSURE_015T_RELEASE_READINESS_REVIEW.md` §2.3 (`a1ce873b…`), unchanged. No browser evidence exists. The unit and jsdom tests listed in 015T §2.1 are **not** browser evidence.

## 1. Prerequisite status (checked in 015V without reading any credential-bearing settings)

| # | Prerequisite | Current state (evidence) | Needed |
|---|---|---|---|
| E-1 | Non-production app instance | **absent**: nothing listening on 3000/3001/3002/8080. Starting `npm run dev:cert` loads `.env.cert` (prohibited to read here) | an operator authorized to start it with its configured environment; `WEBAUTHN_RP_ID=localhost`, `WEBAUTHN_RP_ORIGIN=http://localhost:3000` (one host string), `SESSION_COOKIE_SECRET` ≥ 32 chars |
| E-2 | Non-production database | cert `supabase_db_cert-supabase` (`59f0d074f49e…`) on 0001–0004 + 20261211000001 (015S) | — (available) |
| I-1 | Active platform SUPER_ADMIN **with** passkey | **absent**: cert has 0 active SUPER_ADMIN rows (read-only count, 015V) | create via `bootstrap-super-admin` or owner SQL, then enroll a passkey (**separate authorization**) |
| I-2 | Invited SUPER_ADMIN | **absent**: 0 invited SA rows | create (separate authorization) |
| I-3 | Tenant user | 1 tenant membership exists (suitability unverified) | confirm or create (separate authorization) |
| I-4 | Active platform SUPER_ADMIN **without** passkey | **absent** | create (separate authorization) |
| B-1 | Browser | Chromium via the installed `playwright` 1.59.1 / `ms-playwright` chromium-1217, or Chrome with a **dedicated new profile**. The user's open Chrome/Edge sessions must **not** be used | a platform authenticator, security key, or DevTools WebAuthn virtual authenticator (CTAP2, internal, resident key, UV on) |
| O-1 | Observation | read-only DB access to `stepup_sessions`, `trusted_devices`, `webauthn_challenges`, `auth_sessions`, `capability_audit_log` (cert) | available to the cert operator |

**Minimum authorization to unblock** (decision sheet V-4):
- start the non-production app with its configured environment;
- create identities I-1, I-2 and I-4 (and confirm I-3) on cert;
- enroll a passkey for I-1;
- use a dedicated browser profile.

## 2. Evidence for every journey

- HAR export (status, response `code`, `x-omnivyra-correlation-id`);
- a screenshot of the UI outcome;
- DB rows for the correlation id: `capability_audit_log` (denial reason: `NO_STEP_UP_SESSION` / `STEP_UP_EXPIRED` / `FACTOR_INSUFFICIENT` / `TRUSTED_DEVICE_REQUIRED`; on the wire it is always `401 STEP_UP_REQUIRED`), `stepup_sessions`, `trusted_devices`;
- the object's state before and after.

Keep the UA, language and cookie set stable unless the journey changes them: the trusted-device fingerprint is `djb2(UA | Accept-Language | cookie names)`.

## 3. Journeys

Result values: `PASS` / `FAIL` / `BLOCKED` / `NOT RUN`.

| # | Identity | Action | Expected outcome and codes | Fails if | Evidence ref | Result |
|---|---|---|---|---|---|---|
| J1 | I-1 | Enroll a passkey (`/settings/security`) | `verify-registration` 201; passkey listed | — | | BLOCKED |
| J2 | I-1 | RBAC save (Super Admin → Companies & Users → rbac) with no active step-up | 401 `STEP_UP_REQUIRED` → passkey prompt → `step-up/verify` 201 (cookie rotated) → `devices/trust` 201/409 → retry with a **new** Idempotency-Key → 200 with a **numeric `version`** → success text | success before the 2xx; `version` null | | BLOCKED |
| J3 | I-1 | Second elevated action within 10 min (e.g. a user role change) | no prompt; 2xx | prompt or 401 | | BLOCKED |
| J4 | I-1 | Elevated action after 10 min, or after the cert operator expires the `stepup_sessions` row | 401 `STEP_UP_REQUIRED` → prompt; audit reason `STEP_UP_EXPIRED` | succeeds without a ceremony | | BLOCKED |
| J5 | I-1 | Cancel the passkey prompt | "Step-up was cancelled…"; no success UI; object unchanged | any success UI or change | | BLOCKED |
| J6 | I-1 | Untrusted device (change Accept-Language or add a cookie), then act | 401 → prompt (audit `TRUSTED_DEVICE_REQUIRED`) → re-trust revives the `trusted_devices` row → 2xx. **Record UI-3:** a "trust failed / 409 ALREADY_TRUSTED" message after a successful trust | elevated write without trust | | BLOCKED |
| J7 | I-1 | Revoke the device in `/settings/security`, or log out, then act | step-up sessions revoked; next action prompts | old step-up still accepted | | BLOCKED |
| J8 | I-2 | Any platform write | **403 `PLATFORM_SUPER_ADMIN_REQUIRED`**, no prompt | prompt shown or 2xx | | BLOCKED |
| J9 | I-3 | Platform write | **403 `CAPABILITY_NOT_HELD`** / `PLATFORM_SUPER_ADMIN_REQUIRED` | 2xx | | BLOCKED |
| J10 | I-4 | Elevated write | "Step-up is not available… Enroll a passkey at /settings/security"; no change | false success | | BLOCKED |
| J11 | I-1 | CompanyUsersTab: create admin, resend invite, user status, user role, delete user; `/admin/users`: invite, role, remove | prompt if needed → 2xx; success only after 2xx | success on 4xx | | BLOCKED |
| J12 | I-1 | Provider credential add/edit/delete; platform OAuth save. **Record UI-2:** the provider toggle flips, then reverts | prompt → 2xx | lasting false success | | BLOCKED |
| J13 | I-1 | **Replay**: resubmit a captured `step-up/verify` payload; reuse a consumed challenge | 401 `CHALLENGE_REJECTED` / `COUNTER_REPLAY` | accepted | | BLOCKED |

**Known gap, recorded only (not a journey):** company disable/delete from the UI shows an error alert and no passkey prompt (015T UI-1, pre-existing). Expected: `401 STEP_UP_REQUIRED` surfaced as an alert; no false success.

## 4. Sheet result

**BLOCKED.** Prerequisites E-1, I-1, I-2, I-4 (and I-3 confirmation) need owner authorization (V-4). No journey was executed. No account, passkey or session was created, altered or used.
