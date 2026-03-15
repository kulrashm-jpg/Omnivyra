# CONVERSATION MEMORY WORKER RELIABILITY FIX

**Report** — Claim-before-delete to prevent job loss on worker crash.

---

## 1 Claim-before-delete queue logic

**Location:** `database/conversation_memory_rebuild_queue.sql`

**Previous behavior:** RPC deleted rows before worker processed them — jobs lost if worker crashed after claim.

**New behavior:**
1. Claim: UPDATE claimed_at = NOW() on eligible rows, RETURN thread_ids
2. Worker processes each thread_id via updateThreadMemory()
3. Delete only after successful processing

---

## 2 Added claimed_at column

**Schema change:**
```sql
ALTER TABLE conversation_memory_rebuild_queue ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
```

**Claim query:**
```sql
WHERE scheduled_at <= now()
  AND (claimed_at IS NULL OR claimed_at <= now() - interval '60 seconds')
ORDER BY scheduled_at ASC
LIMIT p_limit
FOR UPDATE SKIP LOCKED
```

**Index:** `idx_memory_rebuild_queue_claim` on (scheduled_at, claimed_at)

---

## 3 Safe job processing

**Location:** `backend/workers/conversationMemoryWorker.ts`

**Flow:**
1. Call claim_conversation_memory_rebuild_batch(20)
2. For each returned thread_id: updateThreadMemory(thread_id)
3. On success: DELETE FROM conversation_memory_rebuild_queue WHERE thread_id = $thread_id
4. On error: row remains (claimed_at set); can be reclaimed after 60s

---

## 4 Worker crash recovery

**Reclaim rule:** Rows with claimed_at older than 60 seconds are eligible for reclaim.

**Scenarios:**
- Worker crashes after claiming: rows stay with claimed_at; after 60s another worker can claim
- Worker crashes before claiming: no change; next run processes
- Worker processes, then crashes before delete: row has claimed_at; after 60s it is reclaimed (duplicate rebuild, acceptable)

---

**Migration:** Re-run `database/conversation_memory_rebuild_queue.sql`.

**Implementation complete.**
