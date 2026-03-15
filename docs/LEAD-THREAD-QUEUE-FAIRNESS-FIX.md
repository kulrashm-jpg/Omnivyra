# LEAD THREAD QUEUE FAIRNESS FIX

**Report** — Four scheduling fairness corrections applied to the lead thread recompute queue.

---

## 1 Hot-thread starvation fix

**Location:** `database/lead_thread_recompute_rpc.sql`, `backend/services/leadThreadScoring.ts`

**Problem:** With ON CONFLICT DO NOTHING, active threads kept the same queue row; `scheduled_at` never moved forward, so recompute could run much later than needed.

**Fix:**
- New RPC `schedule_lead_thread_recompute(p_thread_id, p_organization_id)`
- `INSERT ... ON CONFLICT (thread_id, organization_id) DO UPDATE SET scheduled_at = LEAST(lead_thread_recompute_queue.scheduled_at, EXCLUDED.scheduled_at)`
- Allows moving `scheduled_at` earlier when new activity occurs
- `scheduleThreadScoreUpdate()` calls this RPC instead of direct upsert

---

## 2 Retry-aware scheduling order

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Problem:** Worker only ordered by `scheduled_at`; older or repeatedly failing jobs were not prioritized.

**Fix:**
- Claim query: `ORDER BY scheduled_at ASC, retry_count DESC`
- Jobs with higher retry_count (more failures) are processed before newer ones with lower retry_count

---

## 3 Bounded claim scan window

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Problem:** Claim query could scan the whole queue for eligible rows.

**Fix:**
- Added condition: `AND scheduled_at > NOW() - interval '1 hour'`
- Claim only considers rows due within the last hour
- Avoids repeatedly scanning very old rows

---

## 4 Queue cleanup worker

**Location:** `database/lead_thread_recompute_rpc.sql`, `backend/workers/leadThreadRecomputeWorker.ts`, `backend/scheduler/cron.ts`

**Problem:** Rows for deleted threads or organizations could remain indefinitely.

**Fix:**
- New RPC `cleanup_lead_thread_recompute_queue_orphans()`:
  - `DELETE FROM lead_thread_recompute_queue q WHERE NOT EXISTS (SELECT 1 FROM engagement_threads t WHERE t.id = q.thread_id)`
- New worker `runLeadThreadRecomputeQueueCleanup()` calls the RPC
- Invoked every 10 minutes from the cron scheduler

---

**Migration:** Re-run `database/lead_thread_recompute_rpc.sql` to add/update the functions.

**Implementation complete.**
