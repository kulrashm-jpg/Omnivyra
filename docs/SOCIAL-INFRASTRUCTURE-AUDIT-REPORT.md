# SOCIAL INFRASTRUCTURE AUDIT REPORT

**Scope:** OAuth & tokens, adapter contracts, retry/failure policy, engagement pipeline, connect visibility.  
**Constraint:** Audit only — no code changes, no refactors, no improvement suggestions. Factual state only.

---

## 1. OAuth & Token Layer

### Two distinct token systems

1. **Publish/scheduling flow** — `social_accounts` + `backend/auth/tokenStore.ts` + `backend/auth/tokenRefresh.ts`
2. **Community AI connectors** — `community_ai_platform_tokens` + `backend/services/platformTokenService.ts` (no encryption, no refresh in codebase)

---

### LinkedIn

| Item | Publish flow (`/api/auth/*`) | Community AI (`/api/community-ai/connectors/*`) |
|------|------------------------------|--------------------------------------------------|
| **OAuth entry** | `pages/api/auth/linkedin.ts` | `pages/api/community-ai/connectors/linkedin/auth.ts` |
| **Callback** | `pages/api/auth/linkedin/callback.ts` | `pages/api/community-ai/connectors/linkedin/callback.ts` |
| **Token storage** | `social_accounts` (create/update by user_id + platform_user_id), then `setToken(accountId, tokenObj)` | `platformTokenService.saveToken()` → `community_ai_platform_tokens` (tenant_id, organization_id, platform) |
| **Encrypted** | Yes — `tokenStore` AES-256-GCM (`ENCRYPTION_KEY`) | No — plain text in DB |
| **Refresh token** | Stored if returned by LinkedIn; `tokenStore.TokenObject.refresh_token` | Stored in `community_ai_platform_tokens` if returned |
| **Expiry stored** | Yes — `token_expires_at` on `social_accounts`; `expires_at` in TokenObject | Yes — `expires_at` on `community_ai_platform_tokens` |
| **Refresh triggered** | In `platformAdapter.publishToPlatform()` when `isTokenExpiringSoon(token, 5)` before calling adapter | Not implemented for community_ai_platform_tokens; `tokenRefresh` has no integration with `platformTokenService` |
| **When refresh fails** | `refreshPlatformToken` returns null → platformAdapter throws "Token refresh failed - please reconnect account" → publish fails with retryable: true (catch sets it) | N/A (no refresh path) |
| **Reconnect flow** | User goes to OAuth entry again; callback creates/updates `social_accounts` and calls `setToken` | User hits auth link again; callback calls `saveToken` (upsert by tenant/org/platform) |
| **Token expiry in UI** | Not surfaced. `pages/api/accounts/[platform].ts` GET returns account_name, username, last_sync_at — no token_expires_at. | Community AI connectors page (`pages/community-ai/connectors.tsx`) has `expires_at` in local state and `resolveStatus` for "expired" but **connectors list is not loaded from API** — initial state is all "disconnected"; only query params after redirect set "connected". |

---

### Facebook

| Item | Publish flow | Community AI |
|------|--------------|--------------|
| **OAuth entry** | None in `pages/api/auth/` | `pages/api/community-ai/connectors/facebook/auth.ts` |
| **Callback** | None | `pages/api/community-ai/connectors/facebook/callback.ts` |
| **Token storage** | N/A | `platformTokenService.saveToken()` → `community_ai_platform_tokens` |
| **Encrypted** | N/A | No |
| **Refresh** | `tokenRefresh.refreshFacebookToken` exists and is used by `refreshPlatformToken` for publish; no `/api/auth/facebook` so no OAuth flow that writes to `social_accounts` for Facebook. | No refresh integration with platformTokenService |

---

### Instagram

