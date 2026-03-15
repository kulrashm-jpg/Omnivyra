# PHASE 2 POST-IMPLEMENTATION AUDIT

**Community Engagement Command Center — Phase 2 Backend Verification**

---

## 1 Service Implementation

| Service | Path | Status | Exported Function | Signature |
|---------|------|--------|-------------------|-----------|
| engagementThreadService | `backend/services/engagementThreadService.ts` | ✓ | `getThreads` | `getThreads(filters: GetThreadsFilters): Promise<ThreadSummary[]>` |
| engagementMessageService | `backend/services/engagementMessageService.ts` | ✓ | `getThreadMessages` | `getThreadMessages(thread_id: string): Promise<ThreadMessage[]>` |
| engagementAuthorService | `backend/services/engagementAuthorService.ts` | ✓ | `getAuthor` | `getAuthor(author_id: string): Promise<AuthorWithStats \| null>` |
| engagementThreadPriorityService | `backend/services/engagementThreadPriorityService.ts` | ✓ | `scoreThreadPriority` | `scoreThreadPriority(input: ThreadPriorityInput): ThreadPriorityResult` |
| engagementAiAssistantService | `backend/services/engagementAiAssistantService.ts` | ✓ | `generateReplySuggestions` | `generateReplySuggestions(message_id, organization_id, brand_voice?): Promise<GenerateReplySuggestionsResult>` |

**Note:** `generateReplySuggestions` signature includes optional `brand_voice` as third parameter; expected `(message_id, organization_id)` is satisfied.

---

## 2 Database Migration Verification

**File:** `database/engagement_phase2_extensions.sql`

| Column | Type | Default | Index |
|--------|------|---------|-------|
| `engagement_threads.priority_score` | NUMERIC | 0 | ✓ `idx_engagement_threads_priority` (DESC NULLS LAST, partial: organization_id IS NOT NULL) |
| `engagement_threads.unread_count` | INTEGER | 0 | — |

Migration uses `ADD COLUMN IF NOT EXISTS`; safe to run multiple times.

---

## 3 Inbox API Verification

**Endpoint:** `GET /api/engagement/inbox`

| Item | Status |
|------|--------|
| Organization scoping | ✓ `organization_id` required; `enforceCompanyAccess` applied |
| Filter: platform | ✓ `platform` query param passed to `getThreads` |
| Filter: priority | ✓ `priority` (high/medium/low) passed to `getThreads` |
| Filter: start_date | ✓ `start_date` passed to `getThreads` |
| Filter: end_date | ✓ `end_date` passed to `getThreads` |
| Limit | ✓ `limit` (default 50, max 100) |

**Returned fields:**

| Field | Status |
|-------|--------|
| thread_id | ✓ |
| platform | ✓ |
| author_name | ✓ (from `author_summary`) |
| author_username | ⚠ Always `null` (not populated from author data) |
| latest_message | ✓ |
| latest_message_time | ✓ |
| priority_score | ✓ |
| unread_count | ✓ |
| message_count | ✓ |

**Sorting:** ✓ Results sorted by `latest_message_time DESC` in `getThreads` (line 131–135).

---

## 4 Message Thread Retrieval

**Service:** `engagementMessageService.getThreadMessages(thread_id)`

| Item | Status |
|------|--------|
| Data source | ✓ `engagement_messages` with `engagement_authors` join |
| message_id | ✓ |
| author | ✓ (id, username, display_name, profile_url, avatar_url) |
| content | ✓ |
| platform | ✓ |
| message_type | ✓ |
| parent_message_id | ✓ |
| like_count | ✓ |
| reply_count | ✓ |
| created_at | ✓ (as `created_at` and `platform_created_at`) |

**API:** `GET /api/engagement/messages?thread_id=X` returns messages for a thread with org scoping. It uses direct Supabase queries rather than `getThreadMessages`; response includes `author_id` but not the full author object. The service is used by `engagementAiAssistantService` for AI suggestions.

---

## 5 Action Execution Safety

### POST /api/engagement/reply

| Step | Status |
|------|--------|
| Validate message exists | ✓ |
| Validate thread belongs to organization | ✓ |
| Insert `comment_replies` when `post_comment_id` exists | ✓ |
| Call `communityAiActionExecutor.executeAction` | ✓ |
| execution_mode = 'manual' | ✓ |
| approved = true passed | ✓ |

### POST /api/engagement/like

| Step | Status |
|------|--------|
| Validate message exists | ✓ |
| Validate thread belongs to organization | ✓ |
| Insert `comment_likes` when `post_comment_id` exists | ✓ (upsert on comment_id, user_id) |
| Call `communityAiActionExecutor.executeAction` | ✓ |
| execution_mode = 'manual' | ✓ |

### Executor guardrails (unchanged)

