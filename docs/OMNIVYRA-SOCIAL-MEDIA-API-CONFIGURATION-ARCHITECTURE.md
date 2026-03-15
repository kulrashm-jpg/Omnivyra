# OmniVyra Social Media API Configuration Architecture

**Document:** Principal SaaS platform architect design  
**Product:** OmniVyra  
**Objective:** Enable tenant companies to connect social media accounts in &lt;60 seconds with zero manual credential input  
**Status:** Architecture authority

---

## Design Principles

| Principle | Requirement |
|-----------|-------------|
| **Minimal effort** | New company connects a platform in under 60 seconds |
| **Zero credential input** | Customers never see or enter Client ID, Secret, or API keys |
| **Multi-tenant isolation** | Company A never sees Company B's connections or tokens |
| **OAuth compliance** | Platform policies (scopes, consent, revocation) enforced |
| **Secure token storage** | AES-256-GCM encryption at rest; never returned to client |
| **Scalability** | Support thousands of companies without per-company OAuth setup |

---

## Two-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 1 — Global Platform Configuration                                       │
│ • Configured once by system/support                                           │
│ • OAuth Client ID/Secret per platform                                         │
│ • Enabled platforms, scopes, callback URLs                                    │
│ • Source: platform_oauth_configs (or .env for bootstrap)                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ Used by all tenants
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 2 — Tenant Account Connection                                          │
│ • Per-company OAuth connections                                              │
│ • One-click Connect → OAuth → Callback → Token stored                         │
│ • No credentials; only user authorization                                    │
│ • Source: community_ai_platform_tokens, social_accounts                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key invariant:** Layer 1 is system-wide; Layer 2 is tenant-scoped. Tenants never touch Layer 1.

---

## PHASE 1 — Layer 1: Global Platform Configuration

### 1.1 Purpose

Provide OAuth credentials (Client ID, Secret) and platform metadata so every tenant can initiate OAuth without any per-company setup.

### 1.2 Configuration Sources (Priority Order)

| Priority | Source | Use Case |
|----------|--------|----------|
| 1 | `platform_oauth_configs` table | Production: system admin configures via UI or migration |
| 2 | `external_api_sources` (platform scope) | Per-platform config from Social Platforms catalog |
| 3 | `.env` (LINKEDIN_CLIENT_ID, etc.) | Bootstrap, development, or fallback |

### 1.3 Schema: `platform_oauth_configs`

```sql
CREATE TABLE IF NOT EXISTS platform_oauth_configs (
  platform VARCHAR(50) PRIMARY KEY,
  oauth_client_id TEXT,
  oauth_client_secret_encrypted TEXT,
  enabled BOOLEAN DEFAULT true,
  auth_url TEXT,
  token_url TEXT,
  scopes TEXT[],
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

| Column | Purpose |
|--------|---------|
| `platform` | Canonical key (linkedin, facebook, twitter, etc.) |
| `oauth_client_id` | OAuth 2.0 client ID (non-sensitive) |
| `oauth_client_secret_encrypted` | AES-256-GCM encrypted secret |
| `enabled` | Platform available for connect if true |
| `auth_url`, `token_url` | Override defaults per platform |
| `scopes` | Minimal required scopes |

### 1.4 Credential Resolution Flow

```
OAuth Start Request
       │
       ▼
┌──────────────────────┐
│ oauthCredentialResolver
│ getOAuthCredentialsForPlatform(platform, companyId?)
└──────────────────────┘
       │
       ├─► 1. platform_oauth_configs (enabled=true)
       ├─► 2. external_api_sources (platform scope)
       └─► 3. .env (LINKEDIN_CLIENT_ID, etc.)
       │
       ▼
