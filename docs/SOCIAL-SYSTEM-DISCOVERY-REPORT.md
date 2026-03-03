# SOCIAL SYSTEM DISCOVERY REPORT

## 1. Existing Social Configuration

### 1.1 Platform configuration (global / system)

| Location | Responsibility |
|----------|----------------|
| `database/comprehensive-scheduling-schema.sql` (lines 505–522) | **platform_configurations** table: `platform` (unique), `is_enabled`, `posting_limits`, `content_limits`, `media_limits`, `api_configuration`. Global platform limits, no company_id. |
| `lib/platforms.ts` | **PLATFORM_CONFIGS** (key, name, icon, etc.) for UI. |
| `lib/social-auth.ts` | **SOCIAL_AUTH_CONFIGS**: OAuth URLs and scopes per platform (LinkedIn, Twitter, Facebook, Instagram). `generateOAuthUrl()`, `exchangeCodeForToken()`. |

### 1.2 OAuth / tokens / credentials (two separate systems)

**A. User-level (scheduling & publishing)**

| Location | Responsibility |
|----------|----------------|
| `backend/auth/tokenStore.ts` | Encrypt/decrypt and store tokens in **social_accounts** (`access_token`, `refresh_token`). Uses `ENCRYPTION_KEY`. `getToken()`, `setToken()`, `isTokenExpiringSoon()`. |
| `backend/auth/tokenRefresh.ts` | `refreshPlatformToken()` for social_accounts. |
| `pages/api/auth/{linkedin,twitter,instagram,youtube,pinterest}/callback.ts` | OAuth callbacks: create/update **social_accounts**, save encrypted tokens via tokenStore, set `token_expires_at`. |
| `env.example` | Placeholders: `LINKEDIN_CLIENT_ID/SECRET`, `TWITTER_*`, `FACEBOOK_*`, `INSTAGRAM_*`, `NEXT_PUBLIC_BASE_URL`, `JWT_SECRET`, etc. |

**B. Tenant/org-level (Community AI only)**

| Location | Responsibility |
|----------|----------------|
| `backend/services/platformTokenService.ts` | **community_ai_platform_tokens** (tenant_id, organization_id, platform). `saveToken()`, `getToken()`. No encryption in this service. |
| `database/community_ai_platform_tokens.sql` | Table: tenant_id, organization_id, platform, access_token, refresh_token, expires_at. |
| `pages/api/community-ai/connectors/{linkedin,twitter,instagram,facebook,reddit}/auth.ts` + `callback.ts` | Community AI OAuth: redirect to platform, then callback saves to **community_ai_platform_tokens** (tenant/org). |

### 1.3 Company-level configuration

- **social_accounts**: `user_id` only; no `company_id`. Per-user connected accounts.
- **campaigns**: `user_id`; company linkage is via `user_company_roles` / company membership elsewhere, not in campaigns/social_accounts.
- **external_api_sources**: has optional `company_id`; used by `getApiConfigByPlatform(companyId, platform)` for **socialPlatformPublisher** (trend/API registry and optional company-scoped API config for publishing).
- **platform_configurations**: global only; no company_id.
- **Community AI**: tenant_id + organization_id everywhere; no direct link to **social_accounts** or **campaigns**.

### 1.4 Missing responsibilities

- No single “company social config” tying which platforms a company uses and which accounts are allowed.
- No company-level OAuth app configuration (client ids are env-wide).
- No mapping between **social_accounts** (user) and **community_ai_platform_tokens** (tenant/org); two disjoint credential stores.

---

## 2. Posting / Distribution

### 2.1 Where posting logic exists

