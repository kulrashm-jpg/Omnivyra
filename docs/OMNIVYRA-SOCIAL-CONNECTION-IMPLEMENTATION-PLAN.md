# OmniVyra Social Platform Connection — Implementation Plan

**Document:** Implementation plan for one-click social platform connection  
**Product:** OmniVyra  
**Based on:** `OMNIVYRA-SOCIAL-CONNECTION-ARCHITECTURE-CONFIRMATION.md`

---

## Phase 1 — Final Architecture Decision

**Model:** Global Platform Config + Tenant Account Connection

```
System Admin (once)     →  Configure OAuth credentials
Company Users          →  Click "Connect LinkedIn / Facebook / etc"
OAuth Flow             →  Tokens saved (company_id + user_id)
Publishing + Engagement → Use stored tokens automatically
```

**Principle:** Users **never** enter API credentials.

---

## Phase 2 — Platform Configuration Layer

Use a **global configuration table** for OAuth credentials.

### 2.1 Create `platform_oauth_configs` (recommended name)

```sql
-- database/platform_oauth_configs.sql
-- Global OAuth credentials for social platforms. System admin configures once.
-- Run after: companies, external_api_sources (for reference)

CREATE TABLE IF NOT EXISTS platform_oauth_configs (
    platform VARCHAR(50) PRIMARY KEY,
    oauth_client_id_encrypted TEXT NOT NULL,
    oauth_client_secret_encrypted TEXT NOT NULL,
    enabled BOOLEAN DEFAULT true,
    oauth_authorize_url TEXT,
    oauth_token_url TEXT,
    oauth_scopes TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE platform_oauth_configs IS 'Global OAuth credentials for social platforms. Only system admin configures.';

CREATE INDEX IF NOT EXISTS idx_platform_oauth_configs_enabled
    ON platform_oauth_configs(enabled) WHERE enabled = true;

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_platform_oauth_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_platform_oauth_configs_updated_at ON platform_oauth_configs;
CREATE TRIGGER update_platform_oauth_configs_updated_at
    BEFORE UPDATE ON platform_oauth_configs
    FOR EACH ROW EXECUTE FUNCTION update_platform_oauth_configs_updated_at();
```

### 2.2 Credential Resolution Order

Resolve OAuth credentials in this priority:

1. **`platform_oauth_configs`** (global) — if row exists and credentials non-empty
2. **`external_api_sources`** (per-company) — if company has custom config
3. **`.env`** — fallback for backward compatibility

Update `oauthCredentialResolver.ts` to check `platform_oauth_configs` first when `companyId` is omitted or for platform-scoped lookup.

### 2.3 Platform List for Connect UI

```sql
-- Platforms available for connection (enabled + has credentials)
SELECT platform
FROM platform_oauth_configs
WHERE enabled = true
  AND oauth_client_id_encrypted IS NOT NULL
  AND oauth_client_secret_encrypted IS NOT NULL;
```

---

## Phase 3 — Tenant Account Connection Layer

### 3.1 Add `company_id` to `social_accounts`

```sql
-- database/patch-social-accounts-company-id.sql

ALTER TABLE social_accounts
    ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_social_accounts_company_id
    ON social_accounts(company_id);

-- Unique constraint: one connection per (user, company, platform, platform_user_id)
-- Drop old unique if exists, add new
ALTER TABLE social_accounts DROP CONSTRAINT IF EXISTS social_accounts_user_id_platform_platform_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_accounts_user_company_platform
    ON social_accounts(COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
                       COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
                       platform,
                       platform_user_id);

-- For rows where company_id is NULL, optionally backfill from user's primary company
-- (Run as separate migration if backfill logic needed)
```

### 3.2 Token Isolation Rules

All queries that read or write `social_accounts` must include:

- `company_id = :companyId` (from session/context)
- `user_id = :userId` (for user-scoped operations)

---

## Phase 4 — OAuth Endpoints

### 4.1 Unified Route Pattern

