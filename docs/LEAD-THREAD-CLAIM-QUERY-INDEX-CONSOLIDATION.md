# LEAD THREAD CLAIM QUERY INDEX CONSOLIDATION

**Report** — Four corrections for planner regressions and index redundancy.

---

## 1 Consolidated claim path index

**Location:** `database/lead_thread_recompute_queue_v2.sql`

**Problem:** `idx_lead_recompute_sched_claimed` and `idx_lead_recompute_sched_retry` both partially supported the claim query; the planner could pick the wrong one and do bitmap scans.

**Fix:**
- Added single composite index: `idx_lead_recompute_claim_path ON (scheduled_at, claimed_at, retry_count)`
- Dropped `idx_lead_recompute_sched_claimed` and `idx_lead_recompute_sched_retry`
- Covers filters and ordering in one index

---

## 2 Rewritten predicate using UNION ALL

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Problem:** `(claimed_at IS NULL OR claimed_at < NOW() - interval '60 seconds')` limited index efficiency.

**Fix:**
- Replaced OR with two index-friendly branches:
  - `WHERE claimed_at IS NULL AND scheduled_at <= NOW()`
  - `UNION ALL`
  - `WHERE claimed_at <= NOW() - interval '60 seconds' AND scheduled_at <= NOW()`
- Each branch can use its own index

---

## 3 Stable ordering after union

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Problem:** UNION ALL can break index ordering.

**Fix:**
- Wrapped result in subquery and re-applied ORDER BY:
  - `SELECT thread_id, organization_id FROM (UNION ALL ...) t ORDER BY scheduled_at, retry_count LIMIT LEAST(p_limit, 200)`

---

## 4 Index audit cleanup

**Location:** `database/lead_thread_recompute_queue_v2.sql`, `database/lead_thread_recompute_index_audit.sql`

**Problem:** Multiple migrations left redundant indexes.

**Fix:**
- Dropped: `idx_lead_recompute_sched_claim`, `idx_lead_recompute_sched_claimed`, `idx_lead_recompute_sched_retry`, `idx_lead_recompute_claim_sched`, `idx_lead_recompute_reclaim`
- Updated partial index `idx_lead_recompute_ready` to `(scheduled_at, retry_count) WHERE claimed_at IS NULL`
- Added audit script: `database/lead_thread_recompute_index_audit.sql` to inspect indexes

---

**Migrations:** Re-run `database/lead_thread_recompute_queue_v2.sql` and `database/lead_thread_recompute_rpc.sql`.

**Audit:** Run `database/lead_thread_recompute_index_audit.sql` to verify index set.

**Implementation complete.**
