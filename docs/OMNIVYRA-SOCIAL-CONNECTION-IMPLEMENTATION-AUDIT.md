# OmniVyra Social Connection — Implementation Audit

**Document:** Final audit against Governance Rules G1–G6  
**Date:** March 2025  
**Authority:** `OMNIVYRA-SOCIAL-CONNECTION-GOVERNANCE-RULES.md`

---

## Phase 1 — Connect Page Audit

### Expected Path

**Governance (G1.5):** Connect Accounts reachable from Community AI (single entry point).

| Location | Expected | Actual |
|----------|----------|--------|
| **Connect page** | `/community-ai/connectors` | ✅ `pages/community-ai/connectors.tsx` exists |
| **Entry from Community AI** | Yes | ✅ Linked via "Manage Connectors" from social-platforms; Community AI layout |
| **Header nav** | Single "Connect Accounts" | ⚠️ **VIOLATION** Header has "Connect Accounts" → `/platform-configuration` (separate flow) |

### Connect Page Location

- **Primary:** `pages/community-ai/connectors.tsx` (path: `/community-ai/connectors`)
- **Duplicate:** `pages/platform-configuration.tsx` (path: `/platform-configuration`) — separate OAuth flow to `social_accounts` via `/api/auth/*`

---

## Phase 2 — Governance Rule Compliance Matrix

### G1 — User Experience (Minimal Friction)

| ID | Rule | Status | Finding |
|----|------|--------|---------|
| G1.1 | One-click connect | ✅ Pass | Connect button → auth link → OAuth redirect. No intermediate forms. |
| G1.2 | No credential fields on Connect page | ✅ Pass | `connectors.tsx` has no Client ID/Secret/API URL fields. |
| G1.3 | Only platforms with valid OAuth config | ⚠️ Partial | Platform list from `getCompanyConfiguredPlatformsForConnectors` (company profile + external_api_sources). New company with no config sees **empty list** — violates G6.1/G6.3. |
| G1.4 | User-friendly errors; no internal details | ❌ Fail | LinkedIn callback redirects with `LinkedIn token exchange failed: ${errorText}` — exposes API response (G1.4). |
| G1.5 | Single entry point | ❌ Fail | Two Connect UIs: `/platform-configuration` (Header "Connect Accounts") and `/community-ai/connectors`. |

### G2 — Tenant Isolation (Strong Boundaries)

| ID | Rule | Status | Finding |
|----|------|--------|---------|
| G2.1 | Every `social_accounts` read filters by `company_id` | ❌ Fail | `social_accounts` has **no `company_id` column**. Queries use `user_id` + `user_company_roles.company_id` only. |
| G2.2 | Every `social_accounts` write sets `company_id` | ❌ Fail | No `company_id` column; OAuth callbacks do not set it. |
| G2.3 | Token resolution filters by `company_id` | ❌ Fail | `platformTokenService` infers company via `user_company_roles`; `social_accounts` rows lack `company_id`. |
| G2.4 | Admin sees all; non-admin sees own | ⚠️ N/A | `community_ai_platform_tokens` are org-level (no `user_id`). No per-user visibility split. |
| G2.5 | No cross-company visibility | ✅ Pass | Status API uses `tenant_id`/`organization_id`; `requireManageConnectors` validates company access. |

### G3 — Credential Handling (Secure)

| ID | Rule | Status | Finding |
|----|------|--------|---------|
| G3.1 | No credentials to client | ✅ Pass | OAuth credentials resolved server-side only. |
| G3.2 | Credentials from config/env only | ✅ Pass | `.env` and `oauthCredentialResolver` (external_api_sources). No user input. |
| G3.3 | Tokens encrypted at rest | ❌ Fail | `community_ai_platform_tokens` stores `access_token`, `refresh_token` in **plaintext**. `social_accounts` uses tokenStore (encrypted) ✓. |
| G3.4 | Tokens never returned to client | ✅ Pass | Tokens used server-side only. |

### G4 — Authorization (Every Request)

