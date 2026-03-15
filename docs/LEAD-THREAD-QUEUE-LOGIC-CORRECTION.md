# LEAD THREAD QUEUE LOGIC CORRECTION

**Report** — Four logical corrections applied to the lead thread recompute queue scheduling.

---

## 1 Removed claim window lower bound

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Problem:** Filter `scheduled_at > NOW() - interval '1 hour'` made jobs older than 1 hour permanently invisible after a worker outage.

**Fix:**
- Removed the lower bound condition
- Claim condition: `scheduled_at <= NOW()` only
- No restriction on scan window; all due jobs are eligible

---

## 2 Balanced retry ordering

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Problem:** `ORDER BY scheduled_at ASC, retry_count DESC` let high-retry rows dominate and starve new jobs.

**Fix:**
- Changed to `ORDER BY scheduled_at ASC, retry_count ASC`
- Prioritizes older jobs first, then lower retry counts
- Avoids starvation of newer jobs

---

## 3 Controlled scheduled_at updates

**Location:** `database/lead_thread_recompute_rpc.sql` — `schedule_lead_thread_recompute`

**Problem:** `LEAST(existing, new)` could pull `scheduled_at` forward too often, causing unnecessary recomputes.

**Fix:**
- Update only when new `scheduled_at` is earlier by at least 2 seconds
- `SET scheduled_at = CASE WHEN EXCLUDED.scheduled_at < lead_thread_recompute_queue.scheduled_at - interval '2 seconds' THEN EXCLUDED.scheduled_at ELSE lead_thread_recompute_queue.scheduled_at END`

---

## 4 Extended orphan cleanup

**Location:** `database/lead_thread_recompute_rpc.sql` — `cleanup_lead_thread_recompute_queue_orphans`

**Problem:** Cleanup only checked `engagement_threads`; rows for deleted organizations remained.

**Fix:**
- Extended condition: delete when thread OR organization is missing
- `WHERE NOT EXISTS (SELECT 1 FROM engagement_threads t WHERE t.id = q.thread_id) OR NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = q.organization_id)`

---

**Migration:** Re-run `database/lead_thread_recompute_rpc.sql`.

**Implementation complete.**