| Item | Publish flow | Community AI |
|------|--------------|--------------|
| **OAuth entry** | `pages/api/auth/instagram.ts` | `pages/api/community-ai/connectors/instagram/auth.ts` |
| **Callback** | `pages/api/auth/instagram/callback.ts` | `pages/api/community-ai/connectors/instagram/callback.ts` |
| **Token storage** | `social_accounts` + `setToken` | `platformTokenService.saveToken()` → `community_ai_platform_tokens` |
| **Encrypted** | Yes (tokenStore) | No |
| **Refresh** | `refreshInstagramToken` → delegates to `refreshFacebookToken`; triggered in platformAdapter before publish | No refresh for community_ai_platform_tokens |

---

### X / Twitter

| Item | Publish flow | Community AI |
|------|--------------|--------------|
| **OAuth entry** | `pages/api/auth/twitter.ts` | `pages/api/community-ai/connectors/twitter/auth.ts` |
| **Callback** | `pages/api/auth/twitter/callback.ts` | `pages/api/community-ai/connectors/twitter/callback.ts` |
| **Token storage** | Callback creates/updates `social_accounts` row then calls `setToken(accountId, tokenObj)` (tokenStore) | `platformTokenService.saveToken()` → `community_ai_platform_tokens` |
| **Encrypted** | Yes — tokenStore (AES-256-GCM) | No |
| **Refresh** | `refreshTwitterToken` in tokenRefresh; used by platformAdapter when publishing | No refresh for community_ai_platform_tokens |

---

### YouTube

| Item | Publish flow | Community AI |
|------|--------------|--------------|
| **OAuth entry** | `pages/api/auth/youtube.ts` | None |
| **Callback** | `pages/api/auth/youtube/callback.ts` | None |
| **Token storage** | Callback creates/updates `social_accounts` then `setToken(accountId, tokenObj)` (tokenStore) | N/A |
| **Encrypted** | Yes — tokenStore | N/A |
| **Refresh** | `refreshYouTubeToken` in tokenRefresh; used by platformAdapter | N/A |

---

### TikTok

| Item | Publish flow | Community AI |
|------|--------------|--------------|
| **OAuth entry** | No dedicated `pages/api/auth/tiktok.ts` (callback only) | None |
| **Callback** | `pages/api/auth/tiktok/callback.ts` | None |
| **Token storage** | Callback creates/updates `social_accounts` then `setToken(accountId, tokenObj)` (tokenStore) | N/A |
| **Encrypted** | Yes — tokenStore | N/A |
| **Refresh** | `refreshTikTokToken` in tokenRefresh; used by platformAdapter | N/A |

---

### Reddit

| Item | Publish flow | Community AI |
|------|--------------|--------------|
| **OAuth entry** | None | `pages/api/community-ai/connectors/reddit/auth.ts` |
| **Callback** | None | `pages/api/community-ai/connectors/reddit/callback.ts` |
| **Token storage** | N/A | `platformTokenService.saveToken()` → `community_ai_platform_tokens` |
| **Refresh** | **No `refreshRedditToken` in tokenRefresh.ts** — Reddit not in switch (LinkedIn, Twitter, Facebook, Instagram, YouTube, TikTok, Spotify, Pinterest only) | No refresh for community_ai_platform_tokens |

---

### Pinterest

| Item | Publish flow | Community AI |
|------|--------------|--------------|
| **OAuth entry** | None (callback only) | None |
| **Callback** | `pages/api/auth/pinterest/callback.ts` | None |
| **Token storage** | Callback creates/updates `social_accounts` then `setToken(accountId, tokenObj)` (tokenStore) | N/A |
| **Encrypted** | Yes — tokenStore | N/A |
| **Refresh** | `refreshPinterestToken` in tokenRefresh; used by platformAdapter | N/A |

---

### Spotify

| Item | Publish flow | Community AI |
|------|--------------|--------------|
| **OAuth entry** | None (callback only) | None |
| **Callback** | `pages/api/auth/spotify/callback.ts` | None |
| **Token storage** | Callback creates/updates `social_accounts` then `setToken(accountId, tokenObj)` (tokenStore) | N/A |
| **Encrypted** | Yes — tokenStore | N/A |
| **Refresh** | `refreshSpotifyToken` in tokenRefresh; used by platformAdapter | N/A |