| ID | Rule | Status | Finding |
|----|------|--------|---------|
| G4.1 | OAuth start: validate membership + MANAGE_CONNECTORS | ✅ Pass | `requireManageConnectors` checks `user_company_roles` + `hasCommunityAiCapability(role, 'MANAGE_CONNECTORS')`. |
| G4.2 | OAuth callback: re-validate session + company | ✅ Pass | Callback calls `requireManageConnectors(req, res, organizationId)`. |
| G4.3 | Connect page: resolve companyId; return only company data | ✅ Pass | Status API uses `tenant_id`/`organization_id` from query; `requireManageConnectors` validates. |
| G4.4 | Disconnect: Company Admin OR owner only | ❌ Fail | `[platform].ts` DELETE allows any user with MANAGE_CONNECTORS. No admin-or-owner check. `community_ai_platform_tokens` has no `user_id` (owner). |
| G4.5 | Publish/engagement: PUBLISH_CONTENT + company filter | ⚠️ Partial | Engagement executor uses tokens; company filter via campaign/org. `social_accounts` queries lack `company_id`. |

### G5 — U.S.-Standard SaaS Practices

| ID | Rule | Status | Finding |
|----|------|--------|---------|
| G5.1 | Minimal OAuth scopes | ✅ Pass | Scopes are platform-specific and focused. |
| G5.2 | User consent via platform OAuth | ✅ Pass | Standard OAuth flow; no bypass. |
| G5.3 | Disconnect revokes/invalidates tokens | ✅ Pass | `revokeToken` clears token from `community_ai_platform_tokens`. |
| G5.4 | Token refresh before expiry | ⚠️ Unknown | No explicit refresh logic found for `community_ai_platform_tokens`. `tokenRefresh` exists for `social_accounts`. |
| G5.5 | Audit log for connect/disconnect | ❌ Fail | No audit logging for `(user_id, company_id, platform, action)`. |

### G6 — Simple Onboarding

| ID | Rule | Status | Finding |
|----|------|--------|---------|
| G6.1 | No per-company OAuth setup | ⚠️ Partial | OAuth from `.env` (global). `social-platforms` allows company admins to enter OAuth per company — conflicts with "customers never configure." |
| G6.2 | Company Admin/Publisher can connect immediately | ❌ Fail | New company with empty profile/config sees **"No social platforms configured"** — must add platforms in Social Platforms or Company Profile first. |
| G6.3 | Platform list shows only enabled + configured | ⚠️ Partial | List from company config; new companies see empty. Should show globally configured platforms. |
| G6.4 | Missing platform: support enables | ✅ Pass | No customer credential UI on Connect page. |

---

## Phase 3 — Violation Summary

| Severity | Rule | Violation |
|----------|------|-----------|
| **Critical** | G2.1, G2.2, G2.3 | `social_accounts` has no `company_id`; reads/writes do not enforce company isolation at row level. |
| **Critical** | G3.3 | `community_ai_platform_tokens` stores tokens in plaintext. |
| **High** | G1.5 | Two Connect UIs: `/platform-configuration` and `/community-ai/connectors`. |
| **High** | G4.4 | Disconnect allows any MANAGE_CONNECTORS user; no admin-or-owner enforcement. |
| **High** | G6.2, G6.3 | New company sees empty platform list; cannot connect without prior config. |
| **Medium** | G1.4 | Callback error redirect exposes internal API error text. |
| **Medium** | G5.5 | No audit logging for connect/disconnect. |
| **Medium** | G5.4 | Token refresh for `community_ai_platform_tokens` not verified. |
| **Low** | G6.1 | `social-platforms` allows company admins to enter OAuth (per-company config). |

---

## Phase 4 — Proposed Fixes

### Fix 1 — Add `company_id` to `social_accounts` (G2.1, G2.2, G2.3)

```sql
-- database/patch-social-accounts-company-id.sql
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_social_accounts_company_id ON social_accounts(company_id);
```

