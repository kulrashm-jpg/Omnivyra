# Platform Config Audit: Per-Company OAuth & Adapter Configuration

**Purpose:** Audit current configuration and adapters to enable full platform API configuration through the Add Platform Config page (`/social-platforms`) for all companies, managed by company admins.

**Date:** 2025-03-12

---

## 1. Executive Summary

| Aspect | Current State | Target State |
|--------|---------------|--------------|
| **OAuth credentials** | Hardcoded in `.env.local` (global) | Per-company, stored via Platform Config UI |
| **Platform config UI** | Access token env name only | OAuth Client ID + Secret + access token options |
| **Company admin access** | `MANAGE_EXTERNAL_APIS` for COMPANY_ADMIN | Already supported; ensure consistency |
| **Adapter credential source** | `process.env` only | Platform config (DB) with env fallback |
| **Platform matching** | `category` or `name.ilike.%platform%` | Needs explicit `category` for reliable lookup |

---

## 2. Current Configuration Architecture

### 2.1 Credential Sources (Current)

| Component | Credential | Source | Scope |
|-----------|------------|--------|-------|
| **LinkedIn OAuth** | Client ID, Secret | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | Global (env) |
| **YouTube OAuth** | Client ID, Secret | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | Global (env) |
| **Facebook OAuth** | Client ID, Secret | `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` | Global (env) |
| **Token refresh (LinkedIn)** | Client ID, Secret | Same as above | Global (env) |
| **Token refresh (Facebook)** | App ID, Secret | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | **Inconsistent** – OAuth uses `*_CLIENT_*`, refresh uses `*_APP_*` |
| **Token refresh (YouTube)** | Client ID, Secret | Same as OAuth | Global (env) |
| **Platform config (Add Platform Config)** | Access token | `api_key_name` → `process.env[api_key_name]` | Per-company (if `company_id` set) |

### 2.2 OAuth Flow Locations

| Platform | Auth initiation | Callback | Token refresh | Company context |
|----------|-----------------|----------|---------------|-----------------|
| **LinkedIn** | `pages/api/auth/linkedin.ts` | `pages/api/auth/linkedin/callback.ts` | `tokenRefresh.refreshLinkedInToken` | None |
| **YouTube** | `pages/api/auth/youtube.ts` | `pages/api/auth/youtube/callback.ts` | `tokenRefresh.refreshYouTubeToken` | None |
| **Facebook (main)** | Not implemented (`/api/auth/facebook` 404) | — | `tokenRefresh.refreshFacebookToken` | None |
| **Community AI (LinkedIn, Facebook, Twitter, Instagram)** | `pages/api/community-ai/connectors/{platform}/auth.ts` | `.../callback.ts` | N/A (separate token store) | `tenant_id`, `organization_id` |

### 2.3 Platform Adapters (Publishing)

Publishing uses **user OAuth tokens** stored in `social_accounts` (encrypted via `tokenStore`), not platform config. The adapters receive `token` from the platform adapter layer:

- `backend/adapters/platformAdapter.ts` → routes to `linkedinAdapter`, `youtubeAdapter`, `facebookAdapter`, etc.
- Adapters use `socialAccount` + `token`; **no** `getApiConfigByPlatform` or platform config in this path.

**Separate path:** `socialPlatformPublisher` (super-admin publish API) uses `getApiConfigByPlatform(null, post.platform)` – but `companyId` is `null`, so it always returns `null` and the API key path does not function.

### 2.4 Platform Config Lookup

- **Table:** `external_api_sources`
- **Matching:** `getApiConfigByPlatform(companyId, platform)` uses:
  ```sql
  company_id = :companyId
  AND (category = :platform OR name ILIKE '%' || :platform || '%')
  ```
- **Current save behavior:** `social-platforms` form does **not** set `category`. Matching relies on `name` (e.g. "YouTube" for platform "youtube"). This can be brittle (e.g. "Linked In" vs "linkedin").

