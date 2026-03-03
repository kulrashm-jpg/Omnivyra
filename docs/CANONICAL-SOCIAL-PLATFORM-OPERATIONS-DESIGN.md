# CANONICAL SOCIAL PLATFORM OPERATIONS DESIGN

This document is the single source of truth for social platform operations. It removes ambiguity between platformAdapter, socialPlatformPublisher, platformConnectors, social/comments API, tokenStore, and platformTokenService. All future implementation must align with this contract.

**Scope:** Design and refactor preparation only. No code implementation in this step. Grounded in current codebase; minimal new tables; optimized for unification with minimal refactor.

---

## 1. Unified Operations Contract

All platform operations are conceptually defined by the following contract. Implementations may live in different services (see §2–5) but callers and documentation refer to these operation names and semantics.

### 1.1 Operation names and semantics

| Operation | Description | Caller context |
|-----------|-------------|----------------|
| **publish** | Publish a single content item to a platform under a specific account. | Scheduling / queue / super-admin tooling. |
| **fetchActivities** | Retrieve engagement for a known post (comments, and where supported: likes, shares, counts). | Ingestion job, Community AI input, or UI. |
| **reply** | Post a reply to a comment or post on the platform. | Community AI executor or user-initiated reply. |
| **like** | Like a post or comment on the platform. | Community AI executor. |
| **share** | Share/repost on the platform (where supported). | Community AI executor. |
| **follow** | Follow a user on the platform (where supported). | Community AI executor. |

No additional operations (e.g. delete, hide) are part of the canonical contract for this phase.

### 1.2 Canonical inputs (minimum required metadata)

Every operation that targets a **post** or **comment** must be resolvable to:

- **platform** (string): Canonical platform key (e.g. `linkedin`, `twitter`, `instagram`, `facebook`, `youtube`; `x` normalized to `twitter` where applicable).
- **account reference**: Identifies which credentials to use (see §2). One of:
  - **social_account_id** (UUID): For publish and fetch (and optional user-initiated reply).
  - **tenant_id + organization_id**: For Community AI actions (reply, like, share, follow).
- **post/comment reference** (where applicable):
  - **scheduled_post_id** (UUID): For our own posts; implies `platform_post_id` after publish.
  - **platform_post_id** or **platform_comment_id** (string): External platform ID for fetch/reply/like/share.

For **publish**, the system must also have: **content** (and optional title, hashtags, media_urls, content_type), **scheduled_for** (or immediate), and **campaign_id** (optional).

### 1.3 Canonical output structure (conceptual)

- **publish**: Success + `platform_post_id` (external ID) + `post_url` (if available) + `published_at`; or failure with `code`, `message`, `retryable`.
- **fetchActivities**: List of activity items; each has at least: `platform_comment_id` or equivalent, `content`, `author_name` (or id), `platform_created_at`, and optional counts (like_count, reply_count). Stored shape aligns with **post_comments** (see §4).
- **reply / like / share / follow**: Success with optional `platform_response`; or failure with `error` string. Persisted outcome in **community_ai_actions** (status, execution_result) for Community AI flows.

All operations must be idempotent or safely retryable where the platform allows (e.g. publish: one platform_post_id per scheduled_post; fetch: upsert by platform_comment_id).

---

## 2. Credential Ownership Model

### 2.1 Two credential stores (retained; roles clarified)

The system keeps **two** credential stores. No new tables. Each has a single, clear purpose.

| Store | Table | Service | Used for |
|-------|--------|---------|----------|
| **User social accounts** | `social_accounts` | `backend/auth/tokenStore.ts` (+ `tokenRefresh.ts`) | **Publish** and **fetchActivities** only. |
| **Tenant/org platform tokens** | `community_ai_platform_tokens` | `backend/services/platformTokenService.ts` | **reply**, **like**, **share**, **follow** (Community AI actions only). |

### 2.2 Primary credential source by operation

