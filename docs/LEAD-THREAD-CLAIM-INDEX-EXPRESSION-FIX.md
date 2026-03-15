# LEAD THREAD CLAIM INDEX EXPRESSION FIX

**Report** — Expression index fix for ORDER BY alignment in lead thread recompute claim query.

---

## 1 Expression index created

**Location:** `database/lead_thread_recompute_queue_v2.sql`

**Problem:** The index `idx_lead_recompute_claim_priority` was on `(claimed_at, scheduled_at, retry_count)` but the ORDER BY uses `(claimed_at IS NOT NULL)`. PostgreSQL cannot use the index for ordering when expressions differ.

**Fix:**
```sql
DROP INDEX IF EXISTS idx_lead_recompute_claim_priority;

CREATE INDEX idx_lead_recompute_claim_priority
  ON lead_thread_recompute_queue ((claimed_at IS NOT NULL), scheduled_at, retry_count);
```

---

## 2 ORDER BY alignment verified

**Claim query** (`database/lead_thread_recompute_rpc.sql`):
```sql
ORDER BY
  (q.claimed_at IS NOT NULL) DESC,
  q.scheduled_at ASC,
  q.retry_count ASC
```

**Index keys:** `((claimed_at IS NOT NULL), scheduled_at, retry_count)` — matches the ORDER BY expression.

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