---

**Summary OAuth & Token**

- **Encryption:** Only LinkedIn publish-flow callback uses tokenStore (encrypted). Twitter, YouTube, TikTok, Pinterest, Spotify callbacks write tokens directly to `social_accounts`; not encrypted.
- **Refresh:** Centralized in `tokenRefresh.ts` for publish flow; triggered only in `platformAdapter` before publish. No refresh for `community_ai_platform_tokens`. Reddit has no refresh implementation.
- **Expiry in UI:** Not exposed for `social_accounts`. Community AI connectors page has expiry logic in state but does not load connector status from backend.
- **Reconnect:** Exists by re-running OAuth; no single “reconnect” API that revokes then redirects.

---

## 2. Adapter Contract Consistency

All adapters are under `backend/adapters/`. Platform router: `backend/adapters/platformAdapter.ts`.

| Adapter | File | publish | fetchActivities (comments) | executeAction (reply/like/share) | Return shape of publish() | Error handling | Retryable vs non-retryable | Rate limit (429) | Token refresh |
|---------|------|---------|----------------------------|----------------------------------|---------------------------|---------------|----------------------------|-----------------|---------------|
| LinkedIn | `linkedinAdapter.ts` | Yes | No | No | `PublishResult` (success, platform_post_id, post_url, published_at, error) | Returns `{ success: false, error: { code, message, retryable } }`; 401/429/other | Yes (401 false, 429 true) | Yes (429 → LINKEDIN_RATE_LIMIT) | Outside (platformAdapter) |
| X (Twitter) | `xAdapter.ts` | Yes | No | No | Same | Same pattern | Yes | Yes (429) | Outside |
| Instagram | `instagramAdapter.ts` | Yes | No | No | Same | Same | Yes | Yes (429) | Outside |
| Facebook | `facebookAdapter.ts` | Yes | No | No | Same | Same | Yes | Yes (429) | Outside |
| YouTube | `youtubeAdapter.ts` | Yes | No | No | Same | Same | Yes | Yes (429) | Outside |
| TikTok | `tiktokAdapter.ts` | Yes | No | No | Same | Same | Yes | Yes (429) | Outside |
| Pinterest | `pinterestAdapter.ts` | Yes | No | No | Same | Same | Yes | Yes (429) | Outside |
| Spotify | `spotifyAdapter.ts` | Yes | No | No | Same | Same | Yes | Yes (429) | Outside |
| Star Maker | `starmakerAdapter.ts` | Yes | No | No | Same | Returns error object | Yes | No explicit 429 | Outside |
| Suno | `sunoAdapter.ts` | Yes | No | No | Same | Returns error | Yes | No explicit 429 | Outside |

**Comments / actions:** No adapter implements `fetchActivities` or `executeAction`. Comment fetching is implemented in `engagementIngestionService.ts` (fetchLinkedInComments, fetchTwitterComments, fetchFacebookComments, fetchInstagramComments) and called via `fetchCommentsFromPlatform`. Execute actions (e.g. reply) exist in `pages/api/social/comments.ts` as inline helpers, not in adapters.

**Consistency**

- **Return shape:** All return `PublishResult` with optional `error: { code, message, retryable }`.
- **Error style:** All return `{ success: false, error }`; none throw on API errors.
- **Retryable:** All set `retryable` on 401 (false) and 429 (true) where handled; generic catch often `retryable: true`.
- **Rate limit:** 429 handled explicitly in LinkedIn, X, Instagram, Facebook, YouTube, TikTok, Pinterest, Spotify; not in starmaker/suno.
- **Token refresh:** Always outside adapters (platformAdapter refreshes then calls adapter).
- **Gap:** fetchActivities/executeAction are not part of adapter contract; they live in engagementIngestionService and API route.

