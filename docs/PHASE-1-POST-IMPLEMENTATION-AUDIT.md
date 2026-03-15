# PHASE 1 POST-IMPLEMENTATION AUDIT
## Community Engagement Command Center — Engagement Data Foundation

**Audit Date:** March 8, 2025  
**Scope:** Verification of Phase 1 implementation  
**Methodology:** Codebase inspection — correctness, integration safety, completeness only. No improvement suggestions.

---

## 1. Database Schema Verification

### 1.1 engagement_sources

| Attribute | Value |
|-----------|-------|
| **Schema** | id (UUID PK), platform (TEXT NOT NULL), source_type (TEXT NOT NULL DEFAULT 'api'), created_at (TIMESTAMPTZ) |
| **Indexes** | idx_engagement_sources_platform (UNIQUE on platform) |
| **Constraints** | None beyond NOT NULL and default |
| **Foreign Keys** | None (leaf table) |
| **Org/Tenant Scoping** | None — platform registry, not tenant-scoped |

**Verified:** Table exists in `database/engagement_unified_model.sql`. Seed inserts linkedin, twitter, instagram, facebook, youtube, reddit with source_type 'api'. ON CONFLICT (platform) DO NOTHING for idempotent seed.

---

### 1.2 engagement_authors

| Attribute | Value |
|-----------|-------|
| **Schema** | id (UUID PK), platform (TEXT NOT NULL), platform_user_id (TEXT NOT NULL), username, display_name, profile_url, avatar_url, created_at, updated_at |
| **Indexes** | idx_engagement_authors_platform_user (UNIQUE on platform, platform_user_id), idx_engagement_authors_platform |
| **Constraints** | Uniqueness on (platform, platform_user_id) |
| **Foreign Keys** | None (leaf table) |
| **Org/Tenant Scoping** | None — authors are global across tenants |

**Verified:** Table exists. Unique constraint (platform, platform_user_id) enforced via unique index.

---

### 1.3 engagement_threads

| Attribute | Value |
|-----------|-------|
| **Schema** | id (UUID PK), platform (TEXT NOT NULL), platform_thread_id (TEXT NOT NULL), root_message_id (UUID), source_id (UUID FK), organization_id (UUID), created_at, updated_at |
| **Indexes** | idx_engagement_threads_platform_thread, idx_engagement_threads_source, idx_engagement_threads_organization, idx_engagement_threads_platform_thread_org (UNIQUE on platform, platform_thread_id, organization_id WHERE organization_id IS NOT NULL) |
| **Constraints** | Partial unique on (platform, platform_thread_id, organization_id) when organization_id is not null |
| **Foreign Keys** | source_id → engagement_sources(id) ON DELETE SET NULL |
| **Org/Tenant Scoping** | organization_id column; threads scoped by organization |

**Verified:** Table exists. organization_id used for tenant scoping.

---

### 1.4 engagement_messages

| Attribute | Value |
|-----------|-------|
| **Schema** | id (UUID PK), thread_id (UUID NOT NULL FK), source_id (UUID FK), author_id (UUID FK), platform (TEXT NOT NULL), platform_message_id (TEXT NOT NULL), message_type (TEXT DEFAULT 'comment'), parent_message_id (UUID FK self), content, raw_payload (JSONB), like_count (INT DEFAULT 0), reply_count (INT DEFAULT 0), sentiment_score (NUMERIC), created_at, platform_created_at. Optional post_comment_id (UUID FK) |
| **Indexes** | idx_engagement_messages_platform_thread (UNIQUE on thread_id, platform_message_id), idx_engagement_messages_platform_message_id, idx_engagement_messages_thread, idx_engagement_messages_author, idx_engagement_messages_platform_created (DESC NULLS LAST), idx_engagement_messages_platform, idx_engagement_messages_post_comment (partial, WHERE post_comment_id IS NOT NULL) |
| **Constraints** | Unique on (thread_id, platform_message_id) |
| **Foreign Keys** | thread_id → engagement_threads(id) ON DELETE CASCADE; source_id → engagement_sources(id) ON DELETE SET NULL; author_id → engagement_authors(id) ON DELETE SET NULL; parent_message_id → engagement_messages(id) ON DELETE SET NULL; post_comment_id → post_comments(id) ON DELETE SET NULL |
| **Org/Tenant Scoping** | Via engagement_threads.organization_id (messages belong to threads) |