| Path | Entry | Abstraction | Token / config source |
|------|--------|-------------|------------------------|
| **Queue + platformAdapter** | `backend/queue/jobProcessors/publishProcessor.ts` | `publishToPlatform(scheduled_post_id, social_account_id)` in `backend/adapters/platformAdapter.ts` | **social_accounts** + tokenStore (user-level, encrypted). |
| **Legacy / manual post API** | `pages/api/social/post.ts` | `createLegacyScheduledPost()` → writes **scheduled_posts** (no immediate publish). | User must pass `accountId` (social_accounts.id). |
| **Super-admin publish API** | `pages/api/social/publish.ts` | `publishScheduledPost()` in `backend/services/socialPlatformPublisher.ts` | **external_api_sources** + `getApiConfigByPlatform(null, platform)`; env API keys. |
| **Schedule / plan → DB** | `backend/services/structuredPlanScheduler.ts` | `scheduleStructuredPlan()` → batch insert **scheduled_posts**; no queue job creation in this file. | Resolves **social_accounts** by campaign `user_id` and platform. |

### 2.2 Platform-specific publish implementations

- **backend/adapters/platformAdapter.ts**: Dispatches to per-platform adapters (LinkedIn, X, Instagram, Facebook, YouTube, TikTok, Spotify, Star Maker, Suno, Pinterest). Each adapter implements `publishTo*()` (e.g. `publishToLinkedIn`, `publishToX`).
- **backend/services/socialPlatformPublisher.ts**: Internal `publishToPlatform()` calls `publishToFacebook`, `publishToLinkedIn`, `publishToYouTube`, `publishToTwitter`; others return stub external_post_id. Uses **externalApiService** for config and health.

### 2.3 Scheduling and distribution logic

- **structuredPlanScheduler.ts**: Builds **scheduled_posts** from structured plan (weeks/daily/platforms or execution jobs). Uses **social_accounts** for campaign `user_id`, platform rules from catalog, `scheduleFromExecutionJobs` / `scheduleFromLegacy` / `scheduleFromAllocation`.
- **schedulerService.ts**: `findDuePostsAndEnqueue()`: reads **scheduled_posts** (status=`scheduled`, `scheduled_for` ≤ now), creates **queue_jobs** and BullMQ jobs with `scheduled_post_id`, `social_account_id`, `user_id`. Queue worker then calls **platformAdapter** `publishToPlatform`.
- **dailyContentDistributionPlanService.ts**: AI-generated *daily distribution plan* (day_index, platform, content_type, reasoning); output is planning only, not directly writing scheduled_posts.

### 2.4 Weekly → daily → execution flow connections

- Campaign AI / weekly blueprint → **structured plan** (e.g. from campaignAiOrchestrator / blueprint).  
- **scheduleStructuredPlan(plan, campaignId)** turns plan into **scheduled_posts** rows.  
- **SchedulerService** runs (cron or similar) and enqueues due posts; **publishProcessor** publishes via **platformAdapter**.  
- Activity Workspace and Daily Plan UIs work off execution items and “schedules” in session/local state; “Add to schedule” can call `createLegacyScheduledPost` (e.g. from `pages/api/social/post.ts`). No single codepath that always links “daily execution item” → **scheduled_posts** → queue in one flow.

### 2.5 Current limitations

- Two publish stacks: (1) queue + platformAdapter (user social_accounts), (2) socialPlatformPublisher (external_api_sources, super-admin only). Not unified.
- **socialPlatformPublisher** uses companyId=null in tests and in publish API; company-scoped API config exists in schema but is not consistently used.
- No automatic “publish this daily execution item at this time” that always creates scheduled_post + queue job in one place.
- Stub implementations for several platforms in socialPlatformPublisher (e.g. non-Facebook/LinkedIn/YouTube/X return stub IDs).

---

## 3. Community AI / Engagement

### 3.1 Community AI model and entry points

