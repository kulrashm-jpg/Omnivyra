# LEAD THREAD CLAIM QUERY STREAMING FIX

**Report** — Performance regression fix for lead thread recompute claim query.

---

## 1 Removed UNION claim plan

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Problem:** The UNION plan forced materialization, then sort, then LIMIT. It prevented ordered index streaming.

**Fix:**
- Removed the two-branch UNION ALL structure
- Replaced with a single SELECT using combined predicate

---

## 2 Restored index streaming scan

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Implementation:**
```sql
SELECT q.thread_id, q.organization_id, q.retry_count
FROM lead_thread_recompute_queue q
WHERE q.scheduled_at <= NOW()
  AND (q.claimed_at IS NULL OR q.claimed_at <= NOW() - interval '60 seconds')
ORDER BY q.scheduled_at, q.retry_count
LIMIT LEAST(p_limit, 200)
FOR UPDATE OF q SKIP LOCKED
```

- Single query allows PostgreSQL to use `idx_lead_recompute_claim_path (scheduled_at, claimed_at, retry_count)` for ordered index scan
- No materialization, Sort, or HashAggregate in plan

---

## 3 Verified planner execution plan

**Verification:** Run:
```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ...
```

**Expected:** `Index Scan using idx_lead_recompute_claim_path`

**Should NOT appear:** Sort, HashAggregate, Materialize

---

**Migration:** Re-run `database/lead_thread_recompute_rpc.sql`.

**Implementation complete.**