**Verified:**
- engagement_messages.thread_id → engagement_threads.id ✓
- engagement_messages.author_id → engagement_authors.id ✓
- engagement_messages.source_id → engagement_sources.id ✓
- Index for inbox: engagement_messages(platform_created_at DESC NULLS LAST) ✓
- Index engagement_messages(thread_id) ✓
- Index engagement_messages(author_id) ✓

**Note:** post_comment_id FK requires post_comments to exist. Migration fails if post_comments does not exist (run step10-comment-engagement.sql first).

---

## 2. Ingestion Sync Pipeline

### 2.1 Flow Verification

**Expected flow:**
```
Platform API → engagementIngestionService.ingestComments()
  → persistComments(rows) → post_comments
  → syncToUnifiedEngagement(rows, context)
    → engagementNormalizationService.syncFromPostComments(syncRows, context)
```

**Verified flow in `engagementIngestionService.ts`:**
1. `persistComments(rows)` — line 305; writes to post_comments ✓
2. When `ingested > 0`: resolves organization_id from campaign (lines 307–311) ✓
3. `syncToUnifiedEngagement(rows, {...}).catch(() => {})` — line 312; fire-and-forget ✓
4. `syncToUnifiedEngagement` calls `syncFromPostComments` via dynamic import (line 251) ✓

### 2.2 Sync Failure Behavior

- **Non-blocking:** `syncToUnifiedEngagement(...).catch(() => {})` — sync failures do not affect return value ✓
- **Error handling:** try/catch in syncToUnifiedEngagement; logs `[engagementIngestion] unified sync failed`; does not throw ✓
- **Ingestion success:** `return { success: true, ingested }` occurs regardless of sync result ✓

### 2.3 post_comments as Source of Truth

- persistComments writes to post_comments first ✓
- engagementEvaluationService reads from post_comments (getCommentsForScheduledPost) ✓
- Sync reads from in-memory rows and post_comments (for post_comment_id lookup); does not modify post_comments ✓

---

## 3. Threading Implementation

### 3.1 Thread Resolution Logic

**resolveThread (engagementNormalizationService):**
- Looks up by (platform, platform_thread_id, organization_id) ✓
- platform_thread_id = platform_post_id (conversation under a post) ✓
- Creates thread if not found ✓

**syncFromPostComments:**
- One thread per (platform, platform_post_id, organization_id) ✓
- platform_post_id passed as platform_thread_id ✓

### 3.2 root_message_id

- **Schema:** engagement_threads.root_message_id exists (UUID, nullable) ✓
- **Population:** resolveThread accepts root_message_id; syncFromPostComments does **not** pass it — always null ✓
- **Gap:** root_message_id is never populated in current sync flow.

### 3.3 parent_message_id

- **Schema:** engagement_messages.parent_message_id exists (self-referential FK) ✓
- **Sync behavior:** syncFromPostComments always passes `parent_message_id: null` (line 263) ✓
- **Reason:** IngestCommentRow has no parent_comment_id; normalizers do not populate it. All comments treated as top-level ✓
- **Replies:** Schema supports parent_message_id; sync does not populate it because ingestion does not provide parent data. Replies would inherit parent thread only if ingestion provided parent_comment_id and sync resolved it — not implemented in Phase 1 ✓

---

## 4. Author Normalization

### 4.1 resolveAuthor Logic

**engagementNormalizationService.resolveAuthor:**
- Selects by (platform, platform_user_id) ✓
- If exists: returns existing id ✓
- If not: inserts new row with platform, platform_user_id, username, display_name, profile_url, avatar_url ✓

### 4.2 platform_user_id Fallback

**syncFromPostComments (line 244–246):**
```
platformUserId = (row.author_username || row.author_profile_url || row.author_name || '').toString().trim() || `anon_${row.platform_comment_id}`
```
- Fallback order: author_username → author_profile_url → author_name → anon_{platform_comment_id} ✓

### 4.3 Uniqueness

- Unique index idx_engagement_authors_platform_user on (platform, platform_user_id) ✓
- Prevents duplicate authors per platform+user ✓

---

## 5. Source Registry

### 5.1 engagement_sources Behavior

- One row per platform ✓
- Seed platforms: linkedin, twitter, instagram, facebook, youtube, reddit ✓
- source_type: 'api' for all seeded rows ✓

### 5.2 Uniqueness

- Unique index idx_engagement_sources_platform on (platform) ✓
- resolveSource: select by platform; insert if not exists ✓
- INSERT ... ON CONFLICT (platform) DO NOTHING for seed ✓

---