---

## 3. Retry & Failure Policy

### publishProcessor (`backend/queue/jobProcessors/publishProcessor.ts`)

- **Idempotency:** (1) Skip if `queue_jobs.status === 'completed'`. (2) Skip if `scheduled_posts.platform_post_id` already set. On skip, job marked completed with message "Already published (idempotency check)".
- **On publish failure:** `categorizeError` (errorRecoveryService) maps to PlatformError; `updateScheduledPostOnFailure`; `scheduled_posts` updated with error_code, error_message; queue_job status set to `failed` with error_message, error_code, and `next_retry_at` (exponential: `2^attempts * 60000` ms). Then throws so BullMQ can retry.
- **4xx:** errorRecoveryService returns retryable false for 401/403 and duplicate; processor still updates job to `failed` and sets next_retry_at; job re-thrown so BullMQ will consume attempts.
- **5xx:** Treated as retryable in errorRecoveryService (generic 5xx); processor marks failed and re-throws.
- **Rate limit (429):** Categorized as rate_limit, retryable true; processor marks failed with next_retry_at and re-throws.
- **Dead-letter / permanent failure:** No. Failed jobs remain `status: 'failed'` in queue_jobs; no separate "dead_letter" or "permanent_failure" state. BullMQ `removeOnFail: { age: 7 days }` only affects Redis; DB row stays.
- **Duplicate publish prevention:** Idempotency checks above; no additional idempotency key on publish API.
- **Campaign/readiness blocks:** If campaign not active or not ready, job marked failed with skipQueueStatusUpdate-style throw so processor does not update again; job still fails.

### Queue (BullMQ) — `backend/queue/bullmqClient.ts`

- **Default job options (getQueue):** `attempts: 3`, `backoff: { type: 'exponential', delay: 60000 }`, removeOnComplete, removeOnFail 7 days.
- **Max retries:** 3 attempts (1 initial + 2 retries).
- **Backoff:** Exponential, 60s initial delay.
- **Worker:** Uses same connection; no per-job overrides; failed jobs trigger retry until attempts exhausted.

### Scheduler — `backend/scheduler/schedulerService.ts`

- **findDuePostsAndEnqueue:** Queries scheduled_posts (status=scheduled, scheduled_for <= now), checks existing queue_jobs for same scheduled_post_id with status pending/processing to avoid duplicate jobs, creates queue_job and enqueues. No retry logic in scheduler itself.

### Token refresh

- **Where:** `platformAdapter.publishToPlatform()` — before calling adapter, if `isTokenExpiringSoon(token, 5)` calls `refreshPlatformToken`. On null return, throws "Token refresh failed - please reconnect account".
- **On refresh failure:** Publish fails; error returned with retryable true in platformAdapter catch; processor then categorizes and marks job failed. No automatic retry of refresh only; next publish attempt will try refresh again.

**Summary retry/failure**

- Max attempts: 3 (BullMQ).
- Backoff: exponential, 60s.
- 4xx (auth/forbidden/duplicate): retryable false in categorization; job still fails and uses up attempts.
- 5xx: retryable true.
- Rate limit: retryable true, next_retry_at set in DB; BullMQ retries by re-running job.
- No explicit dead-letter or permanent-failure state; failed jobs stay "failed" in DB.
- Duplicate publish prevention: idempotency in processor (completed or existing platform_post_id).
- Idempotency: no idempotency key on the HTTP/enqueue boundary; only inside processor.

---

## 4. Engagement Pipeline Integrity

Path: `scheduled_posts` → publishProcessor → platformAdapter.publishToPlatform → platform_post_id stored → engagementIngestionService.ingestComments → post_comments → engagementEvaluationService → community_ai_actions → aiActivityQueueService.

### Verified for LinkedIn and Instagram