- **Publishing:** PRIMARY = **social_accounts** (via tokenStore). All canonical publish flows must use `scheduled_posts.social_account_id` → tokenStore. No publish path may use `external_api_sources` or `community_ai_platform_tokens` as the credential source for posting content.
- **Engagement fetching:** PRIMARY = **social_accounts** (via tokenStore). The account that published the post holds the token used to fetch comments/engagement for that post. Resolved via `scheduled_posts.social_account_id` and `scheduled_posts.platform_post_id`.
- **Replies and other actions (like, share, follow):** PRIMARY = **community_ai_platform_tokens** (via platformTokenService). Used by **platformConnectors** when executing Community AI actions. Scoped by `tenant_id` and `organization_id` from the action/playbook context.

### 2.3 Deprecated or wrapped credential usage

- **external_api_sources** as credential source for **publishing**: Deprecated for the canonical publish path. Super-admin publish must be wrapped to use the canonical path (see §3). `external_api_sources` remains for **trend/signal/API registry** and company-scoped config where needed (e.g. recommendations, health); it is no longer the source of publish tokens.
- **Mock token** in `pages/api/social/comments.ts` (`mock_token_${accountId}`): Deprecated. Fetch and reply from that API must be updated to use real credentials (social_accounts for fetch; see §5 for reply).

### 2.4 Mapping: company → account → credentials

- **Publish and fetch:**  
  **Campaign** (user_id) → **User** → **social_accounts** (user_id, platform).  
  **scheduled_posts** already carry `user_id`, `social_account_id`, `campaign_id`. No company_id on social_accounts; company is derived from **user_company_roles** (or equivalent) when needed for UI or reporting.  
  Mapping rule: **one user’s social_accounts** back publish and fetch for that user’s scheduled_posts. No change to schema.

- **Reply / actions (Community AI):**  
  **tenant_id + organization_id** → **community_ai_platform_tokens** (tenant_id, organization_id, platform).  
  No change. **company** is not stored on this table; tenant/org are the scope. Where the product needs “company” for Community AI, it is derived from app context (e.g. current company → tenant/org) outside this document.

- **Multi-company usage:**  
  A user may belong to multiple companies (user_company_roles). Scheduling and publish remain **user-centric**: the campaign owner’s social_accounts are used. Which company a campaign “belongs to” is an application-level choice (e.g. selected company at plan time); the canonical contract does not add company_id to social_accounts or scheduled_posts. Community AI continues to be scoped by tenant/org only.

---

## 3. Canonical Publish Pipeline Decision

### 3.1 Canonical path

**Option A is canonical:**  
**queue → platformAdapter**

- **Flow:** `scheduled_posts` (status=`scheduled`) → **schedulerService.findDuePostsAndEnqueue()** → **queue_jobs** + BullMQ → **publishProcessor.processPublishJob()** → **platformAdapter.publishToPlatform(scheduled_post_id, social_account_id)** → token from **tokenStore** (social_accounts) → platform-specific adapter (e.g. `backend/adapters/linkedinAdapter.ts`) → update **scheduled_posts** (platform_post_id, status) and **integratePublishSuccess** (analytics, activity log).
- **Files:** `backend/scheduler/schedulerService.ts`, `backend/queue/jobProcessors/publishProcessor.ts`, `backend/adapters/platformAdapter.ts`, `backend/adapters/*Adapter.ts`, `backend/db/queries.ts` (getScheduledPost, getSocialAccount), `backend/auth/tokenStore.ts`, `backend/integration/publishIntegration.ts`.

### 3.2 Non-canonical path: socialPlatformPublisher

- **Role:** Becomes **internal / super-admin only** and must not be the primary path for production publish.
- **Decision:** **Wrap** the super-admin publish flow so it uses the canonical path. Concretely: `pages/api/social/publish.ts` should (1) ensure the post exists in **scheduled_posts** with a valid **social_account_id** (and user_id), (2) create a **queue_job** for that post and enqueue it in BullMQ (or call a single “publish now” helper that reuses **platformAdapter.publishToPlatform** with that post and account). It must **not** call `socialPlatformPublisher.publishScheduledPost()` for the actual platform API call.
- **Migration (high-level):**
  1. Add or reuse a small “publish now” entry that takes (scheduled_post_id, social_account_id) and calls **platformAdapter.publishToPlatform** (and updates scheduled_posts / analytics). No new queue job if immediate publish is required for super-admin.
  2. Change `pages/api/social/publish.ts` to load the scheduled post, resolve social_account_id (already on the post), then call that entry instead of socialPlatformPublisher.
  3. Deprecate **socialPlatformPublisher.publishScheduledPost()** for publish; keep the file only if it still provides non-publish logic (e.g. health/config); otherwise remove or shrink to a thin wrapper that delegates to platformAdapter for actual publish.

