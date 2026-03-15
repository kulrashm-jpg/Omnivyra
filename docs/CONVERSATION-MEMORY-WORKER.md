# CONVERSATION MEMORY WORKER

**Report** — Decouple memory rebuilds from ingestion via queue worker.

---

## 1 Queue table

**Location:** `database/conversation_memory_rebuild_queue.sql`

**Table:** `conversation_memory_rebuild_queue`

| Column | Type | Description |
|--------|------|-------------|
| thread_id | UUID PRIMARY KEY | References engagement_threads(id) ON DELETE CASCADE |
| organization_id | UUID | From engagement_threads |
| scheduled_at | TIMESTAMPTZ | When to process |
| created_at | TIMESTAMPTZ | Default now() |

---

## 2 Ingestion trigger change

**Location:** `backend/services/engagementNormalizationService.ts`

**Replaced:** `updateThreadMemory(thread_id)` fire-and-forget call

**With:** Enqueue only
```typescript
await supabase.from('conversation_memory_rebuild_queue').upsert(
  { thread_id, organization_id, scheduled_at: new Date().toISOString() },
  { onConflict: 'thread_id', ignoreDuplicates: true }
);
```

- Ingestion path only inserts (or skips if thread already in queue)
- ON CONFLICT DO NOTHING via `ignoreDuplicates: true`

---

## 3 Memory worker

**Location:** `backend/workers/conversationMemoryWorker.ts`

**Loop:** Every 10 seconds

**Flow:**
1. Call RPC `claim_conversation_memory_rebuild_batch(20)` — selects `WHERE scheduled_at <= NOW() ORDER BY scheduled_at LIMIT 20 FOR UPDATE SKIP LOCKED`, deletes rows, returns thread_ids
2. For each returned thread_id: call `updateThreadMemory(thread_id)`
3. RPC deletes claimed rows atomically

---

## 4 Index creation

**Index:** `idx_memory_rebuild_queue_sched`
```sql
CREATE INDEX IF NOT EXISTS idx_memory_rebuild_queue_sched
  ON conversation_memory_rebuild_queue (scheduled_at);
```

Supports `WHERE scheduled_at <= NOW() ORDER BY scheduled_at LIMIT 20`.

---

## 5 Scheduler bootstrap

**Location:** `backend/scheduler/cron.ts`

- Import `runConversationMemoryWorker`
- `CONVERSATION_MEMORY_WORKER_INTERVAL_MS = 10 * 1000`
- Recursive `setTimeout` runs worker every 10 seconds
- Graceful shutdown clears interval

---

**Migration:** Run `database/conversation_memory_rebuild_queue.sql`.

**Implementation complete.**
