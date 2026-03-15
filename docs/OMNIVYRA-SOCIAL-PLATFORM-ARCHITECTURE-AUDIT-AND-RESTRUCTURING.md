# OmniVyra Social Platform Integration — Complete Audit and Restructuring Plan

**Document:** Full audit and SaaS-compliant architecture redesign  
**Role:** Senior SaaS Platform Architect / Systems Auditor  
**Date:** March 2025

---

## Executive Summary

The current social platform integration system has **architectural violations** that prevent a clean SaaS model. This audit identifies all components, violations, and provides a restructuring plan to achieve:

- **Super Admin** manages global OAuth configuration only
- **Tenant companies** connect accounts via OAuth login only (no credential input)
- **Single Connect Accounts page** (Community AI → Connect Accounts)
- **Clean, maintainable architecture** for thousands of companies

---

## PHASE 1 — Complete Dependency Map

### 1.1 Database Tables

| Table | Purpose | Token/OAuth? | Company-Scoped? |
|-------|---------|--------------|-----------------|
| **social_accounts** | User-level connected accounts (user_id, platform). Used for publish (queue + platformAdapter), engagement ingestion. | Yes — access_token, refresh_token via tokenStore (encrypted) | Yes (company_id added in patch) |
| **community_ai_platform_tokens** | Tenant/org-level tokens for Community AI actions (reply, like, share, follow). | Yes — access_token, refresh_token (encrypted via credentialEncryption) | Yes (tenant_id, organization_id) |
| **external_api_sources** | API registry (base_url, auth, purpose). Can store **oauth_client_id_encrypted**, **oauth_client_secret_encrypted** per company. | OAuth app credentials (per company) | Optional (company_id nullable) |
| **platform_connectors** | Organization-level platform config (platform_key, organization_id, active). Links to platform_registry. | No | Yes |
| **scheduled_posts** | References social_account_id (social_accounts). | No | Via campaign/company |
| **companies** | Company profile; may have social_links. | No | Yes |

### 1.2 OAuth API Routes

| Route | Target Table | Credential Source | Caller |
|-------|--------------|-------------------|--------|
| `GET /api/auth/linkedin` | social_accounts | oauthCredentialResolver (external_api_sources + env) | Legacy |
| `GET /api/auth/linkedin/callback` | social_accounts + tokenStore | oauthCredentialResolver | Legacy |
| `GET /api/auth/twitter`, callback | social_accounts | process.env (TWITTER_CLIENT_ID, etc.) | Legacy |
| `GET /api/auth/instagram`, callback | social_accounts | process.env | Legacy |
| `GET /api/auth/youtube`, callback | social_accounts | oauthCredentialResolver | Legacy |
| `GET /api/auth/tiktok/callback` | social_accounts | process.env | Legacy |
| `GET /api/auth/spotify/callback` | social_accounts | process.env | Legacy |
| `GET /api/auth/pinterest/callback` | social_accounts | process.env | Legacy |
| `GET /api/community-ai/connectors/{platform}/auth` | — | process.env (LINKEDIN_CLIENT_ID, etc.) | Community AI |
| `GET /api/community-ai/connectors/{platform}/callback` | community_ai_platform_tokens | process.env | Community AI |
| `DELETE /api/community-ai/connectors/[platform]` | community_ai_platform_tokens (revoke) | — | Community AI |
| `GET /api/community-ai/connectors/status` | platformTokenService (community_ai + social_accounts fallback) | — | Connectors UI |
| `GET /api/social/linkedin/auth`, callback | — | process.env | Alternate path |

### 1.3 UI Pages

| Page | Path | Purpose | Violation? |
|------|------|---------|------------|
| **Connect Accounts (Connectors)** | `/community-ai/connectors` | Single Connect UI; OAuth connect/disconnect. | No — canonical |
| **Platform Configuration** | `/platform-configuration` | Redirects to `/community-ai/connectors`. | No — redirect only |
| **Social Platforms** | `/social-platforms` | Tenant config: base_url, **oauth_client_id**, **oauth_client_secret**, api_key, etc. | **Yes** — tenant enters OAuth credentials |
| **Creative Scheduler** | `/creative-scheduler` | Has "Connect Account" buttons → `/api/auth/{platform}`. | Mixed — uses legacy social_accounts flow |
| **External APIs** | `/external-apis` | API catalog; allows OAuth credentials per API. | **Yes** — tenant can add oauth_client_id/secret |