### 3.3 What stays unchanged

- **structuredPlanScheduler**: Continues to write **scheduled_posts** with user_id, social_account_id, campaign_id, platform, content, scheduled_for. No change to how accounts are resolved (by campaign user_id + platform).
- **pages/api/social/post.ts** (createLegacyScheduledPost): Continues to create **scheduled_posts** only. Actual publish remains via scheduler + queue + platformAdapter.
- **BullMQ queue name and job shape**: Unchanged (`scheduled_post_id`, `social_account_id`, `user_id`).

---

## 4. Engagement Ingestion Decision

### 4.1 Mechanism: polling (canonical)

- **Choice:** **Polling jobs** (scheduled/cron). No webhooks in the first version. Rationale: works with existing tables and tokens (social_accounts); no per-platform webhook registration or company-specific endpoints; simpler to implement and reason about.
- **Future:** Webhooks or hybrid can be added later for specific platforms if needed; the canonical **storage** and **link** rules below still apply.

### 4.2 Canonical service that fetches engagement

- A single **engagement ingestion service** (new or named module, e.g. under `backend/services/`) is the canonical owner of “fetch activities for our posts.”
- It must:
  - Query **scheduled_posts** that have `platform_post_id` set and `status = 'published'` (and optionally `published_at` within a configured window).
  - For each such post, resolve credentials via **social_account_id** → tokenStore (same as publish path).
  - Call platform-specific **fetch** logic (comments, and where available likes/shares counts) using the same platform key as **platformAdapter** (linkedin, twitter, etc.).
  - Write results into existing tables only (see below).

- **Relationship to existing code:** The inline fetch logic in `pages/api/social/comments.ts` (fetchLinkedInComments, fetchTwitterComments, etc.) should be moved or duplicated into this service and use **real** tokens from tokenStore(social_account_id). The API route can then call this service or be deprecated in favor of “read from post_comments” once ingestion runs.

### 4.3 Where data is stored (existing tables only)

- **post_comments** (from `database/step10-comment-engagement.sql`): Canonical store for comments.  
  Required link: **scheduled_post_id** (FK to scheduled_posts). Each row must have **platform_comment_id**, **platform**, **content**, **author_name**, and optional author_username, platform_created_at, like_count, reply_count. Upsert key: (scheduled_post_id, platform_comment_id).
- **No new tables.** If a platform returns “likes” or “shares” only at post level (not per comment), those can be written to **analytics** / post-level metrics (e.g. existing recordPostAnalytics or equivalent) keyed by scheduled_post_id / platform_post_id. The contract for “fetchActivities” output is that comment-level data lands in **post_comments**.

### 4.4 How scheduled_posts / platform_post_id links are preserved

- **scheduled_posts** already have **platform_post_id** (set by platformAdapter after publish). The ingestion job selects by `platform_post_id IS NOT NULL` and uses **scheduled_post_id** as the FK when inserting into **post_comments**. So the link is: **scheduled_post_id** → **post_comments.scheduled_post_id**. No schema change.
- For Community AI and UI, “engagement for this post” is read from **post_comments** filtered by **scheduled_post_id** (and optionally by campaign_id via join through scheduled_posts).

---

## 5. Reply / Action Model

### 5.1 platformConnectors remain canonical for actions