For each platform, implement (or map existing):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/oauth/{platform}/start` | GET | Redirect to platform OAuth; include `companyId` in state |
| `/api/oauth/{platform}/callback` | GET | Exchange code, save to `social_accounts`, redirect to Connect page |

**Query params for start:**

- `companyId` (required) — tenant context
- `redirect` (optional) — return URL after callback

### 4.2 Start Endpoint Logic

```
1. Validate companyId (user has access)
2. Resolve OAuth credentials from platform_oauth_configs (or fallback)
3. Build state: base64(JSON({ companyId, redirect, nonce }))
4. Redirect to platform authorize URL with client_id, redirect_uri, scope, state
```

### 4.3 Callback Endpoint Logic

```
1. Parse state, validate nonce
2. Exchange code for tokens
3. Fetch platform user profile
4. Upsert social_accounts (user_id, company_id, platform, platform_user_id, ...)
5. Save tokens via tokenStore (encrypted)
6. Redirect to Connect page with success
```

### 4.4 Platform Mapping

| Platform | Start | Callback |
|----------|-------|----------|
| LinkedIn | `/api/oauth/linkedin/start` | `/api/oauth/linkedin/callback` |
| Facebook | `/api/oauth/facebook/start` | `/api/oauth/facebook/callback` |
| Instagram | `/api/oauth/instagram/start` | `/api/oauth/instagram/callback` |
| Twitter/X | `/api/oauth/twitter/start` | `/api/oauth/twitter/callback` |
| YouTube | `/api/oauth/youtube/start` | `/api/oauth/youtube/callback` |
| Reddit | `/api/oauth/reddit/start` | `/api/oauth/reddit/callback` |

**Implementation note:** Existing `/api/auth/{platform}` and `/api/community-ai/connectors/{platform}/auth` can remain; add `/api/oauth/*` as the canonical Connect flow and optionally redirect old routes.

---

## Phase 5 — Remove Unnecessary User Input

### 5.1 UI Changes

- **Connect Accounts page:** Remove any form fields for Client ID, Client Secret, API base URL, access token env names.
- **Social Platform Settings (admin):** Keep OAuth credential configuration for system admin only; hide from regular users.
- **Platform Configuration:** Ensure only "Connect" button is visible for users.

### 5.2 Backend Enforcement

- Reject any user-submitted OAuth credentials in API requests.
- Credentials only from `platform_oauth_configs`, `external_api_sources`, or `.env`.

---

## Phase 6 — Platform List Generation (Connect UI)

### 6.1 API Endpoint

```
GET /api/oauth/platforms
Query: companyId (required)
Response: { platforms: [{ platform, displayName, status, expiresAt }] }
```

**Logic:**

1. Resolve platforms from `platform_oauth_configs WHERE enabled = true` (or fallback per architecture doc).
2. For each platform, check `social_accounts` for existing connection (user_id + company_id).
3. Return list with status (connected / not connected) and expires_at.

### 6.2 Connect Page Query

Connect page calls this API to render the platform table. No manual platform selection by user.

---

## Phase 7 — Connect Accounts UI

### 7.1 Location

**Primary:** Community AI → Connect Accounts (`/community-ai/connectors` or dedicated `/connect-accounts`)

### 7.2 Layout

| Platform | Status | Expires | Action |
|----------|--------|---------|--------|
| LinkedIn | Connected | 2026-02-01 | Reconnect |
| Facebook | Not connected | — | Connect |
| Instagram | Connected | 2026-01-15 | Reconnect |
| Twitter | Not connected | — | Connect |
| YouTube | Not connected | — | Connect |
| Reddit | Not connected | — | Connect |

### 7.3 User Flow

1. User selects company (if multi-company).
2. User opens Connect Accounts.
3. System loads platforms from `GET /api/oauth/platforms?companyId=...`.
4. User clicks **Connect {Platform}** → `GET /api/oauth/{platform}/start?companyId=...`.
5. OAuth redirect → user authorizes → callback → redirect back with success.
6. Page refreshes; status shows "Connected".

---

## Phase 8 — Multi-Tenant Token Isolation

### 8.1 Rules

- **Write:** Always set `company_id` when inserting/updating `social_accounts`.
- **Read:** Always filter by `company_id` (and `user_id` where user-scoped).
- **API:** Resolve `companyId` from session/JWT/selectedCompanyId; reject requests without valid company context.

### 8.2 Audit Points

- OAuth start: validate user has access to `companyId`.
- OAuth callback: persist `company_id` from state.
- Token fetch: filter by `company_id`.
- Publishing/engagement: use tokens only for same `company_id`.

---

## Phase 9 — Engagement Pipeline Activation

### 9.1 Publishing

- Scheduled posts → resolve `social_account_id` → fetch token from tokenStore.
- Ensure `social_accounts.company_id` matches campaign/company context.

### 9.2 Ingestion

- Polling job: query `social_accounts` where `company_id = :companyId` and `is_active = true`.
- Use tokens to fetch engagement (likes, comments, shares).

### 9.3 Community AI Actions

- If unified: use `social_accounts` for engagement actions.
- If keeping `community_ai_platform_tokens`: document when each is used; avoid duplicate token storage for same platform.

---

## Phase 10 — Implementation Checklist (Ordered)

| # | Task | File(s) | Priority |
|---|------|---------|----------|
| 1 | Create `platform_oauth_configs` table | `database/platform_oauth_configs.sql` | P0 |
| 2 | Add `company_id` to `social_accounts` | `database/patch-social-accounts-company-id.sql` | P0 |
| 3 | Update oauthCredentialResolver to check platform_oauth_configs | `backend/auth/oauthCredentialResolver.ts` | P0 |
| 4 | Create GET /api/oauth/platforms | `pages/api/oauth/platforms.ts` | P0 |
| 5 | Create /api/oauth/{platform}/start for LinkedIn | `pages/api/oauth/linkedin/start.ts` | P0 |
| 6 | Create /api/oauth/{platform}/callback for LinkedIn | `pages/api/oauth/linkedin/callback.ts` | P0 |
| 7 | Update LinkedIn callback to set company_id | Callback handler | P0 |
| 8 | Update Connect Accounts UI to use new OAuth URLs | `pages/community-ai/connectors.tsx` or Connect page | P0 |
| 9 | Remove user credential input from Connect UI | Connect page components | P1 |
| 10 | Replicate start/callback for Facebook, Instagram, Twitter, YouTube, Reddit | `pages/api/oauth/{platform}/` | P1 |
| 11 | Add platform_oauth_configs admin UI (system admin only) | New or extend Social Platform Settings | P2 |
| 12 | Seed platform_oauth_configs from .env for migration | Migration script | P2 |
| 13 | Audit token read paths for company_id filter | tokenStore, services | P1 |
| 14 | Verify engagement pipeline uses social_accounts with company_id | Engagement services | P1 |

---

## Phase 11 — Migration Strategy

### 11.1 Backward Compatibility

- Keep `.env` as fallback until `platform_oauth_configs` is populated.
- Keep existing `/api/auth/*` routes working; add `/api/oauth/*` as preferred.
- For `social_accounts` without `company_id`: backfill from `user_company_roles` (user's primary company) or leave NULL for legacy rows; new connections always set `company_id`.

### 11.2 Rollout

1. Deploy database migrations (platform_oauth_configs, social_accounts.company_id).
2. Deploy credential resolver update.
3. Deploy new OAuth routes for LinkedIn first; test end-to-end.
4. Wire Connect UI to new routes.
5. Extend to other platforms.
6. Deprecate user credential input in UI.

---

## Phase 12 — Summary

| Component | Implementation |
|-----------|----------------|
| **Platform config** | `platform_oauth_configs` table; admin populates once |
| **Account storage** | `social_accounts` with `company_id`; tokens via tokenStore |
| **OAuth flow** | `/api/oauth/{platform}/start` + `/api/oauth/{platform}/callback` |
| **Connect UI** | Community AI → Connect Accounts; platform list from API; one-click Connect |
| **Token isolation** | All ops scoped by `company_id` + `user_id` |
| **User experience** | No credential input; single click to connect |

---

*End of Implementation Plan*