---

## 3. Add Platform Config Page – Current vs Required

### 3.1 Current Form Fields

| Field | Purpose | Used for OAuth? |
|-------|---------|-----------------|
| Platform (from registry) | Dropdown → `name`, `base_url` | No |
| API base URL / page ID | `base_url` | No |
| Access token env name | `api_key_name` | No – used for publishing access token only |
| Supported content types | `supported_content_types` | No |
| Promotion modes | `promotion_modes` | No |
| Required metadata | `required_metadata` | No |
| Posting constraints | `posting_constraints` | No |
| Active, Requires admin | `is_active`, `requires_admin` | No |

**Gap:** No fields for OAuth Client ID or Client Secret.

### 3.2 Required Additions for OAuth

| New field | Type | Description | Storage |
|-----------|------|-------------|--------|
| **OAuth Client ID** | Text (can be masked when editing) | OAuth app Client ID | Encrypted in DB or env name |
| **OAuth Client Secret** | Password | OAuth app Client Secret | Encrypted in DB or env name |
| **Platform key / category** | Hidden or derived | Canonical key for lookup (e.g. `youtube`, `linkedin`) | `category` column |

Optional: toggle “Use env var names instead of storing credentials” for backward compatibility.

### 3.3 Current Access Control

| Role | Can manage platform config? | Scope |
|------|-----------------------------|-------|
| **SUPER_ADMIN** | Yes | Platform-scoped (`scope=platform`, `company_id=null`) or any company |
| **COMPANY_ADMIN** | Yes (`MANAGE_EXTERNAL_APIS`) | Company-scoped (`companyId` from context) |
| **CAMPAIGN_ARCHITECT** | Yes per `ROLE-HIERARCHY` | Same as COMPANY_ADMIN |

The social-platforms page:
- Uses `selectedCompanyId` from `CompanyContext` when not super-admin.
- `buildExternalApisUrl()` returns `/api/external-apis?companyId=...` for company admins.
- `canManage = isAdmin || hasPermission('MANAGE_EXTERNAL_APIS')`.

Company admins can already manage configs for their company. No new permission changes needed for “company admin manages configs.”

---

## 4. Database Schema Gaps

### 4.1 `external_api_sources` – Current

Relevant columns:

- `api_key_name`, `api_key_env_name` – access token env var
- `company_id` – company scope
- `category` – used for platform matching (often null)
- `name` – display/label, used for fuzzy platform match

### 4.2 Required Additions

| Column | Type | Purpose |
|--------|------|---------|
| `oauth_client_id_encrypted` | TEXT | Encrypted OAuth Client ID |
| `oauth_client_secret_encrypted` | TEXT | Encrypted OAuth Client Secret |

Alternative: `oauth_client_id_env_name`, `oauth_client_secret_env_name` if env-based config is preferred (still requires many env vars per company).

**Recommendation:** Encrypted columns to support true per-company OAuth without `.env` proliferation.

---

## 5. Env Var Inconsistencies

| Platform | OAuth auth/callback | Token refresh |
|----------|---------------------|---------------|
| Facebook | `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` |
| Others | `*_CLIENT_ID`, `*_CLIENT_SECRET` | Same |

Unify Facebook to `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` everywhere, or document and support both sets for backward compatibility.

---

## 6. Credential Resolution Flow (Proposed)

```
1. User/company initiates OAuth (e.g. Connect LinkedIn for Company X)
   → Auth URL includes companyId in state

2. Callback receives code + state
   → Decode companyId from state
   → getOAuthCredentialsForPlatform(companyId, 'linkedin')
   → Returns { client_id, client_secret } from:
      a) external_api_sources (decrypt if stored), or
      b) process.env fallback

3. Token refresh
   → Derive companyId from scheduled_post → campaign → user → company
   → getOAuthCredentialsForPlatform(companyId, platform)
   → Use for refresh
```

