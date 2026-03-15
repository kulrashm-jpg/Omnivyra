# Social Platform OAuth Integration — Audit & Repair Report

**Date:** March 14, 2025  
**Objective:** Activate Engagement Command Center by repairing the Social Platform Account Connection flow.  
**Root cause:** No active `social_accounts` → pipeline cannot ingest engagement data.

---

## Executive Summary

| Phase | Status | Finding |
|-------|--------|---------|
| 1. Account Connection Flow | ✅ Traced | UI: creative-scheduler, platform-configuration. API: `/api/auth/{platform}` |
| 2. OAuth Callback | ✅ Verified | Callbacks exist; correctly insert/update `social_accounts` |
| 3. Database Insert | ✅ Verified | LinkedIn, Twitter, Instagram, YouTube, Pinterest, Spotify, TikTok callbacks write to `social_accounts` |
| 4. Company Association | ✅ Verified | `social_accounts.user_id` + `user_company_roles` links to company |
| 5. Token Storage | ✅ Verified | `setToken(accountId, tokenObj)` via tokenStore (encrypted) |
| 6. Visibility API | ✅ Verified | `GET /api/accounts` queries `social_accounts` for authenticated user |
| **Repairs Applied** | | See below |

---

## Phase 1 — Account Connection Flow

### UI Entry Points

| Page | Path | Connect Action |
|------|------|-----------------|
| **Creative Scheduler** | `/creative-scheduler` | `handleConnectAccount(platform)` → `/api/auth/{platform}?companyId=...` |
| **Platform Configuration** | `/platform-configuration` | `handleConnect(platform, authUrl)` → `/api/auth/{platform}?companyId=...` |

### API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/auth/linkedin` | Redirect to LinkedIn OAuth |
| `GET /api/auth/twitter` | Redirect to Twitter OAuth |
| `GET /api/auth/instagram` | Redirect to Instagram OAuth |
| `GET /api/auth/youtube` | Redirect to YouTube OAuth |
| `GET /api/auth/linkedin/callback` | Exchange code, save to `social_accounts` |
| (same for twitter, instagram, youtube, pinterest, spotify, tiktok) | |

---

## Phase 2 — OAuth Callback Verification

Callbacks implement:

1. ✅ Receive `code` and `state` from platform
2. ✅ Exchange code for access token
3. ✅ Retrieve platform user profile
4. ✅ Resolve `userId` via `getSupabaseUserFromRequest(req)`
5. ✅ Upsert `social_accounts` (insert or update by `user_id` + `platform` + `platform_user_id`)
6. ✅ Call `setToken(accountId, tokenObj)` for encrypted storage
7. ✅ Redirect to `/creative-scheduler?connected=...&account=...`

---

## Phase 3 — Database Insert

Expected insert/update pattern (from LinkedIn callback):

```sql
INSERT INTO social_accounts (
  user_id,
  platform,
  platform_user_id,
  account_name,
  username,
  is_active,
  token_expires_at,
  last_sync_at
)
VALUES (...);
```

- `is_active = true` ✅  
- Tokens stored via `tokenStore.setToken()` (encrypted) ✅  
- `platform_user_id` from profile ✅  

---

## Phase 4 — Company Association

`social_accounts` links to company via:

```
social_accounts.user_id
  → user_company_roles.user_id
  → user_company_roles.company_id
```

Engagement Command Center filters by `organization_id` (company_id). Threads are populated from `post_comments` → `syncFromPostComments`; `organization_id` is resolved from campaign or `user_company_roles`.

---

## Phase 5 — Token Storage

- `tokenStore.setToken(accountId, tokenObj)` writes encrypted `access_token`, `refresh_token`, `expires_at` to `social_accounts`
- `tokenStore.getToken(social_account_id)` used by `engagementIngestionService` when fetching comments

---

## Phase 6 — Connected Account Visibility

| API | Query | Returns |
|-----|-------|---------|
| `GET /api/accounts` | `social_accounts` WHERE `user_id = current_user` AND `is_active = true` | List of `{ platform, account_name, username, ... }` |
| `GET /api/accounts/[platform]` | Same for single platform | One account or null |

---

## Repairs Applied

### 1. OAuth Redirect URI Port (Critical)

**Issue:** `redirect_uri` defaulted to `http://localhost:3001` while the app runs on port **3000**. OAuth callbacks never executed.