### 1.4 Token Storage Locations

| Location | Table | Encryption | Used By |
|----------|-------|------------|---------|
| tokenStore | social_accounts | AES-256-GCM (credentialEncryption) | platformAdapter, engagement ingestion, tokenRefresh |
| platformTokenService | community_ai_platform_tokens | AES-256-GCM (credentialEncryption) | Community AI connectors, communityAiActionExecutor, connectorTokenRefresh |
| oauthCredentialResolver | external_api_sources | Decrypts oauth_client_id_encrypted, oauth_client_secret_encrypted | /api/auth/linkedin, youtube (oauthCredentialResolver) |

### 1.5 Places Where Client ID/Secret Are Read

| File | Source | Usage |
|------|--------|-------|
| `backend/auth/oauthCredentialResolver.ts` | external_api_sources (decrypt) OR process.env | getOAuthCredentialsForPlatform(companyId, platform) |
| `pages/api/auth/linkedin.ts`, callback | oauthCredentialResolver | OAuth start + token exchange |
| `pages/api/auth/youtube.ts`, callback | oauthCredentialResolver | OAuth start + token exchange |
| `pages/api/community-ai/connectors/*/auth.ts` | process.env (LINKEDIN_CLIENT_ID, etc.) | OAuth redirect |
| `pages/api/community-ai/connectors/*/callback.ts` | process.env | Token exchange |
| `pages/api/social/linkedin/auth.ts`, callback | process.env | Alternate LinkedIn flow |
| `backend/services/connectorTokenRefreshService.ts` | process.env | Token refresh |
| `backend/auth/tokenRefresh.ts` | process.env | social_accounts token refresh |
| `backend/services/externalApiService.ts` | external_api_sources (oauth_client_id_encrypted) | getApiConfigByPlatform; used by socialPlatformPublisher |
| `pages/api/external-apis/index.ts` | User input (oauth_client_id, oauth_client_secret) → encrypt → external_api_sources | Tenant can add OAuth credentials |
| `pages/social-platforms.tsx` | User input (oauth_client_id, oauth_client_secret) | Tenant enters OAuth in form |

---

## PHASE 2 — Architectural Violations