| Location | Responsibility |
|----------|----------------|
| `backend/services/communityAiOmnivyraService.ts` | `evaluateEngagement(input)` → normalizes brand_voice; if OmniVyra enabled calls **omnivyraClientV1** `evaluateCommunityAiEngagement()`; merges with playbooks and auto-rules; returns analysis, suggested_actions, content_improvement, safety_classification, execution_links. |
| `backend/services/omnivyraClientV1.ts` | `evaluateCommunityAiEngagement()` → `requestOmniVyra('/community/engagement/evaluate', input)`. External OmniVyra API (OMNIVYRA_BASE_URL). |
| `pages/api/community-ai/post/[platform]/[postId].ts` | GET: builds response with `post_details: null`, `engagement_activity: []`, calls `evaluateEngagement()` and returns analysis + suggested_actions etc. **Engagement data not fetched or stored; passed as empty.** |
| `pages/api/community-ai/dashboard.ts`, `platform/[platform].ts` | Also call `evaluateEngagement()` with tenant/org context. |

### 3.2 Engagement analysis and scoring

- **Input to OmniVyra**: tenant_id, organization_id, platform, post_data, engagement_metrics, goals, brand_voice, context.  
- **Output**: analysis text, suggested_actions (array), content_improvement, safety_classification, execution_links.  
- **communityAiOmnivyraService**: After OmniVyra, runs playbook evaluation (`evaluatePlaybookForEvent`), auto-rules (`evaluateAutoRules`), and normalizes suggested_actions (tone, etc.).  
- No in-app “engagement score” or prioritization model; scoring/ranking is inside OmniVyra or playbook rules.

### 3.3 Comments / reactions / activity handling

- **pages/api/social/comments.ts**: POST with action `fetch` | `reply` | `delete`. Fetch: calls platform-specific functions (`fetchLinkedInComments`, `fetchTwitterComments`, etc.) with **mock token** (`mock_token_${accountId}`). Reply: platform-specific reply (LinkedIn, Twitter, etc.). **Fetched comments are not persisted to DB.**  
- **database/step10-comment-engagement.sql**: Defines **post_comments**, **comment_replies**, **comment_likes**, **engagement_rules**. **No application code found that inserts into post_comments** (only schema exists).  
- **activity_feed** (activityLogger): Internal product events (post_published, campaign_updated, etc.); not social platform engagement events.  
- **Activity workspace / daily “activities”**: Planning/execution items (topics, schedules in UI); not comments/likes from platforms.

### 3.4 AI prioritization and response automation