- **reply**, **like**, **share**, **follow** are executed **only** through **backend/services/platformConnectors/** and **backend/services/communityAiActionExecutor.ts**.
- **communityAiActionExecutor** loads the connector by platform, gets token from **platformTokenService** (community_ai_platform_tokens by tenant_id, organization_id, platform), and calls `connector.executeAction(action, authToken)`. This remains the single execution path for Community AI actions.

### 5.2 Relation to platformAdapter

- **platformAdapter** is responsible for **publish** (and, after §4, will be the credential source for **fetchActivities** when implemented in the ingestion service; the adapter layer may expose a shared “fetch” entry used by that service). It does **not** perform reply/like/share/follow.
- **platformConnectors** are responsible **only** for **reply**, **like**, **share**, **follow**. They do **not** perform publish. So: one layer for “content out” (publish) and “engagement in” (fetch, via ingestion using same credentials as publish); a separate layer for “engagement actions” (reply/like/share/follow) with tenant/org credentials.

### 5.3 User-initiated reply (e.g. from comments UI)

- **Rule:** Any “reply as the post owner” from the product UI (e.g. replying to a comment on our post) must **reuse the same platform connector interface** (reply semantics) but with credentials from **social_accounts** for that post’s **social_account_id**. So: one implementation (connector), two credential sources (tenant/org for Community AI; social_account for post-owner reply). No second reply implementation.
- Concretely: either (a) add an optional “token override” path in the executor that accepts a pre-resolved token (from tokenStore by social_account_id) when the caller is “post owner,” or (b) introduce a small “reply as post owner” service that loads social_account token and calls the same connector with that token. Same contract (reply), same connector; credential source differs by context.

### 5.4 social/comments API reply path

- **pages/api/social/comments.ts** reply path (currently mock): Deprecated. It should be updated to use the canonical action path: resolve **scheduled_post_id** or **platform_post_id** + account from post, then either use Community AI executor with “post owner” token resolution (above) or a dedicated thin “reply as post owner” call that uses platformConnectors with social_account token. No standalone inline reply helpers.

---

## 6. Multi-Tenant Ownership Rule

### 6.1 Canonical ownership model

- **Social account ownership:** **User.**  
  **social_accounts** are owned by **user_id**. One user can have multiple accounts per platform (e.g. multiple LinkedIn accounts). Campaigns and **scheduled_posts** are user-centric: **campaign.user_id** and **scheduled_posts.user_id** / **scheduled_posts.social_account_id** identify the owner. No company_id on social_accounts.

- **Community AI scope:** **Tenant + organization.**  
  **community_ai_platform_tokens** and **community_ai_actions** are scoped by **tenant_id** and **organization_id**. No change. “Company” in the product is derived from application context (e.g. user’s current company or company linked to a campaign via user_company_roles); the canonical design does not add company_id to **social_accounts** or **campaigns** in this phase.

### 6.2 How campaigns, scheduled_posts, and Community AI align

- **Campaigns:** Owned by **user_id**. Which company a campaign is “for” is application logic (e.g. company selector when creating or viewing).
- **scheduled_posts:** Always have **user_id**, **social_account_id**, **campaign_id**. Publish and fetch use **social_accounts** (user). Engagement stored in **post_comments** is tied to **scheduled_post_id**, hence to that user and campaign.
- **Community AI:** Operates with **tenant_id** and **organization_id**. To “run Community AI on this post’s engagement,” the application must resolve **campaign → company → tenant/org** (or user → default tenant/org) and pass that context when calling evaluateEngagement or when creating/executing **community_ai_actions**. This resolution stays outside the canonical platform contract; the contract only states that actions use **community_ai_platform_tokens(tenant_id, organization_id, platform)**.

### 6.3 What we avoid

- We do **not** add **company_id** to **social_accounts** or **campaigns** in this design. No new tables for “company social config.”
- We do **not** merge **social_accounts** and **community_ai_platform_tokens** into one table. Two stores, two roles (publish/fetch vs reply/actions).
- Scheduling and publish remain **user-centric** so that **structuredPlanScheduler** and **schedulerService** do not require schema or flow changes.

---

## 7. End-to-End Canonical Flow

Single end-to-end flow from plan to actions, with real services/files.

```text
1. Plan
   → Campaign AI / weekly blueprint (e.g. backend/services/campaignAiOrchestrator.ts, blueprint services)
   → Produces structured plan (weeks, daily, platforms, content).

2. Schedule
   → backend/services/structuredPlanScheduler.ts: scheduleStructuredPlan(plan, campaignId)
   → Resolves social_accounts by campaign.user_id + platform.
   → Inserts into scheduled_posts (user_id, social_account_id, campaign_id, platform, content, scheduled_for, status='scheduled').

3. Publish
   → backend/scheduler/schedulerService.ts: findDuePostsAndEnqueue()
   → Reads scheduled_posts (status='scheduled', scheduled_for <= now), creates queue_jobs, enqueues BullMQ.
   → backend/queue/jobProcessors/publishProcessor.ts: processPublishJob(job)
   → backend/adapters/platformAdapter.ts: publishToPlatform(scheduled_post_id, social_account_id)
   → Token from backend/auth/tokenStore.ts (social_accounts); refresh via backend/auth/tokenRefresh.ts if needed.
   → Platform adapter (e.g. backend/adapters/linkedinAdapter.ts) calls platform API.
   → On success: update scheduled_posts (platform_post_id, status); backend/integration/publishIntegration.ts (recordPostAnalytics, logActivity).

4. Engagement
   → (New) Engagement ingestion service (backend/services/): scheduled job.
   → Query scheduled_posts where platform_post_id IS NOT NULL and status='published'.
   → For each post: token from tokenStore(social_account_id); fetch comments (and counts) via platform; upsert into post_comments(scheduled_post_id, platform_comment_id, ...).

5. AI
   → Callers (e.g. pages/api/community-ai/post/[platform]/[postId].ts or dashboard) load post + post_comments by scheduled_post_id / platform_post_id.
   → backend/services/communityAiOmnivyraService.ts: evaluateEngagement(tenant_id, organization_id, platform, post_data, engagement_metrics from post_comments, brand_voice, ...).
   → backend/services/omnivyraClientV1.ts: evaluateCommunityAiEngagement() → OmniVyra API.
   → Playbooks and auto-rules applied; suggested_actions returned and optionally persisted as community_ai_actions (pending).

6. Actions
   → User or scheduler approves action → pages/api/community-ai/actions/execute.ts (or approve + execute).
   → backend/services/communityAiActionExecutor.ts: executeAction(action, approved)
   → Token from backend/services/platformTokenService.ts (community_ai_platform_tokens by tenant_id, organization_id, platform).
   → backend/services/platformConnectors/*.ts: executeAction(action, authToken) → reply / like / share / follow on platform.
   → Update community_ai_actions (status, execution_result); notifications/webhooks as today.
```

---

## 8. Implementation Impact Summary

**Deprecated**

- **socialPlatformPublisher.publishScheduledPost()** as the implementation of publish (actual platform API call). Callers must switch to canonical path (platformAdapter).
- **Mock token** in **pages/api/social/comments.ts** for fetch/reply. Replace with tokenStore for fetch and with platformConnectors (with appropriate credential resolution) for reply.
- Standalone **reply** helpers in **pages/api/social/comments.ts** (replyToLinkedInComment, etc.) as the only path for reply. Reply must go through platformConnectors (with social_account or tenant/org token as per §5).

**Wrapped**

- **pages/api/social/publish.ts**: No longer call socialPlatformPublisher for publish. Instead: ensure post in scheduled_posts with social_account_id, then call canonical publish path (platformAdapter.publishToPlatform or a single “publish now” helper that does the same).
- **pages/api/social/comments.ts**: Fetch path should use the canonical engagement ingestion service or a shared fetch that uses tokenStore(social_account_id); reply path should use platformConnectors with credentials from social_account (post owner) or tenant/org (Community AI).

**Unchanged**

- **social_accounts** table and **tokenStore** / **tokenRefresh** (and OAuth callbacks under pages/api/auth/*).
- **community_ai_platform_tokens** table and **platformTokenService** (and Community AI connector OAuth under pages/api/community-ai/connectors/*).
- **backend/adapters/platformAdapter.ts** and all **backend/adapters/*Adapter.ts** publish implementations.
- **backend/services/platformConnectors/*.ts** and **communityAiActionExecutor.ts** (action execution and token source: platformTokenService).
- **backend/scheduler/schedulerService.ts**, **backend/queue/jobProcessors/publishProcessor.ts**, **backend/services/structuredPlanScheduler.ts**.
- **post_comments**, **comment_replies**, **comment_likes** schema (existing tables; only usage added).
- **community_ai_actions**, **community_ai_omnivyraService**, **omnivyraClientV1** (evaluateEngagement and action lifecycle).
- **external_api_sources** table and **externalApiService** for non-publish use (trends, health, recommendations); only the use of this store as **publish credential** is removed.