| Guardrail | Status |
|-----------|--------|
| `validateAction` (tenant, org, platform, action_type, target_id, suggested_text for reply) | ✓ |
| `getPlaybookById` required | ✓ |
| `validateActionAgainstPlaybook` | ✓ |
| `loadHistoryMetrics` for playbook limits | ✓ |
| `requiresApproval` check | ✓ (bypassed with approved=true) |
| `checkUsageBeforeExecution` (plan limits) | ✓ |
| `getCommunityAiPlatformPolicy` (execution_enabled, require_human_approval) | ✓ |

---

## 6 Thread Priority Scoring

**Service:** `engagementThreadPriorityService.scoreThreadPriority`

| Signal | Status |
|--------|--------|
| Negative sentiment | ✓ (`sentiment_score < -0.3` → +30) |
| Question detection | ✓ (`content.includes('?')` or `has_question` → +25) |
| Lead intent keywords | ✓ (`interested`, `contact`, `demo`, `pricing`, `schedule` → +15) |
| Negative words in content | ✓ (`problem`, `bad`, `issue`, etc. → +20) |

**Storage:** `priority_score` column exists on `engagement_threads` (default 0). Scoring runs **during thread fetch** in `engagementThreadService.getThreads`: when stored `priority_score` is 0, `scoreThreadPriority` is called and the result is used in-memory for filtering and sorting. The computed score is **not persisted** to the database.

---

## 7 AI Reply Assistant

**Service:** `engagementAiAssistantService.generateReplySuggestions`

| Step | Status |
|------|--------|
| Fetch message by id | ✓ |
| Fetch thread messages via `getThreadMessages` | ✓ |
| Build context (thread_context string) | ✓ |
| Call `evaluateCommunityAiEngagement` when OmniVyra enabled | ✓ |
| Extract `suggested_actions` with action_type 'reply' | ✓ |
| Map to `suggested_replies` and `tone_variants` | ✓ |

**Output structure:**

| Field | Status |
|-------|--------|
| suggested_replies | ✓ (array of { text, tone }) |
| tone_variants | ✓ (professional, friendly, educational, thought_leadership) |

**Fallback when OmniVyra disabled:** ✓ Returns four placeholder suggestions with all four tone variants.

**Fallback on OmniVyra error:** ✓ Returns single professional placeholder.

---

## 8 Backward Compatibility

| Pipeline Component | Status |
|--------------------|--------|
| post_comments ingestion | ✓ Unchanged; `engagementIngestionService` persists to `post_comments` |
| engagementEvaluationService | ✓ Uses `post_comments` via `getCommentsForScheduledPost`; no dependency on `engagement_messages` |
| communityAiOmnivyraService | ✓ Unchanged; called by `evaluatePostEngagement` with post_comments data |
| community_ai_actions | ✓ Unchanged; actions persisted by `engagementEvaluationService` |
| communityAiActionExecutor | ✓ Unchanged; Phase-2 reply/like APIs call it with synthetic actions |

**engagementNormalizationService:** Runs after `persistComments` (fire-and-forget); syncs `post_comments` → `engagement_messages`. Does not modify `post_comments` or the evaluation flow.

**omnivyraEngagementAdapter:** Optional adapter for engagement_messages; not used by `engagementEvaluationService`. Evaluation path remains post_comments-based.

---

## 9 Security and Access Control

| API | enforceCompanyAccess | EXECUTE_ACTIONS / Role |
|-----|----------------------|------------------------|
| GET /api/engagement/inbox | ✓ | N/A (read) |
| GET /api/engagement/suggestions | ✓ | N/A (read) |
| POST /api/engagement/reply | ✓ | ✓ `enforceRole` with `COMMUNITY_AI_CAPABILITIES.EXECUTE_ACTIONS` |
| POST /api/engagement/like | ✓ | ✓ `enforceRole` with `COMMUNITY_AI_CAPABILITIES.EXECUTE_ACTIONS` |

Organization scoping: All APIs require `organization_id` and validate thread/message belongs to that organization before proceeding.

---

## 10 Implementation Gaps

| Gap | Severity | Description |
|-----|----------|-------------|
| author_username in inbox | Low | Inbox returns `author_username: null`; `author_summary` (display_name/username) is mapped to `author_name` only. Username could be passed through from author data. |
| priority_score persistence | Low | Computed priority is used at read time but not written to `engagement_threads`. Column exists; persistence would require an ingestion or background job update. |
| GET /api/engagement/messages vs getThreadMessages | Info | Messages API uses direct Supabase and returns `author_id`; it does not use `engagementMessageService.getThreadMessages` or include the full author object. Service is used by AI assistant. |

---

**Audit complete.** Phase-2 backend implementation is correct and safely integrated with the existing Community AI system.
