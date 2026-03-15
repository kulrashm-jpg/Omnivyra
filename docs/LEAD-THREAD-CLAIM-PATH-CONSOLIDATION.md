# LEAD THREAD CLAIM PATH CONSOLIDATION

**Report** — Final claim logic consolidation for `lead_thread_recompute_queue`.

---

## 1 Claim ordering implementation

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Ordering:**
```sql
ORDER BY
  (claimed_at IS NOT NULL) DESC,
  scheduled_at ASC,
  retry_count ASC
```

**Meaning:**
1. Expired claims first
2. Then oldest scheduled rows
3. Then lowest `retry_count`

---

## 2 Expired priority handling

**Implementation:** Derived column `is_expired = (claimed_at IS NOT NULL)` stored in temp batch table `_claim_batch`.

**RETURN QUERY:**
```sql
ORDER BY
  is_expired DESC,
  scheduled_at ASC,
  retry_count ASC
```

Ensures the worker receives expired rows first in the batch.

---

## 3 Supporting index verification

**Location:** `database/lead_thread_recompute_queue_v2.sql`

**Index:**
```sql
CREATE INDEX IF NOT EXISTS idx_lead_recompute_claim_priority
  ON lead_thread_recompute_queue (claimed_at, scheduled_at, retry_count);
```

Supports:
- `WHERE scheduled_at <= NOW()`
- `ORDER BY claimed_at, scheduled_at, retry_count`
- `(claimed_at IS NOT NULL) DESC` via `claimed_at` sort key (NULLs last in ASC, first in DESC for expression)

---

## 4 Locking behavior

**Claim predicate:**
```sql
WHERE scheduled_at <= NOW()
  AND (
    claimed_at IS NULL
    OR claimed_at <= NOW() - interval '60 seconds'
  )
```

**Locking clause:**
```sql
FOR UPDATE OF q SKIP LOCKED
```

Prevents worker contention; each worker claims rows without blocking others.

---

## 5 Query plan validation

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

**Expected planner behavior:**
- `Index Scan using idx_lead_recompute_claim_priority`
- No explicit `Sort`
- No `Seq Scan`

---

**Migrations:** Apply in order: `lead_thread_recompute_queue_v2.sql`, then `lead_thread_recompute_rpc.sql`.

**Consolidation complete.**
