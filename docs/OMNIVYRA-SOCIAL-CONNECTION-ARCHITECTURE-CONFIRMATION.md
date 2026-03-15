# OmniVyra Social Platform Connection — Architecture Confirmation

**Document:** Architecture confirmation for multi-tenant SaaS social media connection  
**Product:** OmniVyra  
**Date:** March 2025

---

## Chosen Architecture

**Global platform config + tenant account connection** (SaaS best practice)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ SYSTEM ADMIN (one-time)                                                   │
│  • Configures OAuth Client ID/Secret per platform                         │
│  • Stored in platform-level config (system/tenant)                         │
│  • Users NEVER see or enter credentials                                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ USER FLOW (per company)                                                   │
│  • Opens Community AI → Connect Accounts                                   │
│  • Clicks "Connect LinkedIn" / "Connect Facebook" / etc.                    │
│  • OAuth redirect → user authorizes → callback saves to social_accounts     │
│  • Tokens scoped by company_id + user_id                                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ DOWNSTREAM USE                                                             │
│  • Publishing: social_accounts.id → platform API                          │
│  • Engagement: platform tokens from social_accounts                         │
│  • Ingestion: polling jobs use tokens                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Current State vs Target State

### Layer 1: Platform Configuration (OAuth credentials)

| Aspect | Current | Target |
|--------|---------|--------|
| **Storage** | `external_api_sources` (per-company: `oauth_client_id_encrypted`, `oauth_client_secret_encrypted`) + `.env` fallback | Single source: global `platform_configs` or `.env` |
| **Who configures** | Admin per company (Social Platform Settings) | System admin once (global) |
| **Table** | `external_api_sources` with `company_id` nullable; OAuth in encrypted columns | `platform_configs` with `platform`, `oauth_client_id`, `oauth_client_secret`, `enabled` |

### Layer 2: Account Connection (user tokens)

| Aspect | Current | Target |
|--------|---------|--------|
| **Table** | `social_accounts` (user_id, platform, ...) **no company_id** | `social_accounts` with `company_id` |
| **Alternative** | `community_ai_platform_tokens` (tenant/org level) | Consolidate into `social_accounts` or keep both with clear separation |
| **OAuth routes** | `/api/auth/{platform}` + `/api/community-ai/connectors/{platform}/auth` | Single flow: `/api/oauth/{platform}/start` + `/api/oauth/{platform}/callback` |
| **Token scope** | user_id only (social_accounts) or tenant_id (community_ai) | (user_id, company_id) for multi-tenant isolation |

---

## Required Database Tables

### 1. `platform_configs` (global OAuth config — optional extension)

Use when moving to global config instead of per-company:

```sql
CREATE TABLE IF NOT EXISTS platform_configs (
    platform VARCHAR(50) PRIMARY KEY,
    oauth_client_id TEXT,
    oauth_client_secret TEXT,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

**Note:** Current system uses `external_api_sources` (per-company) and `.env`. For pure SaaS, prefer global `platform_configs` populated by system admin; per-company override remains possible via `external_api_sources`.

### 2. `platform_configurations` (exists today)

- **Purpose:** Platform limits (posting, content, media) — NOT OAuth credentials.
- **Columns:** `platform`, `is_enabled`, `posting_limits`, `content_limits`, `media_limits`, `api_configuration`.
- **OAuth:** Not stored here.

### 3. `social_accounts` (user account tokens — required changes)

**Current schema:**
```sql
CREATE TABLE social_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    platform VARCHAR(50) NOT NULL,
    platform_user_id VARCHAR(255) NOT NULL,
    account_name VARCHAR(255) NOT NULL,
    username VARCHAR(255),
    access_token TEXT,        -- via tokenStore (encrypted at rest)
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    ...
);
```

**Required addition:**
```sql
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_social_accounts_company_id ON social_accounts(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_accounts_user_company_platform
  ON social_accounts(user_id, company_id, platform, platform_user_id);
```

**Multi-tenant isolation:** All reads/writes must filter by `company_id` (and `user_id` where appropriate).

### 4. `community_ai_platform_tokens` (exists today)

- **Purpose:** Tenant/org-level tokens for Community AI engagement (separate flow).
- **Columns:** `tenant_id`, `organization_id`, `platform`, `access_token`, `refresh_token`, `expires_at`.
- **Decision:** Either consolidate with `social_accounts` (add company_id) or keep both with documented roles:
  - `social_accounts`: user-level publishing/scheduling
  - `community_ai_platform_tokens`: org-level engagement actions

---

## OAuth Endpoints

### Target (unified flow)

| Platform | Start | Callback |
|----------|-------|----------|
| LinkedIn | `GET /api/oauth/linkedin/start` | `GET /api/oauth/linkedin/callback` |
| Twitter/X | `GET /api/oauth/twitter/start` | `GET /api/oauth/twitter/callback` |
| Facebook | `GET /api/oauth/facebook/start` | `GET /api/oauth/facebook/callback` |
| Instagram | `GET /api/oauth/instagram/start` | `GET /api/oauth/instagram/callback` |
| YouTube | `GET /api/oauth/youtube/start` | `GET /api/oauth/youtube/callback` |
| Reddit | `GET /api/oauth/reddit/start` | `GET /api/oauth/reddit/callback` |

### Current (split flows)

| Purpose | Auth start | Callback | Token storage |
|---------|------------|----------|---------------|
| Scheduling / Publishing | `/api/auth/linkedin` | `/api/auth/linkedin/callback` | `social_accounts` |
| Community AI | `/api/community-ai/connectors/linkedin/auth` | `/api/community-ai/connectors/linkedin/callback` | `community_ai_platform_tokens` |

**Implementation options:**
1. **Unify:** Introduce `/api/oauth/{platform}/start` and `/api/oauth/{platform}/callback` that write to `social_accounts` with `company_id`.
2. **Keep both:** Preserve existing routes; ensure UI points to one primary Connect flow and clearly document each path.

---

## Callback Implementation (per platform)

Each callback must:

1. Exchange authorization code for access/refresh tokens.
2. Fetch user profile from platform API.
3. Insert/update `social_accounts`:

```sql
INSERT INTO social_accounts (
    user_id,
    company_id,
    platform,
    platform_user_id,
    account_name,
    username,
    access_token,      -- or use tokenStore.setToken(accountId, tokenObj)
    refresh_token,
    token_expires_at,
    is_active
) VALUES (
    :user_id,
    :company_id,
    :platform,
    :platform_user_id,
    :account_name,
    :username,
    :access_token,
    :refresh_token,
    :expires_at,
    true
)
ON CONFLICT (user_id, company_id, platform, platform_user_id) DO UPDATE SET
    access_token = EXCLUDED.access_token,
    refresh_token = EXCLUDED.refresh_token,
    token_expires_at = EXCLUDED.token_expires_at,
    is_active = true,
    updated_at = now();
```

**Note:** Current system stores tokens via `tokenStore.setToken(accountId, tokenObj)` (encrypted). Continue using tokenStore; do not store raw tokens in `access_token`/`refresh_token` columns if encryption is required.

---

## Platform List Generation (Connect UI)

Connect Accounts page shows only platforms where OAuth is configured and enabled.

**Option A — Using `platform_configs` (new):**
```sql
SELECT platform FROM platform_configs WHERE enabled = true;
```

**Option B — Using `external_api_sources` (current):**
```sql
SELECT DISTINCT name FROM external_api_sources
WHERE is_active = true
  AND (oauth_client_id_encrypted IS NOT NULL OR :env_has_credentials)
  AND (company_id = :company_id OR company_id IS NULL);
```

**Option C — Using `.env` + registry:**
- If `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` exist → show LinkedIn.
- Extend for other platforms.

---

## Remove Unnecessary User Input

Users must NOT enter:

- Client ID  
- Client Secret  
- API base URL  
- Access token env names  

These belong only in **admin/system configuration**. The user flow is: **click Connect Platform** → OAuth redirect → authorize → done.

---

## Multi-Tenant Token Isolation

All token operations must be scoped by:

- `company_id`
- `user_id` (for user-level accounts)

Never store or query tokens globally without these filters. All APIs that return or use tokens must enforce company context (e.g. from `selectedCompanyId`, JWT, or session).

---

## Connect Accounts UI

### Layout

| Platform | Status | Expires | Action |
|----------|--------|---------|--------|
| LinkedIn | Connected | 2026-02-01 | Reconnect |
| Facebook | Not connected | — | Connect |
| Instagram | Connected | 2026-01-15 | Reconnect |
| Twitter | Not connected | — | Connect |

### User flow

1. User opens **Community AI → Connect Accounts** (or equivalent entry point).
2. System lists platforms from enabled config (see Platform List Generation).
3. User clicks **Connect {Platform}**.
4. Browser navigates to `GET /api/oauth/{platform}/start?companyId={id}`.
5. Redirect to platform OAuth.
6. User authorizes.
7. Redirect to `GET /api/oauth/{platform}/callback?code=...&state=...`.
8. Callback exchanges code, fetches profile, saves to `social_accounts` with `company_id`.
9. Redirect to Connect Accounts page with success message.

---

## Engagement Pipeline Activation

Once an account exists in `social_accounts`:

- **Publishing:** Uses `social_accounts.id` to resolve tokens for posting.
- **Ingestion:** Polling job reads published posts and fetches engagement using tokens from `social_accounts`.
- **Engagement actions:** Community AI can use either `social_accounts` (if unified) or `community_ai_platform_tokens` (if kept separate).

---

## Implementation Checklist

| # | Item | Status |
|---|------|--------|
| 1 | `platform_configs` or equivalent for OAuth credentials | Use `external_api_sources` + `.env` or add `platform_configs` |
| 2 | `social_accounts.company_id` column | **Add** |
| 3 | OAuth routes `/api/oauth/{platform}/start` and `/api/oauth/{platform}/callback` | Implement or map existing `/api/auth/*` to unified flow |
| 4 | social_accounts insert/upsert with `company_id` | **Update** callbacks |
| 5 | Connect button triggers OAuth flow | Wire UI to OAuth start URL |
| 6 | Tokens saved after callback (encrypted via tokenStore) | **Verify** |
| 7 | Connect page shows only enabled platforms | Query from config |
| 8 | Users do not enter Client ID/Secret | Enforce in UI and backend |
| 9 | Multi-tenant isolation (company_id + user_id) | Enforce in all token reads |

---

## Summary

| Component | Decision |
|-----------|----------|
| **Architecture** | Global platform config + tenant account connection |
| **OAuth credentials** | Admin-only; per-company (`external_api_sources`) or global (`platform_configs` / `.env`) |
| **Account tokens** | `social_accounts` with `company_id`; encrypted via tokenStore |
| **OAuth endpoints** | `/api/oauth/{platform}/start` and `/api/oauth/{platform}/callback` (or keep `/api/auth/*` with same behavior) |
| **Connect UI** | Community AI → Connect Accounts; platform list from config; one-click Connect per platform |
| **Token isolation** | Always scope by `company_id` and `user_id` |

Users connect platforms with one click. OAuth credentials stay in admin configuration. Tokens are stored and used with proper multi-tenant isolation.