## 6. OmniVyra Compatibility

### 6.1 engagementEvaluationService

- **Data source:** getCommentsForScheduledPost queries `post_comments` (line 85) ✓
- **No engagement_messages:** engagementEvaluationService does not reference engagement_messages ✓
- **Unchanged:** Still uses post_comments exclusively ✓

### 6.2 buildOmnivyraEngagementInput

- **Location:** backend/services/omnivyraEngagementAdapter.ts ✓
- **Existence:** buildOmnivyraEngagementInput(options) exported ✓
- **Behavior:** Fetches engagement_messages for thread_id, joins engagement_authors, normalizes to post_comments-like shape ✓
- **Optional:** Not called by engagementEvaluationService ✓
- **Non-breaking:** engagementEvaluationService unchanged; adapter is additive ✓

---

## 7. Engagement APIs

### 7.1 GET /api/engagement/messages

**File:** pages/api/engagement/messages.ts ✓

| Aspect | Status |
|--------|--------|
| **Organization scoping** | Required organization_id; enforceCompanyAccess; scoped via engagement_threads.organization_id ✓ |
| **Thread ownership** | When thread_id provided, verifies thread belongs to org before returning messages ✓ |
| **Pagination** | limit param (default 50, max 100) ✓ |
| **Filters** | platform, thread_id, author_id, start_date, end_date ✓ |
| **Order** | platform_created_at DESC ✓ |

### 7.2 GET /api/engagement/threads

**File:** pages/api/engagement/threads.ts ✓

| Aspect | Status |
|--------|--------|
| **Organization scoping** | Required organization_id; enforceCompanyAccess; .eq('organization_id', organizationId) ✓ |
| **Pagination** | limit param (default 50, max 100) ✓ |
| **Filters** | platform, source_id, start_date, end_date ✓ |
| **Order** | updated_at DESC ✓ |

---

## 8. Data Consistency

### 8.1 Sync Mapping

**syncFromPostComments maps:**
- platform_comment_id → platform_message_id ✓
- content → content ✓
- platform_created_at → platform_created_at ✓
- like_count, reply_count → like_count, reply_count ✓
- author → resolveAuthor → author_id ✓

### 8.2 Traceability

- post_comment_id populated when post_comments row exists (commentIdByPlatformId lookup) ✓
- Enables join: engagement_messages.post_comment_id → post_comments.id ✓

### 8.3 Upsert Idempotency

- insertMessage uses upsert on (thread_id, platform_message_id) ✓
- Duplicate sync of same comment updates existing row; no duplicate messages ✓

**Note:** Data consistency cannot be fully verified without live data. Schema and code paths support correct mapping.

---

## 9. Performance Indexes

### 9.1 Inbox Query Indexes

| Index | Purpose | Verified |
|-------|---------|----------|
| idx_engagement_messages_platform_created | ORDER BY platform_created_at DESC | ✓ (DESC NULLS LAST) |
| idx_engagement_messages_thread | Filter by thread_id | ✓ |
| idx_engagement_messages_author | Filter by author_id | ✓ |
| idx_engagement_messages_platform | Filter by platform | ✓ |

### 9.2 Query Plan

- Messages API: `.order('platform_created_at', { ascending: false, nullsFirst: false }).limit(limit)` ✓
- Index idx_engagement_messages_platform_created supports this order ✓
- Threads API: `.order('updated_at', { ascending: false })` — no dedicated index on updated_at; uses primary/table scan or existing indexes ✓

---

## 10. Implementation Gaps

| Gap | Severity | Description |
|-----|----------|-------------|
| **root_message_id never populated** | Low | resolveThread accepts root_message_id but sync never passes it. Column always null. |
| **parent_message_id always null** | Low | Sync always passes parent_message_id: null. Reply threading not implemented; schema supports it. |
| **post_comment_id FK blocks migration** | Medium | ALTER TABLE engagement_messages ADD COLUMN post_comment_id REFERENCES post_comments fails if post_comments does not exist. Migration requires step10-comment-engagement.sql first. |
| **engagement_sources seed ON CONFLICT** | Low | INSERT ON CONFLICT (platform) requires unique constraint. idx_engagement_sources_platform provides it. If constraint name differs, seed could fail on re-run — PostgreSQL typically uses column list for ON CONFLICT. |
| **threads.updated_at index** | Low | No index on engagement_threads.updated_at. Threads API orders by updated_at; may not use index for large datasets. |

---

*End of Phase 1 Post-Implementation Audit*
