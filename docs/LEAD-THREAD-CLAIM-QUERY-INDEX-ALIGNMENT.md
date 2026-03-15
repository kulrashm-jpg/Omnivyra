# LEAD THREAD CLAIM QUERY INDEX ALIGNMENT

**Report** — Four performance corrections for lead thread recompute queue claim logic.

---

## 1 New composite index for claim path

**Location:** `database/lead_thread_recompute_queue_v2.sql`

**Problem:** Filter started with `claimed_at` but index started with `scheduled_at`, reducing index efficiency.

**Fix:**
- Added index: `CREATE INDEX idx_lead_recompute_claim_sched ON lead_thread_recompute_queue (claimed_at, scheduled_at)`
- Aligns with claim filter predicates
- Existing `idx_lead_recompute_sched_claim` kept

---

## 2 Predicate rewrite removing OR

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Problem:** `claimed_at IS NULL OR claimed_at < NOW() - interval '60 seconds'` can block index use.

**Fix:**
- Replaced with: `COALESCE(q.claimed_at, 'epoch'::timestamptz) < NOW() - interval '60 seconds'`
- Single-condition evaluation for index-friendly lookup

---

## 3 Additional partial index for reclaimed rows

**Location:** `database/lead_thread_recompute_queue_v2.sql`

**Problem:** `idx_lead_recompute_ready` only covers `claimed_at IS NULL`; claim query also reads reclaimed rows.

**Fix:**
- Added: `CREATE INDEX idx_lead_recompute_reclaim ON lead_thread_recompute_queue (scheduled_at) WHERE claimed_at IS NOT NULL`
- Covers reclaimable (expired claimed) rows

---

## 4 Verified index-supported ordering

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Problem:** Planner might still perform a sort after filtering.

**Fix:**
- Changed to: `ORDER BY scheduled_at, q.retry_count ASC`
- `scheduled_at` ordering is supported by both partial indexes `(scheduled_at)`

---

**Migrations:** Re-run `database/lead_thread_recompute_queue_v2.sql` and `database/lead_thread_recompute_rpc.sql`.

**Implementation complete.**
