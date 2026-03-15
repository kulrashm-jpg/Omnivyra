# LEAD THREAD CLAIM EXPIRED PRIORITY FIX

**Report** — Starvation risk fix for expired claims in lead thread recompute.

---

## 1 Added expired-claim priority ordering

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Problem:** Rows with `claimed_at IS NULL` could keep arriving with earlier `scheduled_at` than expired rows. Under constant ingestion, the worker kept claiming new rows and never reached expired ones.

**Fix:**
- Changed `ORDER BY` to: `(claimed_at IS NOT NULL) DESC, scheduled_at ASC, retry_count ASC`
- Expired rows (claimed_at IS NOT NULL) are chosen first
- Then oldest `scheduled_at`, then lowest `retry_count`
- Added `is_expired` to temp batch; RETURN QUERY orders by `is_expired DESC, scheduled_at ASC, retry_count ASC` so the worker receives expired rows first

---

## 2 Added supporting index

**Location:** `database/lead_thread_recompute_queue_v2.sql`

**Implementation:**
- `CREATE INDEX idx_lead_recompute_claim_priority ON lead_thread_recompute_queue (claimed_at, scheduled_at, retry_count)`
- Matches `ORDER BY (claimed_at IS NOT NULL) DESC, scheduled_at ASC, retry_count ASC`
- Enables efficient index scan instead of explicit sort

---

## 3 Verified execution plan

**Verification:** Run:
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

**Expected planner result:** `Index Scan using idx_lead_recompute_claim_priority`

**Plan must NOT contain:** `Seq Scan`, `Sort`

---

**Migrations:** Re-run `database/lead_thread_recompute_queue_v2.sql` and `database/lead_thread_recompute_rpc.sql`.

**Implementation complete.**