- **platform_post_id stored:** Yes. On success, publishProcessor calls `updateScheduledPostOnPublish(scheduled_post_id, result.platform_post_id, ...)` (queries.ts). LinkedIn adapter returns `platform_post_id` (URN or id part); Instagram returns `published.id`.
- **fetchComments uses that ID:** Yes. `ingestComments(scheduled_post_id)` loads post via `getScheduledPost(scheduled_post_id)`; uses `post.platform_post_id`; returns error "Post not yet published (no platform_post_id)" if null. Then calls `fetchCommentsFromPlatform(post.platform, platformPostId, token.access_token)`. LinkedIn: `fetchLinkedInComments` uses `https://api.linkedin.com/v2/socialActions/${platformPostId}/comments`. Instagram: `fetchInstagramComments` uses `https://graph.facebook.com/v18.0/${platformPostId}/comments` (same as Facebook; Instagram uses Media ID).
- **Comments upserted idempotently:** Yes. `persistComments` uses `supabase.from('post_comments').upsert(dbRows, { onConflict: 'scheduled_post_id,platform_comment_id', ignoreDuplicates: false })`.
- **Evaluation triggers once per ingest:** Yes. After `persistComments(rows)`, if `ingested > 0`, calls `evaluatePostEngagement(scheduled_post_id)` once (in try/catch; failure only logged).
- **Actions dedupe:** engagementEvaluationService uses `actionExists(tenant_id, organization_id, platform, target_id, action_type, suggested_text)` before inserting; inserts only if not exists.
- **Queue loads correct related entities:** aiActivityQueueService loads community_ai_actions by tenant_id, organization_id, status; then fetches scheduled_posts where `platform_post_id IN targetIds` and post_comments where `platform_comment_id IN targetIds`; attaches related_scheduled_post and related_comment by `${platform}:${target_id}`. target_id can be post or comment ID; both posts and comments are loaded so linkage is correct for either.

### Broken or assumed links

- **Ingestion trigger:** No scheduler or cron observed that calls `ingestRecentPublishedPosts` or per-post `ingestComments` on a schedule. Engagement pipeline runs when something (e.g. API call) calls ingestComments (e.g. `pages/api/social/comments.ts` action `fetch`).
- **Token for ingestion:** ingestComments uses `getToken(post.social_account_id)` (tokenStore). All publish-flow callbacks use setToken, so tokens in social_accounts are encrypted; ingestion and publish share the same credential path.
- **Community AI vs publish:** Evaluation uses tenant_id/organization_id from campaign → company_id; actions go to community_ai_actions. Queue is tenant/org scoped. Publish uses social_accounts (user-scoped). No inconsistency in pipeline; the two token systems (social_accounts vs community_ai_platform_tokens) serve different flows.

---

## 5. Connect Visibility Layer

### Company Admin

**Publish flow (social_accounts)**

- **See connected platforms:** Partially. `pages/api/accounts/[platform].ts` GET returns one account per platform for the authenticated user from `social_accounts` (id, account_name, username, follower_count, is_active, last_sync_at, platform). There is no API that lists all platforms for the user in one call. `pages/api/accounts.ts` (GET) does **not** read from DB; it only returns a list when query has `connected`, `account`, and `mock`; otherwise returns empty array. So creative-scheduler and scheduler.tsx that call `/api/accounts` do **not** get real connected accounts from DB unless mock query params are present.
- **Account name:** Yes, from GET `/api/accounts/[platform]` as `data.name` (account_name).
- **Disconnect:** `pages/api/accounts/[platform].ts` DELETE is a stub: logs and returns 200 with message; **does not update or delete social_accounts or clear tokens**.
- **Reconnect:** User can go to OAuth entry (e.g. /api/auth/linkedin) again; no "Reconnect" button that revokes then redirects.
- **Token expiry or error state:** Not exposed. GET `/api/accounts/[platform]` does not return token_expires_at or error state.
- **Last sync time:** Yes — `last_sync_at` in GET `/api/accounts/[platform]` as `lastPosted`.

