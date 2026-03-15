# CONVERSATION MEMORY STABILITY FIX

**Report** — Reliability and scalability fixes for the conversation memory implementation.

---

## 1 Debounced memory rebuild

**Location:** `backend/services/conversationMemoryService.ts`

**Problem:** `updateThreadMemory(thread_id)` ran after every message insert, causing excessive LLM calls on active threads.

**Fix:**
- Only rebuild when `last_message_count % 5 == 0` OR no memory exists yet
- Skip when `memory.last_message_id === latest_message_id` (already processed)
- Constants: `DEBOUNCE_INTERVAL = 5`, `shouldSkipRebuild()` enforces rules

---

## 2 Concurrency-safe updates

**Location:** `database/engagement_thread_memory.sql` (RPC), `conversationMemoryService.ts`

**Problem:** Parallel `updateThreadMemory()` calls could overwrite each other's summaries.

**Fix:**
- RPC `upsert_engagement_thread_memory_locked` locks `engagement_threads` row via `SELECT ... FOR UPDATE` before upsert
- Upsert uses `INSERT ... ON CONFLICT (thread_id) DO UPDATE`
- Service calls `supabase.rpc('upsert_engagement_thread_memory_locked', {...})` instead of direct upsert

---

## 3 Prompt size control

**Location:** `backend/services/conversationMemoryService.ts`

**Problem:** Up to 10 messages × 500 chars ≈ 5000 chars, could grow unpredictably.

**Fix:**
- Truncate each message to `CONTENT_TRUNCATE = 300` characters before summarization prompt
- `.slice(0, CONTENT_TRUNCATE)` applied in `generateSummary()`

---

## 4 Memory refresh safeguard

**Location:** `backend/services/conversationMemoryService.ts`

**Problem:** Memory only updated on new messages; edited/deleted content made it outdated.

**Fix:**
- If `memory.updated_at` older than 24 hours, force rebuild on next message
- `STALE_HOURS = 24`, checked in `shouldSkipRebuild()`: when `updatedAt < staleBoundary` we return false (do not skip)

---

**Migration:** Re-run `database/engagement_thread_memory.sql` to create the RPC.

**Implementation complete.**
