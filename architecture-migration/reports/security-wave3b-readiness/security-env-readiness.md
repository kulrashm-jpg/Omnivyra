# Wave 3B Readiness — Environment Readiness

**Generated**: 2026-05-07
**Method**: source-grounded inspection of env-validation code paths. Actual runtime values cannot be inspected from this position; this report documents the validation contract and what the operator MUST set.

---

## 1. Centralized hard-fail validator

[backend/security/env.ts](../../../backend/security/env.ts) is the single canonical validator. It runs once per process (memoized) and throws on first import if any required value is missing or malformed.

| Variable | Validation | Hard-fail trigger |
|---|---|---|
| `WEBAUTHN_RP_ID` | required, non-empty, hostname-only (no `://`, no `/`) | empty / contains scheme |
| `WEBAUTHN_RP_ORIGIN` | required, non-empty, must include `https://` or `http://` scheme; HTTPS required when `NODE_ENV=production`; host must equal `WEBAUTHN_RP_ID` or be a subdomain | empty / wrong scheme / origin host mismatch / HTTP in prod |
| `SESSION_COOKIE_SECRET` | required, ≥32 chars | empty / shorter than 32 chars |

**Rules confirmed in source**:
- ✅ NO silent defaults (`!process.env.X` → push to errors array; not "fall back to dev value")
- ✅ NO fallback values (the validator throws; nothing reads `process.env.WEBAUTHN_RP_ID` outside this module)
- ✅ Single import point — every consumer goes through `getWebAuthnRpId()` / `getWebAuthnRpOrigin()` / `getSecurityEnv()`
- ✅ Memoized — first invalid call throws and caches the error so subsequent calls also throw deterministically

Source: [backend/security/env.ts:22-82](../../../backend/security/env.ts).

---

## 2. SESSION_COOKIE_SECRET secondary validator

[backend/security/SessionAuthorityService.ts:50-58](../../../backend/security/SessionAuthorityService.ts) re-validates `SESSION_COOKIE_SECRET` at the point of use — defense-in-depth for any code path that bypasses the central env module.

```ts
function getCookieSecret(): string {
  const secret = process.env.SESSION_COOKIE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_COOKIE_SECRET missing or too short …');
  }
  return secret;
}
```

Same hard-fail contract as `env.ts`. ✅

---

## 3. SUPER_ADMIN_BOOTSTRAP_TOKEN

Validated lazily inside [pages/api/admin/bootstrap-super-admin.ts:119-127](../../../pages/api/admin/bootstrap-super-admin.ts).

| Check | Behavior |
|---|---|
| Unset or `< 32 chars` | route returns `503 BOOTSTRAP_NOT_CONFIGURED` |
| Mismatched | route returns `401 BOOTSTRAP_TOKEN_INVALID` (constant-time compare via `timingSafeEqual`) |
| Set with active SUPER_ADMIN already in DB | route returns `409 BOOTSTRAP_ALREADY_CONSUMED` (single-use lock) |
| Still set after successful bootstrap | route logs `super_admin_bootstrap_token_still_set_after_use` warning and recommends operator unset it |

Validated as a **route-level** concern, not a startup concern, because the bootstrap path is single-use and the env var should be UNSET in steady state. ✅

---

## 4. Production-only constraints

- `NODE_ENV=production` AND `WEBAUTHN_RP_ORIGIN` not starting with `https://` → hard fail
- `NODE_ENV=production` AND `SUPER_ADMIN_USERNAME` or `SUPER_ADMIN_PASSWORD` unset → bridge resolver rejects with `bridge_rejected` audit row (not a startup fail; bridge is just inactive)

Source: [backend/security/env.ts:53-55](../../../backend/security/env.ts), [backend/security/legacyCookieSuperAdminBridge.ts:104-115](../../../backend/security/legacyCookieSuperAdminBridge.ts).

---

## 5. What I cannot verify from this position

I have no read access to the operator's `.env` file or production environment. The runtime value of each variable is therefore **unverified**. I can only confirm that:

1. The validator code is correct.
2. The validator runs on first import of any module that uses these variables.
3. There is no silent fallback path.

The operator MUST verify before resuming Wave 3B:

```bash
# Sanity-print lengths only (don't print the secret values themselves):
node -e "
const env = require('process').env;
console.log({
  WEBAUTHN_RP_ID: env.WEBAUTHN_RP_ID,
  WEBAUTHN_RP_ORIGIN: env.WEBAUTHN_RP_ORIGIN,
  SESSION_COOKIE_SECRET_len: (env.SESSION_COOKIE_SECRET || '').length,
  SUPER_ADMIN_BOOTSTRAP_TOKEN_len: (env.SUPER_ADMIN_BOOTSTRAP_TOKEN || '').length,
});
"
```

Expected:
- `WEBAUTHN_RP_ID` = `<your-domain>` or `localhost` (no scheme, no path)
- `WEBAUTHN_RP_ORIGIN` = `https://<your-domain>` (or `http://localhost:<port>` for dev)
- `SESSION_COOKIE_SECRET_len` ≥ 32
- `SUPER_ADMIN_BOOTSTRAP_TOKEN_len` ≥ 32 **only during the bootstrap window**; should be unset thereafter

---

## Verdict — env layer

**INDETERMINATE FROM CODE-AGENT POSITION**. The validator is correct and hard-fails closed; the application will not silently accept missing/malformed config. The actual values must be confirmed by the operator before the bootstrap flow can succeed end-to-end.

Treat this as a Wave 3B prerequisite the operator clears, not a code defect.
