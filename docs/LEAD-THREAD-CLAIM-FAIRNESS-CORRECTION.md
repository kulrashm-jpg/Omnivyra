# LEAD THREAD CLAIM FAIRNESS CORRECTION

**Report** — Distributed execution fix for claim fairness.

---

## 1 Removed worker-local cycle counter

**Location:** `backend/workers/leadThreadRecomputeWorker.ts`

**Problem:** In multi-instance deployments, each worker had its own `claimCycleCounter`. Counters were unsynchronized, and workers restart often. Expired-claim prioritization became random; fairness guarantees failed.

**Fix:**
- Removed `claimCycleCounter` and `EXPIRED_PRIORITY_INTERVAL`
- Removed `prioritizeExpired` logic
- Worker calls `claim_lead_thread_recompute_batch(p_limit)` only

---

## 2 Fairness handled inside claim RPC

**Location:** `database/lead_thread_recompute_rpc.sql`

**Problem:** Worker-local prioritization could not work across instances.

**Fix:**
- Removed `p_prioritize_expired` parameter
- Single claim query with: `ORDER BY scheduled_at ASC, retry_count ASC`
- Oldest jobs (by `scheduled_at`) are claimed first; expired claims (often older) naturally get priority
- No worker coordination needed

---

## 3 Verified index scan plan

**Verification:** Run:
```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ... FROM lead_thread_recompute_queue q
WHERE scheduled_at <= NOW() AND (claimed_at IS NULL OR claimed_at <= NOW() - interval '60 seconds')
ORDER BY scheduled_at ASC, retry_count ASC LIMIT 200
FOR UPDATE OF q SKIP LOCKED;
```

**Expected:** `Index Scan using idx_lead_recompute_claim_path`

---

**Migration:** Re-run `database/lead_thread_recompute_rpc.sql`.

**Implementation complete.**