| # | Violation | Severity | File(s) |
|---|-----------|----------|---------|
| V1 | **Tenant admin enters OAuth credentials** | Critical | `pages/social-platforms.tsx` (lines 40–45, 563–574) — form fields oauth_client_id, oauth_client_secret |
| V2 | **Tenant can add OAuth credentials via External APIs** | Critical | `pages/api/external-apis/index.ts` (lines 413–430, 462–463) — accepts oauth_client_id, oauth_client_secret |
| V3 | **OAuth configuration stored per company** | High | `external_api_sources` has company_id + oauth_client_id_encrypted, oauth_client_secret_encrypted |
| V4 | **Multiple Connect UIs** | Medium | `/platform-configuration` (redirects), `/community-ai/connectors`, `/creative-scheduler` has connect buttons, `/social-platforms` links to connectors but also config |
| V5 | **Platform configuration mixed with account connection** | High | `social-platforms` page: OAuth credentials + API config + "Connect Accounts" link — single page does both |
| V6 | **Token storage duplicated** | High | `social_accounts` (user-level) AND `community_ai_platform_tokens` (tenant-level) — two credential stores |
| V7 | **Company-level OAuth configs in external_api_sources** | Critical | Rows with company_id + oauth_client_id_encrypted enable per-company OAuth |
| V8 | **No platform_oauth_configs table** | High | Global OAuth config should be in dedicated table; currently .env + external_api_sources |
| V9 | **oauthCredentialResolver uses companyId** | High | getOAuthCredentialsForPlatform(companyId, platform) — resolves per-company credentials |
| V10 | **Legacy /api/auth/* uses external_api_sources** | Medium | LinkedIn, YouTube callbacks use oauthCredentialResolver with companyId |

---

## PHASE 3 — Database Table Classification

| Table | Purpose | Classification | Action |
|-------|---------|----------------|--------|
| **platform_oauth_configs** | Global OAuth (Super Admin only) | **CREATE** | New table; Super Admin configures |
| **tenant_social_accounts** (or keep community_ai_platform_tokens) | Tenant platform connections (tokens) | **KEEP** (rename optional) | Consolidate with community_ai_platform_tokens semantics |
| **social_accounts** | User-level accounts (publish flow) | **MERGE** or **KEEP** | Decision: unify with tenant_social_accounts or keep dual model. Recommendation: **KEEP** for publish (user owns account); **community_ai_platform_tokens** for tenant/org actions. Document clear separation. |
| **external_api_sources** | API registry (trends, intelligence, health) | **DEPRECATE** OAuth columns | Remove oauth_client_id_encrypted, oauth_client_secret_encrypted from tenant use. Keep for non-OAuth APIs (NewsAPI, SerpAPI, etc.). Platform-scoped OAuth → platform_oauth_configs |
| **platform_connectors** | Org platform config (platform_key, active) | **REVIEW** | May overlap with tenant_social_accounts; clarify or deprecate |
| **company profile social_links** | URLs only (not credentials) | **KEEP** | No change |

### Column-Level Actions for external_api_sources

| Column | Action |
|--------|--------|
| oauth_client_id_encrypted | **DEPRECATE** — migrate to platform_oauth_configs; remove from tenant UI |
| oauth_client_secret_encrypted | **DEPRECATE** — same |
| company_id | **KEEP** for non-OAuth API config (e.g. API key per company). For OAuth: **REMOVE** usage for credential resolution |

---

## PHASE 4 — Correct Architecture (Target State)

### Layer 1 — Global OAuth Configuration

**Table: platform_oauth_configs**

```sql
CREATE TABLE platform_oauth_configs (
  platform VARCHAR(50) PRIMARY KEY,
  client_id TEXT NOT NULL,
  client_secret_encrypted TEXT NOT NULL,
  auth_url TEXT NOT NULL,
  token_url TEXT NOT NULL,
  scopes TEXT[] DEFAULT '{}',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

- **Managed by:** Super Admin only
- **Resolution:** All OAuth flows read from this table (or .env fallback during migration)
- **No company_id:** Global config only

### Layer 2 — Tenant Platform Connections

**Table: tenant_social_accounts** (or retain community_ai_platform_tokens with schema alignment)

```sql
CREATE TABLE tenant_social_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  platform TEXT NOT NULL,
  platform_account_id TEXT,
  platform_account_name TEXT,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  connected_by_user_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, organization_id, platform)
);
```

- **Created by:** OAuth callback only (no manual insert)
- **Encryption:** AES-256-GCM for access_token, refresh_token

**Note:** `community_ai_platform_tokens` already exists with equivalent schema. Rename to `tenant_social_accounts` or keep name and ensure schema matches.

---

## PHASE 5 — Legacy Structures to Remove/Deprecate

| Structure | Action | Migration |
|-----------|--------|-----------|
| **social-platforms OAuth fields** | Remove oauth_client_id, oauth_client_secret from tenant form | Hide fields; or remove section; redirect to "Contact support for new platform" |
| **external-apis OAuth input** | Reject oauth_client_id/secret from tenant; Super Admin only | Add role check: only SUPER_ADMIN can set OAuth credentials |
| **external_api_sources.oauth_* per company** | Stop using for OAuth | Migrate any valid global configs to platform_oauth_configs; drop company_id-based OAuth resolution |
| **oauthCredentialResolver(companyId)** | Remove companyId for OAuth | Use platform_oauth_configs (or .env) only; companyId only for non-OAuth API keys |
| **/platform-configuration** | Already redirects | Keep redirect |
| **Duplicate Connect UIs in creative-scheduler** | Route to /community-ai/connectors | Replace connect buttons with link to Connect Accounts |
| **/api/auth/{platform}** (social_accounts) | **DECIDE** | Option A: Keep for publish flow (user-level); Option B: Migrate publish to tenant_social_accounts. Recommendation: Keep for backward compatibility; document as "user-level accounts for scheduling" |

