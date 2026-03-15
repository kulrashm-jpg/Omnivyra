# LEAD THREAD CLAIM QUERY CORRECTNESS FIX

**Report** — Four correctness and planner corrections for the lead thread recompute queue claim query.

---

## 1 Restored correct claim predicate

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Problem:** `COALESCE(q.claimed_at, 'epoch'::timestamptz) < NOW() - interval '60 seconds'` changed semantics; rows with `claimed_at IS NULL` always passed.

**Fix:**
- Restored explicit logic: `(q.claimed_at IS NULL OR q.claimed_at < NOW() - interval '60 seconds')`
- Correctness takes priority over index-only evaluation

---

## 2 Added scheduled_at-first composite index

**Location:** `database/lead_thread_recompute_queue_v2.sql`

**Problem:** Index `(claimed_at, scheduled_at)` led with `claimed_at` while the query filters mainly on `scheduled_at <= NOW()`.

**Fix:**
- Added `idx_lead_recompute_sched_claimed ON (scheduled_at, claimed_at)`
- Dropped misaligned `idx_lead_recompute_claim_sched`
- Aligns index with claim path filter order

---

## 3 Removed unnecessary reclaimed-row index

**Location:** `database/lead_thread_recompute_queue_v2.sql`

**Problem:** `idx_lead_recompute_reclaim (scheduled_at) WHERE claimed_at IS NOT NULL` was unnecessary; the claim query uses both `claimed_at IS NULL` and reclaimable rows, so the planner would scan both anyway.

**Fix:**
- Dropped `idx_lead_recompute_reclaim`

---

## 4 Added covering index for ORDER BY

**Location:** `database/lead_thread_recompute_queue_v2.sql`

**Problem:** `ORDER BY scheduled_at, retry_count ASC` could trigger a sort because the index did not include `retry_count`.

**Fix:**
- Added covering index: `idx_lead_recompute_sched_retry ON (scheduled_at, retry_count)`
- Supports index-only ordering for the claim query

---

**Migrations:** Re-run `database/lead_thread_recompute_queue_v2.sql` and `database/lead_thread_recompute_rpc.sql`.

**Implementation complete.**