**Files updated:**
- `pages/api/auth/linkedin.ts`
- `pages/api/auth/linkedin/callback.ts`
- `pages/api/auth/twitter.ts`
- `pages/api/auth/twitter/callback.ts`
- `pages/api/auth/instagram.ts`
- `pages/api/auth/instagram/callback.ts`
- `pages/api/auth/youtube.ts`
- `pages/api/auth/youtube/callback.ts`
- `pages/api/auth/pinterest/callback.ts`
- `pages/api/auth/spotify/callback.ts`
- `pages/api/auth/tiktok/callback.ts`

**Change:** Default `NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'` → `'http://localhost:3000'`

**Action for deployment:** Set `NEXT_PUBLIC_BASE_URL` in production (e.g. `https://your-domain.com`). Ensure it matches the app origin exactly.

---

### 2. Connect Accounts Entry Point

**Issue:** No Header link to the Connect Accounts UI. Users went to "Social Platform Settings" expecting to connect accounts, but that page configures OAuth Client ID/Secret (API credentials), not user account connections.

**File updated:** `components/Header.tsx`

**Change:** Added "Connect Accounts" button → `/platform-configuration`

---

### 3. Platform Configuration Disconnect Bug

**Issue:** `handleDisconnect` called `DELETE /api/accounts/${accountId}` (UUID). The API expects platform name: `DELETE /api/accounts/{platform}`.

**File updated:** `pages/platform-configuration.tsx`

**Change:** `handleDisconnect(platform, accountId)` now calls `DELETE /api/accounts/${platform}` (uses platform name).

---

### 4. env.example

**File updated:** `env.example`  
**Change:** `NEXT_PUBLIC_BASE_URL=http://localhost:3001` → `http://localhost:3000`

---

## .env.local Verification

If `.env.local` has `NEXT_PUBLIC_BASE_URL=http://localhost:3001`, update it to:

```
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

The app runs on port 3000. OAuth redirect URIs registered with LinkedIn, Twitter, etc. must match exactly.

---

## Activation Checklist

| Step | Action |
|------|--------|
| 1 | Ensure `NEXT_PUBLIC_BASE_URL` matches app URL (port 3000 locally) |
| 2 | Add OAuth Client ID/Secret in Social Platform Settings for each platform (or .env) |
| 3 | Click **Connect Accounts** in Header → Platform Configuration |
| 4 | Click **Connect LinkedIn** (or Twitter, etc.) |
| 5 | Complete OAuth on the platform |
| 6 | Verify: `SELECT * FROM social_accounts WHERE is_active = true` |
| 7 | Create campaign, schedule and publish post |
| 8 | Workers running: `npm run start:workers` (or `npm run dev`) |
| 9 | Wait for engagement polling (~10 min) or trigger manually |
| 10 | Verify: `post_comments`, `engagement_threads`, `engagement_messages` |

---

## Phase 7–9 — Manual Verification Steps

**Phase 7 — Test OAuth Flow**
1. Open http://localhost:3000
2. Log in, select company
3. Click **Connect Accounts** → Platform Configuration
4. Click **Connect LinkedIn** (or configured platform)
5. Complete OAuth
6. Run: `SELECT * FROM social_accounts ORDER BY created_at DESC LIMIT 5`

**Phase 8 — Pipeline Activation**
- Create campaign → publish post → confirm `scheduled_posts` has `status=published`, `platform_post_id`, `social_account_id`

**Phase 9 — Ingestion Verification**
- Add comment on published post on platform
- Wait for polling job (or run engagement polling manually)
- Run: `SELECT COUNT(*) FROM post_comments`, `engagement_threads`, `engagement_messages`

---

## Final Status (Post-Repair)

| Metric | Before | After Repairs |
|--------|--------|---------------|
| OAuth redirect port | 3001 (wrong) | 3000 (correct) |
| Connect Accounts nav | None | Header → Platform Configuration |
| Disconnect API | Wrong param (accountId) | Correct (platform) |
| **CONNECTED_PLATFORMS** | 0 | *User must complete OAuth* |
| **social_accounts** | 0 | *After Connect flow* |
| **scheduled_posts (published)** | 0 | *After publish* |
| **post_comments** | 0 | *After ingestion* |
| **engagement_threads** | 0 | *After sync* |

**SYSTEM_STATUS:** Repairs complete. Engagement Command Center pipeline will activate once:
1. User connects platforms via Connect Accounts
2. User publishes posts
3. Workers/cron run engagement polling