- **community_ai_actions** table: Stores suggested actions (like, reply, share, follow, schedule) with status (pending, approved, executed, failed, skipped).  
- **backend/services/communityAiActionExecutor.ts**: `executeAction(action, approved)` — loads platform connector (LinkedIn, Facebook, Twitter, Instagram, YouTube, Reddit), gets token from **platformTokenService** (community_ai_platform_tokens), validates playbook and history metrics, then executes via connector (reply, like, share, follow) or RPA/manual.  
- **backend/services/platformConnectors/*.ts**: Implement `executeAction(action, authToken)` (reply, like, share, follow) per platform.  
- **backend/services/communityAiScheduler.ts**, **communityAiAutoRuleService.ts**: Scheduler and auto-rules that can produce or filter suggested actions; playbook rules (e.g. reply rate limits) applied in executor.  
- **pages/api/community-ai/actions/execute.ts**, **approve.ts**: HTTP entry points to approve and execute Community AI actions.

### 3.5 Data flow (engagement)

- **Intended**: Post + engagement_metrics → OmniVyra → suggested_actions → (optional) approve → executeAction → platform connector (API/RPA).  
- **Current gap**: Engagement metrics and post details are not ingested from platforms into a central store. Community AI post API passes `post_details: null`, `engagement_activity: []`. Comments API fetches on demand but does not persist to **post_comments**. No pipeline that pulls comments/likes into DB and then runs AI evaluation.

---

## 4. Data Models

### 4.1 Social / accounts

- **social_accounts** (comprehensive-scheduling-schema, step2, etc.):  
  `id`, `user_id`, `platform`, `platform_user_id`, `account_name`, `username`, `profile_picture_url`, `follower_count`, `following_count`, `access_token`, `refresh_token`, `token_expires_at`, `is_active`, `permissions[]`, `last_sync_at`, timestamps.  
  Unique (user_id, platform, platform_user_id). **No company_id.**

- **community_ai_platform_tokens**:  
  `id`, `tenant_id`, `organization_id`, `platform`, `access_token`, `refresh_token`, `expires_at`, timestamps.  
  Used only for Community AI actions (tenant/org scoped).

### 4.2 External platform IDs

- **scheduled_posts**: `platform_post_id` (external ID after publish), `platform`, `social_account_id`.  
- **post_comments** (schema only): `platform_comment_id`, `platform`, `scheduled_post_id`.  
- **community_ai_actions**: `target_id` (platform post/comment ID).  
- **analytics** / performance tables: store external post IDs for recording metrics.

### 4.3 Activity / events

- **activity_feed**: `user_id`, `action_type`, `entity_type`, `entity_id`, `campaign_id`, `metadata`, `created_at`. Internal audit/product actions only.  
- **post_comments**, **comment_replies**, **comment_likes**: Defined in step10-comment-engagement.sql; **not populated by any current code**.  
- **community_ai_actions**: Full lifecycle of suggested actions (tenant, org, platform, action_type, target_id, suggested_text, status, execution_result, etc.).  
- **community_ai_action_logs**: Logs for Community AI events.

### 4.4 Engagement tracking and AI outputs

- **engagement_rules** (step10): user_id, platform, rule_name, rule_type (auto_reply, auto_like, etc.), trigger_conditions, action_config.  
- **community_ai_actions**: Holds AI-suggested actions and execution outcome.  
- **recordPostAnalytics** (analyticsService): Records views, likes, shares, comments for a scheduled_post (e.g. after publish); source can be manual or “platform_api” (when implemented).  
- No dedicated “engagement events” or “activity stream” table that stores raw comments/likes from platforms with a single schema.

### 4.5 Missing for a unified social system

- Company-level link for social accounts (e.g. company_id on social_accounts or a company_social_config table).  
- Unified “social activity” or “engagement event” table fed by platform ingestion (webhooks or polling).  
- Consistent link between **scheduled_posts** / **platform_post_id** and Community AI (e.g. so a post’s comments can be tied to the same post and tenant/org).  
- **post_comments** (and related) population path from platform APIs or webhooks.

---

## 5. Adapter Architecture Status

### 5.1 Publish

- **Unified path (queue)**: `backend/adapters/platformAdapter.ts` — single entry `publishToPlatform(scheduledPostId, socialAccountId)`. Fetches post and account from DB, gets/refreshes token from tokenStore, switches on platform and calls platform-specific `publishTo*()`.  
- **Platform-specific adapters**: `backend/adapters/{linkedin,x,instagram,facebook,youtube,tiktok,spotify,starmaker,suno,pinterest}Adapter.ts`. Each exports `publishTo<Platform>()`.  
- **Duplicate/alternate path**: `socialPlatformPublisher.publishScheduledPost()` uses **externalApiService** and its own `publishToPlatform(platform, payload, apiConfig)` with different token source (external_api_sources / env). So there are **two publish abstractions** with different credentials and callers.

### 5.2 Fetch activities / comments

- **No unified adapter.**  
- **pages/api/social/comments.ts**: Inline `fetchLinkedInComments`, `fetchTwitterComments`, `fetchFacebookComments`, `fetchInstagramComments` and reply helpers; uses mock token; not used by Community AI and does not write to **post_comments**.  
- Community AI post API does not call any “fetchActivities” or “fetchComments”; it passes empty engagement.

### 5.3 Reply (and like / follow / share)

- **Unified for Community AI only**: `communityAiActionExecutor.executeAction()` loads a **platformConnector** (LinkedIn, Facebook, Twitter, Instagram, YouTube, Reddit) and calls `connector.executeAction(action, authToken)`. Token from **platformTokenService** (community_ai_platform_tokens).  
- **backend/services/platformConnectors/*.ts**: Each implements `executeAction` (reply, like, share, follow).  
- **pages/api/social/comments.ts** reply path: separate from Community AI; uses social account token (conceptually) but currently mock; not shared with platformConnectors.

### 5.4 Summary

- **publish()**: Two implementations — platformAdapter (user tokens, queue) and socialPlatformPublisher (external API config, super-admin).  
- **fetchActivities()**: Does not exist as a unified abstraction; comments are fetched only in one API route and not persisted.  
- **reply()**: Exists for Community AI via platformConnectors + platformTokenService; and separately (mock) in social/comments.  
- **Coupling**: Publish is tied to either user social_accounts or external_api_sources; engagement/reply is tied to tenant/org community_ai_platform_tokens. No single “platform adapter” interface that covers publish + fetch + reply with one credential model.

---

## 6. Execution Pipeline

### 6.1 How generated content reaches execution (publish)

1. **Planning**: Campaign AI / weekly blueprint produces structured plan (e.g. weeks with daily/platform content).  
2. **Scheduling**: `scheduleStructuredPlan(plan, campaignId)` in **structuredPlanScheduler** builds rows for **scheduled_posts** (user_id, social_account_id, campaign_id, platform, content, scheduled_for, status=`scheduled`). Social accounts resolved by campaign `user_id` and platform.  
3. **Enqueue**: **schedulerService.findDuePostsAndEnqueue()** (cron) selects scheduled_posts where status=`scheduled` and scheduled_for ≤ now, creates **queue_jobs** and BullMQ jobs (scheduled_post_id, social_account_id, user_id).  
4. **Publish**: **publishProcessor.processPublishJob(job)** loads scheduled_post and social_account, calls **platformAdapter.publishToPlatform(scheduled_post_id, social_account_id)** → token from tokenStore → platform adapter (e.g. LinkedIn API).  
5. **Post-publish**: Update scheduled_posts (platform_post_id, status), **integratePublishSuccess** (recordPostAnalytics, logActivity), optional campaign completion check.  
6. **Alternative**: User or super-admin can create a post via **pages/api/social/post** (createLegacyScheduledPost) or **pages/api/social/publish** (super-admin only, uses socialPlatformPublisher). The former only creates scheduled_posts; actual publish happens when scheduler picks them up (or could be extended to enqueue). The latter publishes immediately using external_api_sources config.

### 6.2 How engagement events enter the system

- **Today they do not.**  
- Comments can be fetched on demand via **pages/api/social/comments** (action=fetch); result is returned to client only; no write to **post_comments** or any central activity store.  
- Community AI APIs receive `post_details` and `engagement_activity` in the interface but callers pass null/empty; no webhook or job that pulls from platforms and writes engagement into DB then triggers AI.

### 6.3 Where AI logic is triggered

- **Community AI (engagement)**: When a client calls `GET /api/community-ai/post/[platform]/[postId]` (or dashboard/platform endpoints), server calls `evaluateEngagement()` with tenant/org/brand_voice and empty post/engagement data → OmniVyra + playbooks/auto-rules → suggested_actions returned.  
- **Action execution**: User (or scheduler) approves action → **pages/api/community-ai/actions/execute** → **communityAiActionExecutor.executeAction()** → platformConnector (reply/like/follow/share) using community_ai_platform_tokens.  
- **No automated trigger** that: fetches new comments → stores them → runs evaluateEngagement → creates community_ai_actions for prioritization.

---

## 7. Gap Analysis

### 7.1 Reusable pieces

- **platformAdapter** + per-platform publish adapters (user tokens): Ready for single “queue + user account” publish flow.  
- **platformConnectors** (Community AI): Ready for reply/like/follow/share with tenant/org tokens.  
- **structuredPlanScheduler**: Can produce scheduled_posts from plans; needs consistent wiring to scheduler + one publish path.  
- **communityAiOmnivyraService** + OmniVyra: Ready to consume post + engagement_metrics once provided.  
- **community_ai_actions** + executor: Ready for prioritization and execution if suggested_actions are created and approved.  
- **post_comments** (and related) schema: Exists; needs ingestion and linkage to scheduled_posts / platform_post_id.  
- **activity_feed**: Exists for product events; separate from “social engagement” stream.

### 7.2 Fragmented

- **Two credential systems**: user social_accounts (tokenStore) vs tenant/org community_ai_platform_tokens (platformTokenService). No shared “company/tenant social account” concept.  
- **Two publish paths**: queue + platformAdapter vs socialPlatformPublisher + external_api_sources; different callers and config.  
- **Comments**: Fetch in one API, no persistence; Community AI expects engagement in input but gets none.  
- **Company vs user vs tenant**: campaigns and scheduling are user-centric; Community AI is tenant/org-centric; external_api_sources can have company_id but is not used consistently.

### 7.3 Duplicated

- Publish logic: platformAdapter’s per-platform publish vs socialPlatformPublisher’s internal publishToFacebook/LinkedIn/etc.  
- “Reply” concept: platformConnectors (Community AI) vs reply helpers in pages/api/social/comments.ts (mock token).  
- OAuth flows: /api/auth/{platform} (→ social_accounts) vs /api/community-ai/connectors/{platform} (→ community_ai_platform_tokens).

### 7.4 Missing for goals

- **Unified Social Adapter Layer**: One interface (publish, fetchActivities, reply) with one credential/config model (or clear mapping company/tenant → credentials).  
- **Central Activity Stream**: Ingestion from platforms (comments, likes, etc.) into a single store (e.g. post_comments + optional unified activity table), linked to scheduled_posts/platform_post_id and tenant/org where needed.  
- **AI Prioritization Pipeline**: Job or webhook that (1) fetches/persists engagement, (2) runs evaluateEngagement with real data, (3) creates/updates community_ai_actions and (4) optional auto-prioritization or approval flow.  
- **Strategic Feedback Loop**: No path that ties “published post → platform engagement → AI analysis → content/strategy recommendations” back into campaign or content planning (e.g. campaignAiOrchestrator or weekly blueprint).

---

## 8. Risks

- **Architecture**: Two credential and two publish stacks increase complexity and inconsistency (which token is used when, which path is used for “company” vs “user” posts).  
- **Scaling**: No unified adapter implies more branches and configs as platforms grow; scheduler and queue are sound but duplicate publish logic can diverge.  
- **Multi-tenant**: social_accounts are per-user; Community AI is per-tenant/org. Companies with multiple users and one “brand” presence have no clear model (which account to use for company-level publish or engagement).  
- **Token/security**: tokenStore encrypts; community_ai_platform_tokens table stores tokens (patch may add encryption elsewhere). Two stores increase surface and key management.  
- **Tight coupling**: Community AI and scheduling/publish share no single “platform” abstraction; reply uses different tokens than publish, so one “post + respond to comments” flow would need to bridge both.

---

## 9. Recommended Next Implementation Step (ONE STEP ONLY)

**Define and document a single “Platform Operation” contract (interface) and which credential source backs it for each operation (publish vs fetch vs reply).**

- Do not change code yet.  
- Produce a short design doc that: (1) names one canonical publish path (e.g. queue + platformAdapter vs socialPlatformPublisher) and how the other will be deprecated or routed through it; (2) specifies how “fetch activities” (comments/likes) will be exposed (one service + one token source); (3) states how reply will be exposed (keep platformConnectors but clarify token source: tenant/org only or also user when applicable); (4) states whether company/tenant will map to user social_accounts, community_ai_platform_tokens, or a future unified store.  
- This gives a single reference for the next concrete change (e.g. “add fetchActivities to platformAdapter and wire it to one credential source” or “add ingestion job that writes to post_comments”).