Challenge: `social_accounts` and token refresh are user-scoped. To refresh with company credentials, we need to associate the account with a company. Options:

- Store `company_id` or `source_company_id` on `social_accounts` when connecting.
- Or: resolve company from the campaign/user that owns the post being published.

---

## 7. Platform Matching Reliability

Current matching can fail if:

- `name` does not contain platform key (e.g. "Linked In" vs "linkedin").
- `category` is null and `name` is non-standard.

**Recommendation:** When saving from registry, set `category = selectedPlatformKey` (e.g. `youtube`, `linkedin`). Ensure `handlePlatformSelect` and the save payload include `category`.

---

## 8. Files to Modify (Implementation Checklist)

### 8.1 Database

| File | Change |
|------|--------|
| New migration | Add `oauth_client_id_encrypted`, `oauth_client_secret_encrypted` to `external_api_sources` |

### 8.2 UI

| File | Change |
|------|--------|
| `pages/social-platforms.tsx` | Add OAuth Client ID, Client Secret fields; set `category` from `selectedPlatformKey` on save |

### 8.3 API

| File | Change |
|------|--------|
| `pages/api/external-apis/index.ts` | Accept and persist new OAuth fields |
| `pages/api/external-apis/[id].ts` | Same for PUT |
| `backend/services/externalApiService.ts` | Handle encrypt/decrypt in save and read paths |

### 8.4 New Service

| File | Purpose |
|------|---------|
| `backend/auth/oauthCredentialResolver.ts` | `getOAuthCredentialsForPlatform(companyId, platform)` with decrypt + env fallback |

### 8.5 OAuth Flows

| File | Change |
|------|--------|
| `pages/api/auth/linkedin.ts` | Accept `companyId`, encode in state, use credential resolver |
| `pages/api/auth/linkedin/callback.ts` | Decode companyId, use resolver |
| `pages/api/auth/youtube.ts` | Same pattern |
| `pages/api/auth/youtube/callback.ts` | Same pattern |
| `pages/api/community-ai/connectors/facebook/auth.ts` | Use resolver with `organization_id` |
| `pages/api/community-ai/connectors/facebook/callback.ts` | Same |
| (Similar updates for LinkedIn, Twitter, Instagram Community AI connectors) | Same |

### 8.6 Token Refresh

| File | Change |
|------|--------|
| `backend/auth/tokenRefresh.ts` | Derive companyId where possible; use credential resolver for LinkedIn, YouTube, Facebook |
| `backend/adapters/platformAdapter.ts` | Pass companyId into refresh path if available |

### 8.7 Connect UX

| File | Change |
|------|--------|
| Connect buttons / OAuth entry points | Pass `companyId` (e.g. from CompanyContext) into auth URLs |

---

## 9. Risk & Migration Notes

| Risk | Mitigation |
|------|------------|
| Breaking existing OAuth | Env fallback when platform config has no OAuth credentials |
| Token refresh without companyId | Fall back to `process.env` when companyId cannot be resolved |
| Encrypted storage | Reuse `tokenStore` encryption or equivalent AES-256-GCM |
| Super-admin vs company scope | Super-admin can create platform-scoped configs (`company_id=null`); company admins create company-scoped configs |

---

## 10. Summary: Audit Findings

1. **OAuth credentials** – All OAuth flows use global env vars; token refresh uses the same (with a Facebook naming inconsistency).
2. **Add Platform Config** – Only supports access token env name; no OAuth Client ID/Secret fields.
3. **Company admin access** – Already in place via `MANAGE_EXTERNAL_APIS` and company-scoped API usage.
4. **Platform matching** – Relies on `name`; adding `category` from registry will improve reliability.
5. **Publishing adapters** – Use user tokens from `social_accounts`; no platform config changes required there.
6. **Gaps to close** – DB columns for OAuth credentials, new resolver service, wiring OAuth flows and token refresh to platform config, and UI fields for Client ID/Secret.