---

## PHASE 6 — New OAuth Flow (Canonical)

```
User → Community AI → Connect Accounts
       ↓
       Click "Connect LinkedIn"
       ↓
       GET /api/connectors/linkedin/start
       (state: { tenant_id, organization_id, redirect })
       (credentials from platform_oauth_configs or .env)
       ↓
       Redirect to platform OAuth
       ↓
       User authorizes
       ↓
       GET /api/connectors/linkedin/callback?code=...&state=...
       ↓
       Exchange code for tokens (credentials from platform_oauth_configs)
       ↓
       Save to tenant_social_accounts (encrypted)
       ↓
       Redirect to /community-ai/connectors?connected=linkedin
```

**No credential input anywhere.**

**Route naming:** Current `/api/community-ai/connectors/{platform}/auth` and `callback` are acceptable. Alternative: `/api/connectors/{platform}/start` and `/api/connectors/{platform}/callback` for clarity.

---

## PHASE 7 — Single Connect Page (Target UI)

**Path:** Community AI → Connect Accounts (`/community-ai/connectors`)

**Displays:**
- Platform
- Connection status (Connected / Not connected)
- Connected account name (when connected)
- Connect / Reconnect / Disconnect button

**Platform list source:** `platform_oauth_configs WHERE enabled = true` (or .env presence during migration)

**No:** Client ID, Secret, API URL, or credential fields

**Remove from tenant UI:**
- social-platforms: OAuth credential fields
- external-apis: OAuth credential input for tenants

---

## PHASE 8 — Platform Abstraction Layer

**Directory:** `backend/platformAdapters/` (already exists)

**Existing adapters:** linkedinAdapter, twitterAdapter, facebookAdapter, instagramAdapter, redditAdapter, youtubeAdapter, etc.

**Interface (per adapter):**
- publishPost
- fetchComments
- fetchMentions
- replyToComment

**Credential source:** platformTokenService (tenant_social_accounts) or tokenStore (social_accounts) — resolve by context (Community AI vs publish).

**Action:** Document which adapter uses which token source; ensure unified interface.

---

## PHASE 9 — Migration Strategy

### Step 1 — Audit Existing Tokens
- Count rows in social_accounts, community_ai_platform_tokens
- Identify which companies have external_api_sources with OAuth credentials
- Document token coverage per platform

### Step 2 — Create platform_oauth_configs
- Run migration: create table
- Seed from .env (LINKEDIN_CLIENT_ID, etc.) for each platform
- Or migrate from external_api_sources (platform scope, company_id null)

### Step 3 — Update Credential Resolution
- oauthCredentialResolver: Check platform_oauth_configs first; remove companyId for OAuth
- Community AI connectors: Already use .env; switch to platform_oauth_configs when available
- /api/auth/linkedin, youtube: Switch to platform_oauth_configs (ignore company-level external_api_sources for OAuth)

### Step 4 — Remove Tenant OAuth Configuration
- social-platforms: Remove oauth_client_id, oauth_client_secret form fields (or restrict to Super Admin)
- external-apis: Reject OAuth credentials from non–Super Admin