**Implementing files:** `pages/api/accounts.ts`, `pages/api/accounts/[platform].ts`, `pages/creative-scheduler.tsx`, `pages/scheduler.tsx`.

**Community AI connectors (community_ai_platform_tokens)**

- **See connected platforms:** UI only. `pages/community-ai/connectors.tsx` shows a fixed list (LinkedIn, Facebook, Instagram, Twitter, Reddit); **initial state is all "disconnected"**; no API call to load status from `community_ai_platform_tokens`. Status becomes "connected" only from query params after OAuth redirect (`connected=linkedin&status=success`).
- **Account name:** Not displayed; only platform and status.
- **Disconnect:** "Disconnect" only updates local state (`setConnectors` to disconnected); **no call to platformTokenService.revokeToken or any API**.
- **Reconnect:** Link to `/api/community-ai/connectors/${platform}/auth?...` for connect; no revoke before reconnect.
- **Token expiry:** `resolveStatus` uses `expires_at` to show "expired" vs "connected", but `expires_at` is only set when state is updated from OAuth redirect, not loaded from backend.
- **Last sync time:** Not shown.

**Implementing files:** `pages/community-ai/connectors.tsx`, `pages/api/community-ai/connectors/*/auth.ts`, `pages/api/community-ai/connectors/*/callback.ts`, `backend/services/platformTokenService.ts`.

### Super Admin

- **View all company connections:** No dedicated API found. Super-admin APIs under `pages/api/super-admin/` (e.g. analytics-summary, campaign-health, community-ai-metrics, companies, users, rbac) do not expose a list of social_accounts or community_ai_platform_tokens per company.
- **Health status:** campaign-health returns campaign/version status, not connection or token health.
- **Failed publishes:** Not aggregated. queue_jobs and scheduled_posts with status failed exist in DB but no super-admin endpoint that lists failed publishes or token failures across companies.
- **Token failures:** Not exposed. No super-admin API that reports token refresh failures or expired tokens per company.

**Implementing files:** `pages/api/super-admin/*.ts` (none implement connection or token visibility).

---

## 6. Completion Status Summary

| Aspect | Status |
|--------|--------|
| **Production ready** | **PARTIAL** |

### Critical Gaps

1. **List connected accounts:** `/api/accounts` does not query `social_accounts`; returns empty unless mock query params. Company admin UIs (creative-scheduler, scheduler) cannot show real connected platforms.
3. **Disconnect not implemented:** DELETE `/api/accounts/[platform]` does not revoke or delete the account/tokens. Community AI "Disconnect" only updates local UI state.
4. **Community AI connector status not loaded:** Connectors page does not fetch status from backend; expiry/connected state not backed by `community_ai_platform_tokens`.
5. **Reddit token refresh:** Not implemented in tokenRefresh; Reddit not in refreshPlatformToken switch.

### Medium Gaps

1. **Token expiry not in UI:** No company admin UI shows token_expires_at or "expired" for social_accounts.
2. **No super-admin connect/token visibility:** No API to list company connections, token health, or failed publishes for super-admin.
3. **No dead-letter or permanent failure:** Failed jobs stay "failed"; no differentiation for non-retryable vs exhaustedly retried.
4. **Facebook publish OAuth:** No `/api/auth/facebook` or callback for social_accounts; Facebook publish via platformAdapter would require a Facebook account connected through some other path (e.g. manual DB or future flow).

### Minor Gaps

1. **Community AI token refresh:** Tokens in community_ai_platform_tokens are never refreshed; expiry requires user to reconnect.
2. **Adapter contract:** fetchActivities/executeAction are not on adapters; they live in engagementIngestionService and API route (documentation/consistency only).
3. **Idempotency at enqueue:** No idempotency key on job creation to prevent duplicate job enqueue for same post (mitigated by processor idempotency and scheduler’s existing-job check).

---

*End of audit. No recommendations; current state only.*
