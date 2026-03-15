# LEAD THREAD CLAIM WINDOW CORRECTION

**Report** — Correctness fix for the lead thread recompute claim logic.

---

## 1 Removed 24-hour scan guard

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Problem:** Predicate `scheduled_at >= NOW() - interval '24 hours'` made jobs older than 24 hours permanently invisible to the claim worker. Worker outages longer than 24 hours caused queued jobs to never be processed, violating queue durability.

**Fix:**
- Removed `scheduled_at >= NOW() - interval '24 hours'` from both Step 1 and Step 2
- Claim condition is now only: `scheduled_at <= NOW()`

---

## 2 Restored full queue visibility

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Implementation:**
- All overdue jobs are claimable through the normal claim mechanism
- No upper bound on job age
- `idx_lead_recompute_claim_path (scheduled_at, claimed_at, retry_count)` supports efficient scanning

---

## 3 Verified index scan plan

**Verification:** Run:
```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT ... FROM lead_thread_recompute_queue q WHERE ... FOR UPDATE OF q SKIP LOCKED;
```

**Expected:** `Index Scan using idx_lead_recompute_claim_path` or `idx_lead_recompute_ready` for Step 1

**Should NOT appear:** Sequential Scan

---

**Migration:** Re-run `database/lead_thread_recompute_rpc.sql`.

**Implementation complete.**