### Step 5 — Consolidate Connect Entry
- Ensure Header "Connect Accounts" → /community-ai/connectors
- platform-configuration: Keep redirect
- creative-scheduler: Replace connect buttons with link to /community-ai/connectors (or keep /api/auth/* for user-level if dual model retained)

### Step 6 — Deprecate external_api_sources OAuth
- Stop writing oauth_client_id_encrypted, oauth_client_secret_encrypted from tenant UI
- Migrate any global platform configs to platform_oauth_configs
- external_api_sources: Keep for non-OAuth APIs (NewsAPI, SerpAPI, etc.)

### Step 7 — Token Storage Decision
- **Option A:** Keep social_accounts (user) + community_ai_platform_tokens (tenant) — document clear separation
- **Option B:** Unify into tenant_social_accounts; migrate social_accounts tokens — higher risk, larger migration

**Recommendation:** Option A for stability; document the dual model clearly.

---

## PHASE 10 — Implementation Roadmap

| Phase | Task | Priority | Effort |
|-------|------|----------|--------|
| 1 | Create platform_oauth_configs table | P0 | 1 day |
| 2 | Seed platform_oauth_configs from .env | P0 | 0.5 day |
| 3 | Update oauthCredentialResolver to use platform_oauth_configs (ignore company OAuth) | P0 | 1 day |
| 4 | Update Community AI connectors to read from platform_oauth_configs (with .env fallback) | P0 | 1 day |
| 5 | Remove OAuth credential fields from social-platforms (tenant view) | P0 | 0.5 day |
| 6 | Restrict external-apis OAuth input to Super Admin only | P0 | 0.5 day |
| 7 | Add Super Admin UI for platform_oauth_configs (optional; can use DB/env initially) | P1 | 2 days |
| 8 | Document dual token model (social_accounts vs community_ai_platform_tokens) | P1 | 0.5 day |
| 9 | Unify Connect entry: creative-scheduler → link to /community-ai/connectors | P2 | 0.5 day |
| 10 | Deprecate external_api_sources.oauth_* for new configs | P2 | 1 day |

---

## Final Output Summary

1. **Complete audit report:** Phases 1–2 above
2. **Architectural violations:** 10 identified (V1–V10)
3. **Database cleanup plan:** Create platform_oauth_configs; deprecate OAuth in external_api_sources for tenants
4. **New schema design:** platform_oauth_configs + tenant_social_accounts (or community_ai_platform_tokens)
5. **OAuth flow design:** Single flow via /api/community-ai/connectors/{platform} with credentials from platform_oauth_configs
6. **Migration strategy:** 7 steps outlined
7. **Implementation roadmap:** 10 tasks with priority and effort

---

## Certification Criteria (Post-Restructure)

- [ ] Super Admin configures OAuth in platform_oauth_configs only
- [ ] Tenant users connect via OAuth only (no credential fields)
- [ ] Single Connect page: /community-ai/connectors
- [ ] No company-level OAuth in external_api_sources (or Super Admin only)
- [ ] Tokens stored encrypted in tenant_social_accounts / community_ai_platform_tokens
- [ ] System scales to thousands of companies

---

## PHASE 11 — Implementation Complete

**Status:** `SOCIAL_PLATFORM_ARCHITECTURE_RESTRUCTURE_COMPLETE`

**Completed (Phases 1–8):**
- Phase 1: `platform_oauth_configs` table created; seed script and platformOauthConfigService added
- Phase 2: `oauthCredentialResolver` uses `getOAuthCredentialsForPlatform(platform)` — platform_oauth_configs first, env fallback; company-based lookup removed
- Phase 3: `social-platforms.tsx` — OAuth input fields removed; replaced with "Platform credentials are managed by OmniVyra. Use Connect Accounts to authorize."
- Phase 4: `external-apis/index.ts` — OAuth credential input restricted to SUPER_ADMIN only; tenants rejected with 403
- Phase 5: `creative-scheduler.tsx` — Connect buttons navigate to `/community-ai/connectors` instead of `/api/auth/{platform}`
- Phase 6: Dual token systems preserved: `social_accounts` (publishing) + `community_ai_platform_tokens` (Community AI)
- Phase 7: Connector auth/callback routes (LinkedIn, Twitter, Facebook, Instagram, Reddit) read credentials from `getOAuthCredentialsForPlatform(platform)`
- Phase 8: OAuth credential resolution no longer uses `external_api_sources.oauth_*`; table retained for non-OAuth APIs

**Migration steps (Phase 9):**
1. Run: `psql $SUPABASE_DB_URL -f database/platform_oauth_configs.sql`
2. Run: `npx ts-node -r dotenv/config backend/scripts/seedPlatformOauthConfigsFromEnv.ts` (requires ENCRYPTION_KEY + platform env vars)
3. Verify: Connectors work with platform_oauth_configs or env fallback

**Validation (Phase 10):**
- Login as tenant admin → Community AI → Connect Accounts → Connect LinkedIn → complete OAuth
- Expected: Account connected without entering credentials

---

**End of Audit and Restructuring Plan**
