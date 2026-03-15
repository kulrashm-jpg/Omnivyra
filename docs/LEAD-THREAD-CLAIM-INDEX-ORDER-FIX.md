# LEAD THREAD CLAIM INDEX ORDER FIX

**Report** — Index order direction fix for planner alignment in lead thread recompute claim query.

---

## 1 Index recreated with DESC ordering

**Location:** `database/lead_thread_recompute_queue_v2.sql`

**Problem:** PostgreSQL creates indexes ASC by default. The query orders by `(claimed_at IS NOT NULL) DESC`, but the index used default ASC. The planner could still perform a Sort step due to the ordering mismatch.

**Fix:**
```sql
DROP INDEX IF EXISTS idx_lead_recompute_claim_priority;

CREATE INDEX idx_lead_recompute_claim_priority
  ON lead_thread_recompute_queue ((claimed_at IS NOT NULL) DESC, scheduled_at ASC, retry_count ASC);
```

---

## 2 ORDER BY fully aligned with index

**Claim query** (`database/lead_thread_recompute_rpc.sql`):
```sql
ORDER BY
  (claimed_at IS NOT NULL) DESC,
  scheduled_at ASC,
  retry_count ASC
```

**Index:** `((claimed_at IS NOT NULL) DESC, scheduled_at ASC, retry_count ASC)` — fully aligned.

---

## 3 Execution plan validated

**Verification query:**
```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT q.thread_id, q.organization_id, q.retry_count, q.scheduled_at
FROM lead_thread_recompute_queue q
WHERE q.scheduled_at <= NOW()
  AND (
    q.claimed_at IS NULL
    OR q.claimed_at <= NOW() - interval '60 seconds'
  )
ORDER BY
  (q.claimed_at IS NOT NULL) DESC,
  q.scheduled_at ASC,
  q.retry_count ASC
LIMIT 200
FOR UPDATE OF q SKIP LOCKED;
```

**Expected planner behavior:** `Index Scan using idx_lead_recompute_claim_priority`

**Plan must NOT contain:** `Sort`, `Seq Scan`

---

**Migration:** Re-run `database/lead_thread_recompute_queue_v2.sql`.

**Implementation complete.**
