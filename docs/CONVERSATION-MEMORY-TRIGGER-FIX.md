# CONVERSATION MEMORY TRIGGER FIX

**Report** — Deterministic rebuild trigger replacing modulo-based logic.

---

## 1 Deterministic rebuild trigger

**Location:** `backend/services/conversationMemoryService.ts`

**Problem:** `last_message_count % 5 == 0` could skip or fire twice under concurrent inserts or ingestion retries.

**Fix:** Rebuild only when:
- `latest_message_id != last_processed_message_id`
- AND message distance >= 5 (or no memory exists, or last_processed is null for legacy rows)
- AND not already up to date (`last_processed_message_id === latest_message_id` → skip)

---

## 2 last_processed_message_id tracking

**Location:** `database/engagement_thread_memory.sql`

**Schema change:**
- Added column `last_processed_message_id UUID` to `engagement_thread_memory`
- RPC `upsert_engagement_thread_memory_locked` now accepts and sets `p_last_processed_message_id`
- Update occurs in same transaction as memory upsert

**Distance computation:**
- RPC `get_engagement_thread_message_distance(p_thread_id, p_last_processed_id)` returns count of messages after last_processed
- Chronological order: `(platform_created_at, id)` tuple comparison
- When `last_processed` is NULL, returns total message count (triggers initial rebuild)

---

## 3 Removed modulo logic

**Location:** `backend/services/conversationMemoryService.ts`

**Removed:**
- `DEBOUNCE_INTERVAL` constant
- `count % DEBOUNCE_INTERVAL !== 0` check
- `getMessageCountAndLatest()` (replaced by `getLatestMessageId()` and `getMessageDistance()`)

**Added:**
- `MESSAGE_DISTANCE_THRESHOLD = 5`
- `getMessageDistance()` via RPC
- `shouldSkipRebuild()` uses distance >= threshold

---

## 4 Verified rebuild behavior

| Scenario | Rebuild? |
|----------|----------|
| No memory exists | Yes |
| memory.last_processed === latest | No (skip) |
| memory.last_processed is null (legacy) | Yes |
| distance < 5 | No (skip) |
| distance >= 5 | Yes |
| memory.updated_at > 24h ago (stale) | Yes |

---

**Migration:** Re-run `database/engagement_thread_memory.sql` (adds column, RPCs).

**Implementation complete.**