**Code changes:**  
- OAuth callbacks that write to `social_accounts` must set `company_id` from validated state/context.  
- All `social_accounts` reads must include `.eq('company_id', companyId)`.  
- `platformTokenService.resolveTokenFromSocialAccounts` must filter by `company_id` when available.

### Fix 2 — Encrypt `community_ai_platform_tokens` (G3.3)

**Option A:** Use tokenStore-style encryption before insert; store encrypted blob in `access_token`/`refresh_token` columns.  
**Option B:** Add encrypted columns (e.g. `access_token_encrypted`) and migrate.  
**Option C:** Store tokens in a separate encrypted store keyed by `(tenant_id, organization_id, platform)`.

### Fix 3 — Single Connect Entry Point (G1.5)

- **Option A:** Remove Header link to `/platform-configuration`; make Community AI → Connectors the only path. Redirect `/platform-configuration` → `/community-ai/connectors`.  
- **Option B:** Keep both; document `/community-ai/connectors` as canonical; add banner on `/platform-configuration` linking to Connectors.

### Fix 4 — Disconnect: Admin or Owner (G4.4)

- Add `connected_by_user_id` to `community_ai_platform_tokens` (or equivalent) to track who connected.  
- In DELETE handler: allow if `role === 'COMPANY_ADMIN'` OR `connected_by_user_id === access.userId`.  
- Until column exists: restrict disconnect to COMPANY_ADMIN only for org-level tokens.

### Fix 5 — Platform List for New Companies (G6.2, G6.3)

- Add `platform_oauth_configs` (or equivalent) for globally configured platforms.  
- `getCompanyConfiguredPlatformsForConnectors` should merge: (1) company-specific config, (2) **global enabled platforms** (from `platform_oauth_configs` or `.env` presence).  
- New company with no config should still see LinkedIn, Facebook, etc. if globally configured.

### Fix 6 — User-Friendly Callback Errors (G1.4)

- Replace `LinkedIn token exchange failed: ${errorText}` with a generic message, e.g. `Unable to connect. Please try again or contact support.`  
- Log `errorText` server-side only.

### Fix 7 — Audit Logging (G5.5)

- After connect (callback): log `(user_id, company_id, platform, 'connect')`.  
- After disconnect: log `(user_id, company_id, platform, 'disconnect')`.  
- Do not log tokens or credentials.

### Fix 8 — Token Refresh for `community_ai_platform_tokens` (G5.4)

- Implement refresh before expiry (similar to `tokenRefresh` for `social_accounts`).  
- Call before token use when `expires_at` is near.

---

## Phase 5 — Implementation Priority

| # | Fix | Rule(s) | Effort |
|---|-----|---------|--------|
| 1 | Add `company_id` to `social_accounts` + update reads/writes | G2.1, G2.2, G2.3 | High |
| 2 | Encrypt `community_ai_platform_tokens` | G3.3 | High |
| 3 | Single Connect entry point (remove/redirect platform-configuration) | G1.5 | Low |
| 4 | Disconnect: restrict to Company Admin or add owner check | G4.4 | Medium |
| 5 | Platform list from global config for new companies | G6.2, G6.3 | Medium |
| 6 | Sanitize callback error messages | G1.4 | Low |
| 7 | Add audit logging | G5.5 | Medium |
| 8 | Token refresh for community_ai_platform_tokens | G5.4 | Medium |

---

## Phase 6 — Audit Conclusion

**Overall:** The implementation partially meets governance rules. Critical gaps:

1. **Tenant isolation:** `social_accounts` lacks `company_id`; company scoping is inferred, not enforced at row level.  
2. **Token security:** `community_ai_platform_tokens` stores tokens in plaintext.  
3. **Entry points:** Two Connect UIs create confusion.  
4. **Onboarding:** New companies cannot connect without prior platform config.  
5. **Disconnect:** Any MANAGE_CONNECTORS user can disconnect; should be admin or owner only.  
6. **Observability:** No audit logging for connect/disconnect.

**Recommendation:** Implement fixes 1–6 before production release. Fixes 7–8 recommended for compliance and operations.

---

**End of Implementation Audit**
