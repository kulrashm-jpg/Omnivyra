# PHASE 2 IMPLEMENTATION REPORT
## Unified Engagement Inbox — Backend Services and APIs

**Date:** March 2025  
**Scope:** Community Engagement Command Center Phase 2  
**Status:** Implemented

---

## 1. New Services

| Service | Path | Responsibilities |
|---------|------|------------------|
| **engagementThreadService** | `backend/services/engagementThreadService.ts` | `getThreads(filters)` — list threads with org, platform, source_id, priority, date_range filters. Returns thread_id, platform, author_summary, message_count, latest_message, latest_message_time, priority_score, unread_count. Ordered by latest_message_time DESC. |
| **engagementMessageService** | `backend/services/engagementMessageService.ts` | `getThreadMessages(thread_id)` — returns messages with message_id, author, content, platform, message_type, like_count, reply_count, created_at, parent_message_id. |
| **engagementAuthorService** | `backend/services/engagementAuthorService.ts` | `getAuthor(author_id)` — returns profile, recent_messages, engagement_stats (total_messages, total_threads, last_interaction). |
| **engagementThreadPriorityService** | `backend/services/engagementThreadPriorityService.ts` | `scoreThreadPriority(input)` — computes priority from negative sentiment, questions, lead intent. Used for inbox sorting. |
| **engagementAiAssistantService** | `backend/services/engagementAiAssistantService.ts` | `generateReplySuggestions(message_id, organization_id, brand_voice?)` — fetches thread messages, calls OmniVyra when enabled, returns suggested_replies and tone_variants (professional, friendly, educational, thought_leadership). Fallback placeholders when OmniVyra disabled. |

---

## 2. New APIs

| Method | Endpoint | Purpose |
|--------|----------|--------|
| **GET** | `/api/engagement/inbox` | Unified inbox items. Query: organization_id, platform, priority, start_date, end_date, limit. Returns thread_id, platform, author_name, author_username, latest_message, latest_message_time, priority_score, unread_count, message_count. |
| **POST** | `/api/engagement/reply` | Reply to a message. Body: organization_id, thread_id, message_id, reply_text, platform. Inserts into comment_replies when post_comment_id exists; executes via communityAiActionExecutor (action_type: reply, execution_mode: manual). |
| **POST** | `/api/engagement/like` | Like a message. Body: organization_id, message_id, platform. Inserts into comment_likes when post_comment_id exists; executes via communityAiActionExecutor (action_type: like, execution_mode: manual). |
| **GET** | `/api/engagement/suggestions` | AI reply suggestions. Query: message_id, organization_id. Returns suggested_replies and tone_variants from engagementAiAssistantService. |

**Existing APIs (unchanged):**
- `GET /api/engagement/threads` — list threads (Phase 1)
- `GET /api/engagement/messages` — list messages (Phase 1)

---

## 3. Thread Prioritization

- **Service:** `engagementThreadPriorityService.ts`
- **Signals:** negative sentiment, questions (e.g. `?`), lead intent keywords
- **Storage:** `engagement_threads.priority_score` (Phase 2 migration)
- **Usage:** Inbox sorting; `getThreads` applies priority filter when `priority` query is provided (high/medium/low)
- **Scoring:** On-demand when `priority_score` is 0 and thread has messages; otherwise uses stored value

---

## 4. AI Reply Assistant Integration

- **Service:** `engagementAiAssistantService.ts`
- **Flow:**
  1. Fetch message and thread messages
  2. Build thread context
  3. Resolve brand_voice (company profile or fallback)
  4. If OmniVyra enabled: call `evaluateCommunityAiEngagement` with thread_messages, target_message, brand_voice
  5. Extract reply actions from suggested_actions
  6. Map to tone_variants (professional, friendly, educational, thought_leadership)
- **Fallback:** When OmniVyra disabled or on error, returns placeholder suggestions for each tone

---

## 5. Changes to Existing Systems

| Area | Change |
|------|--------|
| **engagement_threads** | Phase 2 migration adds `priority_score`, `unread_count` columns |
| **comment_replies** | Reply API inserts when `engagement_messages.post_comment_id` exists |
| **comment_likes** | Like API upserts when `engagement_messages.post_comment_id` exists |
| **communityAiActionExecutor** | Reply/Like APIs call with synthetic action (playbook from first active playbook for org) |
| **OmniVyra** | engagementAiAssistantService uses `evaluateCommunityAiEngagement` for reply suggestions |

**No changes to:**
- Phase 1 schema (engagement_sources, engagement_authors, engagement_threads, engagement_messages core columns)
- post_comments pipeline
- engagementEvaluationService
- OmniVyra evaluation flow for community_ai_actions

---

## 6. Backward Compatibility

- **Phase 1 schema:** Unchanged except additive columns (priority_score, unread_count)
- **post_comments → engagementEvaluationService → OmniVyra → community_ai_actions:** Unchanged
- **comment_replies / comment_likes:** Used only when `post_comment_id` is present; messages without it skip insert but still execute via executor (manual mode simulation)
- **Playbook requirement:** Reply/Like APIs require at least one active playbook for the organization

---

## 7. Deployment Steps

1. **Run Phase 2 migration:**
   ```bash
   psql -f database/engagement_phase2_extensions.sql
   ```
   (Or apply via your migration runner.)

2. **Verify Phase 1 migration** (`engagement_unified_model.sql`) has been applied.

3. **Environment:** Ensure `USE_OMNIVYRA=true` if AI reply suggestions should use OmniVyra; otherwise fallback placeholders are returned.

4. **Playbooks:** Ensure at least one active `community_ai_playbook` exists per organization for reply/like execution.

5. **RBAC:** Reply and Like APIs require `EXECUTE_ACTIONS` capability (same as community-ai actions execute).

6. **Test:**
   - `GET /api/engagement/inbox?organization_id=<id>`
   - `POST /api/engagement/reply` with body
   - `POST /api/engagement/like` with body
   - `GET /api/engagement/suggestions?message_id=<id>&organization_id=<id>`
