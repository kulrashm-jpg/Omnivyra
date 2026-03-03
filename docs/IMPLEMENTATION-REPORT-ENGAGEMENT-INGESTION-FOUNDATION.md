# IMPLEMENTATION REPORT — ENGAGEMENT INGESTION FOUNDATION

## 1. Files Modified

- **Created:** `backend/services/engagementIngestionService.ts`
- **Modified:** `pages/api/social/comments.ts`

## 2. New Service Overview

**engagementIngestionService** is the canonical service for fetching platform engagement (comments) and persisting into `post_comments`. It:

- **Input:** `ingestComments(scheduled_post_id)` — loads the scheduled post via existing `getScheduledPost`, reads `platform`, `platform_post_id`, `social_account_id`; resolves token with **tokenStore** (same credential system as publishing); fetches comments via platform-specific fetch (LinkedIn, Twitter, Facebook, Instagram); normalizes raw API responses into a single row shape; upserts into `post_comments` keyed by `(scheduled_post_id, platform_comment_id)`.
- **Helpers:** `getCommentsForScheduledPost(scheduled_post_id)` returns comments from DB for a post. `ingestRecentPublishedPosts()` finds all `scheduled_posts` where `status = 'published'` and `platform_post_id IS NOT NULL`, then calls `ingestComments` for each (no scheduler wiring; function is ready to be called from a job/cron).
- **No Community AI, playbooks, scoring, or auto-actions** — ingestion and persistence only.

## 3. Data Flow After Change

**Fetch via API:**

```text
POST /api/social/comments { action: 'fetch', scheduled_post_id } or { action: 'fetch', platform, postId, accountId }
  → Resolve scheduled_post_id (from body or lookup by platform_post_id + social_account_id)
  → engagementIngestionService.ingestComments(scheduled_post_id)
       → getScheduledPost(scheduled_post_id)
       → getToken(social_account_id)  [tokenStore]
       → fetchCommentsFromPlatform(platform, platform_post_id, access_token)
       → normalizeCommentsForPlatform(...) → IngestCommentRow[]
       → persistComments(rows)  [upsert post_comments]
  → getCommentsForScheduledPost(scheduled_post_id)
  → response { data: comments, ingested }
```

**Polling (when wired):**

```text
ingestRecentPublishedPosts()
  → select scheduled_posts where status='published' and platform_post_id is not null
  → for each: ingestComments(id)
  → return { processed, totalIngested, errors }
```

## 4. Duplication Prevention Strategy

- **Upsert on `(scheduled_post_id, platform_comment_id)`:** The table has `UNIQUE (scheduled_post_id, platform_comment_id)`. All inserts go through `persistComments()`, which uses Supabase `upsert(..., { onConflict: 'scheduled_post_id,platform_comment_id', ignoreDuplicates: false })`. So the same comment (same platform id) is updated in place on re-run (e.g. `updated_at`, counts) and no duplicate rows are created.
- **Idempotent ingest:** Multiple calls to `ingestComments(scheduled_post_id)` for the same post are safe; they re-fetch from the platform and upsert, so the DB state reflects the latest fetched data without duplicating comments.

## 5. What Remains Unchanged

- **DB schema:** No new tables; no changes to `post_comments` or any other table.
- **Publish flow:** `platformAdapter`, `publishNowService`, queue, and scheduler are untouched.
- **Token systems:** Only `tokenStore` (social_accounts) is used for fetch; no change to tokenStore or platformTokenService.
- **Community AI:** No calls to OmniVyra, playbooks, or action executor.
- **Reply path in comments API:** Reply action still uses the existing (deprecated) mock-token reply helpers; unchanged behavior until reply is migrated per canonical design.
- **Adapters:** No new adapter layer; fetch logic lives inside the ingestion service (extracted from the former inline logic in comments API).

## 6. Verification Notes

- **Comments persist:** After a fetch, comments are stored in `post_comments` with `scheduled_post_id` set; subsequent reads use `getCommentsForScheduledPost`, so data comes from DB.
- **No duplicate rows:** Upsert on `scheduled_post_id` + `platform_comment_id` ensures the same comment is not inserted twice; re-running ingest updates existing rows.
- **social/comments fetch returns DB data:** The fetch action now calls `ingestComments` then `getCommentsForScheduledPost` and returns `data: comments` (DB rows), plus `ingested` count.
- **Existing publish flow untouched:** No changes to `platformAdapter`, `publishProcessor`, `schedulerService`, or `publishNowService`.
