# PHASE 1 IMPLEMENTATION REPORT
## Community Engagement Command Center — Engagement Data Foundation

**Date:** March 8, 2025  
**Scope:** Unified Engagement Data Model (Phase 1)  
**Status:** Implemented

---

## 1. Database Migrations

### File: `database/engagement_unified_model.sql`

**New Tables:**

| Table | Purpose |
|-------|---------|
| **engagement_sources** | Platform metadata (linkedin, twitter, instagram, facebook, youtube, reddit). Columns: id, platform, source_type (api\|rpa), created_at. Unique on platform. |
| **engagement_authors** | Normalized authors. Columns: id, platform, platform_user_id, username, display_name, profile_url, avatar_url, created_at, updated_at. Unique on (platform, platform_user_id). |
| **engagement_threads** | Conversation thread container. Columns: id, platform, platform_thread_id, root_message_id, source_id, organization_id, created_at, updated_at. Indexes on platform_thread_id, source_id, organization_id. |
| **engagement_messages** | Unified messages. Columns: id, thread_id, source_id, author_id, platform, platform_message_id, message_type (comment\|reply\|mention\|dm), parent_message_id, content, raw_payload, like_count, reply_count, sentiment_score, created_at, platform_created_at. Optional post_comment_id for traceability. |

**Indexes (Performance):**
- `engagement_messages(platform_created_at DESC NULLS LAST)` — inbox queries
- `engagement_messages(thread_id)`
- `engagement_messages(author_id)`
- `engagement_messages(platform)`
- Unique `(thread_id, platform_message_id)` for upsert

**Seed:** engagement_sources seeded with linkedin, twitter, instagram, facebook, youtube, reddit (source_type: api).

**Run order:** After `step10-comment-engagement.sql`.

---

## 2. New Services

### engagementNormalizationService (`backend/services/engagementNormalizationService.ts`)

| Function | Responsibility |
|----------|----------------|
| **resolveSource(platform, sourceType)** | Resolve or create engagement_source by platform. Returns source id or null. |
| **resolveAuthor(input)** | Resolve or create engagement_author. Uses platform_user_id (fallback: username, profile_url, author_name). |
| **resolveThread(input)** | Resolve or create engagement_thread. platform_thread_id = platform_post_id (conversation under a post). Scoped by organization_id when present. |
| **insertMessage(input)** | Upsert engagement_message by (thread_id, platform_message_id). |
| **syncFromPostComments(rows, context)** | Full sync: resolve source, thread; for each row resolve author, insert message. Queries post_comments for post_comment_id traceability. |

---

## 3. Changes to engagementIngestionService

### File: `backend/services/engagementIngestionService.ts`

**Additions:**
- Import `getLatestCampaignVersionByCampaignId` and `syncFromPostComments`
- New helper `syncToUnifiedEngagement(rows, context)` — non-blocking; calls `syncFromPostComments`; logs errors, does not fail ingestion
- In `ingestComments()`: after `persistComments(rows)`, when `ingested > 0`:
  1. Resolve `organization_id` from `post.campaign_id` via `getLatestCampaignVersionByCampaignId`
  2. Call `syncToUnifiedEngagement(rows, { platform_post_id, organization_id, platform, scheduled_post_id })` (fire-and-forget with `.catch(() => {})`)

**Preserved:**
- `persistComments` unchanged; post_comments pipeline unchanged
- `evaluatePostEngagement` still triggered after ingestion; OmniVyra still reads post_comments

---

## 4. API Endpoints

### GET `/api/engagement/messages`

**File:** `pages/api/engagement/messages.ts`

**Query params:** organization_id (required), platform, thread_id, author_id, start_date, end_date, limit (default 50, max 100)

**Auth:** `enforceCompanyAccess` — user must have access to organization.

**Behavior:**
- Scope by organization via engagement_threads.organization_id
- When thread_id provided: verify thread belongs to org before returning messages
- Order by platform_created_at DESC
- Returns: id, thread_id, author_id, platform, platform_message_id, message_type, parent_message_id, content, like_count, reply_count, sentiment_score, created_at, platform_created_at

### GET `/api/engagement/threads`

**File:** `pages/api/engagement/threads.ts`

**Query params:** organization_id (required), platform, source_id, start_date, end_date, limit (default 50, max 100)

**Auth:** `enforceCompanyAccess`

**Behavior:**
- Filter by organization_id
- Order by updated_at DESC
- Returns: id, platform, platform_thread_id, root_message_id, source_id, organization_id, created_at, updated_at

---

## 5. Threading Strategy

**Rules:**
- One thread per (platform, platform_post_id, organization_id)
- `platform_thread_id` = `platform_post_id` (the post ID on the platform)
- When `comment.parent_comment_id` is NULL: top-level comment; thread created if not exists
- When `parent_comment_id` exists: message attached to parent's thread (Phase 1 sync treats all as top-level; parent resolution supported in schema for future use)

**Resolution flow:**
1. Resolve source by platform
2. Resolve thread by (platform, platform_thread_id, organization_id)
3. For each comment: resolve author, insert message with thread_id

---

## 6. Backward Compatibility

| Component | Status |
|-----------|--------|
| post_comments | Unchanged; all writes go through existing persistComments |
| engagementEvaluationService | Unchanged; still reads post_comments |
| OmniVyra | Unchanged; evaluateCommunityAiEngagement receives same input shape |
| community_ai_actions | Unchanged |
| engagementIngestionService.ingestComments | Extended with sync; sync failures do not affect return value |
| engagementPollingProcessor | Unchanged; calls ingestComments as before |

**Sync is non-blocking:** Failures in syncToUnifiedEngagement are logged but do not affect ingestion success or evaluation trigger.

---

## 7. Deployment Steps

1. **Run migration:**
   ```bash
   psql $DATABASE_URL -f database/engagement_unified_model.sql
   ```
   Or apply via Supabase migrations if using migration tooling.

2. **Verify tables:** engagement_sources, engagement_authors, engagement_threads, engagement_messages exist.

3. **Deploy code:** No env changes required. Sync runs automatically on next ingestion.

4. **Backfill (optional):** Existing post_comments are not backfilled automatically. To backfill, run a one-off job that:
   - Selects post_comments with scheduled_post_id
   - Groups by (scheduled_post_id, platform_post_id from scheduled_posts)
   - Calls syncFromPostComments for each group

5. **Smoke test:**
   - Trigger engagement polling or ingest comments for a published post
   - Verify engagement_messages rows created
   - Call GET /api/engagement/threads?organization_id=X
   - Call GET /api/engagement/messages?organization_id=X

---

## 8. OmniVyra Compatibility

### Adapter: `buildOmnivyraEngagementInput` (`backend/services/omnivyraEngagementAdapter.ts`)

**Purpose:** Build OmniVyra input from engagement_messages (optional alternative to post_comments).

**Usage:** When evaluation should run on unified model:
```ts
const input = await buildOmnivyraEngagementInput({
  tenant_id,
  organization_id,
  platform,
  brand_voice,
  thread_id,
  post_data: { platform_post_id, content, ... },
  context: { source: 'engagement_messages' },
});
if (input) {
  await evaluateEngagement(input);
}
```

**Default behavior:** engagementEvaluationService continues to use post_comments. No changes to existing OmniVyra flow.

---

*End of Phase 1 Implementation Report*