Return { client_id, client_secret } (never to client)
```

### 1.5 Who Configures Layer 1

| Role | Access |
|------|--------|
| **System admin** | Create/update `platform_oauth_configs` |
| **Support** | Enable/disable platforms; system admin rotates secrets |
| **Tenant** | None; tenants only use Layer 2 |

---

## PHASE 2 — Layer 2: Tenant Account Connection

### 2.1 Purpose

Store per-tenant OAuth tokens after user authorizes. One connection per (company, platform) or per (company, user, platform) depending on model.

### 2.2 Storage Models

| Model | Table | Scope | Use Case |
|-------|-------|-------|----------|
| **Org-level** | `community_ai_platform_tokens` | (tenant_id, organization_id, platform) | Community AI connectors; shared company connection |
| **User-level** | `social_accounts` | (user_id, company_id, platform) | Per-user connection; publishing, engagement |

Both use encrypted tokens (G3.3). Both resolve credentials from Layer 1.

### 2.3 Schema: `community_ai_platform_tokens`

```sql
CREATE TABLE community_ai_platform_tokens (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  platform TEXT NOT NULL,
  access_token TEXT,           -- encrypted
  refresh_token TEXT,          -- encrypted
  expires_at TIMESTAMPTZ,
  connected_by_user_id UUID,   -- G2.4 owner
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

### 2.4 Schema: `social_accounts`

```sql
-- Key columns for tenant isolation
company_id UUID,        -- G2: tenant scope
user_id UUID,
platform TEXT,
access_token TEXT,      -- encrypted via tokenStore
refresh_token TEXT,
token_expires_at TIMESTAMPTZ
```

### 2.5 Who Uses Layer 2

| Role | Action |
|------|--------|
| **Company Admin** | Connect, disconnect any company connection |
| **Content Publisher** | Connect (MANAGE_CONNECTORS); disconnect own (G2.4) |
| **User** | Clicks Connect → OAuth → done |

---

## PHASE 3 — OAuth Flow

### 3.1 Single OAuth Sequence (&lt;60 seconds target)

```
User: Clicks "Connect LinkedIn"
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. Auth Start (API)                                               │
│    • Resolve client_id, client_secret from Layer 1               │
│    • Validate user in company (requireManageConnectors)           │
│    • Build state: { tenant_id, organization_id, redirect }      │
│    • Redirect to platform OAuth URL with state                    │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. User Authorizes on Platform (LinkedIn, etc.)                  │
│    • Platform redirects to callback with ?code=...&state=...     │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Callback (API)                                                 │
│    • Decode state; validate tenant_id, organization_id           │
│    • Re-validate session (requireManageConnectors)                │
│    • Exchange code for token (client_id, client_secret from L1)   │
│    • Encrypt tokens; save to Layer 2 (community_ai_platform_     │
│      tokens or social_accounts)                                  │
│    • Set connected_by_user_id (G2.4)                             │
│    • Redirect to Connect page with success                        │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Entry Points

| Path | Purpose |
|------|---------|
| `/community-ai/connectors` | Single connect UI (G1.5) |
| `/api/community-ai/connectors/{platform}/auth` | OAuth start |
| `/api/community-ai/connectors/{platform}/callback` | OAuth callback |

### 3.3 State Payload (Base64 JSON)

```json
{
  "tenant_id": "uuid",
  "organization_id": "uuid",
  "redirect": "/community-ai/connectors",
  "code_verifier": "..."  // PKCE if required (Twitter)
}
```

---

## PHASE 4 — Token Storage

### 4.1 Encryption (G3.3)

| Storage | Method |
|---------|--------|
| `community_ai_platform_tokens` | `credentialEncryption` (AES-256-GCM) |
| `social_accounts` | `tokenStore` (AES-256-GCM) |
| Key | `ENCRYPTION_KEY` (32-byte hex, server-only) |

### 4.2 Token Resolution

```
Service needs token for (organization_id, platform)
       │
       ├─► community_ai_platform_tokens (org-level)
       │      .eq('organization_id', org)
       │      .eq('platform', platform)
       │
       └─► social_accounts (user-level fallback)
              .in('user_id', users_in_org)
              .eq('company_id', org)  -- G2.3
```

### 4.3 Token Refresh (G5.4)

- **connectorTokenRefreshService**: Runs every 6h via cron
- Refreshes tokens in `community_ai_platform_tokens` when `expires_at` within 24h
- Uses platform-specific refresh endpoints; credentials from Layer 1

---

## PHASE 5 — Platform Abstraction

### 5.1 Platform Registry

| Platform | Auth URL | Token URL | Refresh Support |
|----------|----------|-----------|-----------------|
| linkedin | linkedin.com/oauth/v2/authorization | linkedin.com/oauth/v2/accessToken | Yes |
| twitter | api.twitter.com/2/oauth2/authorize | api.twitter.com/2/oauth2/token | Yes (PKCE) |
| facebook | facebook.com/v19.0/dialog/oauth | graph.facebook.com/oauth/access_token | Yes |
| instagram | (via Facebook) | (via Facebook) | Yes |
| reddit | reddit.com/api/v1/authorize | reddit.com/api/v1/access_token | Yes |

### 5.2 Abstraction Layer

```
┌─────────────────────────────────────┐
│ PlatformAdapter (per platform)       │
│ • getAuthUrl(state, scopes)          │
│ • exchangeCodeForToken(code, state)  │
│ • refreshToken(currentToken)         │
└─────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│ oauthCredentialResolver              │
│ • getOAuthCredentialsForPlatform()  │
└─────────────────────────────────────┘
```

Platform-specific logic (URLs, PKCE, scopes) encapsulated in adapters. Credentials always from Layer 1.

---

## PHASE 6 — Multi-Tenant Isolation

### 6.1 Isolation Rules

| Rule | Enforcement |
|------|-------------|
| **Read** | All token reads filter by `company_id` or `organization_id` |
| **Write** | Callbacks set `company_id`/`organization_id` from validated state |
| **Visibility** | Status API returns only data for user's selected company |
| **Disconnect** | Admin or owner only (G4.4, G2.4) |

### 6.2 Cross-Tenant Prevention

- State includes `organization_id`; callback validates user has active role in that company
- `requireManageConnectors(req, res, organizationId)` blocks invalid scope
- No union queries across companies; company selector required in UI

---

## PHASE 7 — Scalability

### 7.1 Design for Thousands of Companies

| Concern | Approach |
|---------|----------|
| **OAuth config** | One config per platform (Layer 1); no per-company OAuth |
| **Token storage** | Indexed by (organization_id, platform), (tenant_id, platform) |
| **Credential lookup** | Cached in memory or Redis; Layer 1 rarely changes |
| **Refresh job** | Batch by platform; rate-limit per platform API |
| **Connect page** | Platform list from Layer 1; no N+1 queries |

### 7.2 Connection Time Budget (&lt;60s)

| Step | Target | Notes |
|------|--------|-------|
| Page load | &lt;2s | Platform list from global config |
| Auth redirect | &lt;1s | Server-side redirect |
| User authorizes | 5–30s | User-dependent |
| Callback + save | &lt;3s | Token exchange + encrypted write |
| Redirect to UI | &lt;1s | Client redirect |

---

## Summary

| Component | Layer | Responsibility |
|-----------|-------|----------------|
| **platform_oauth_configs** | 1 | Global OAuth credentials; system admin only |
| **oauthCredentialResolver** | 1 | Resolve credentials for any tenant |
| **community_ai_platform_tokens** | 2 | Org-level tokens; encrypted |
| **social_accounts** | 2 | User-level tokens; company_id scoped |
| **OAuth auth/callback** | 2 | One-click flow; credentials from Layer 1 |
| **platformTokenService** | 2 | Save, get, revoke; encryption; owner tracking |
| **connectorTokenRefreshService** | 2 | Refresh tokens before expiry |

**Architecture certified:** Two-layer separation; zero tenant credential input; &lt;60s connect; multi-tenant isolation; G2–G6 compliant.

---

**End of Architecture Document**
