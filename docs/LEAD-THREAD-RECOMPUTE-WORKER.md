# LEAD THREAD RECOMPUTE WORKER

**Report** — Pull-based worker replaces setTimeout scheduling to fix lost recompute events.

---

## 1 Removed setTimeout scheduling

**Location:** `backend/services/leadThreadScoring.ts`

**Problem:** If the worker that inserted the row crashed before setTimeout fired, the recompute never ran. The queue row remained stuck.

**Fix:**
- `scheduleThreadScoreUpdate()` now only inserts into `lead_thread_recompute_queue`
- No local timers
- No `processRecomputeQueueForThread()` or setTimeout logic

---

## 2 Implemented queue worker

**Location:** `backend/workers/leadThreadRecomputeWorker.ts`

**Implementation:**
- Worker loop runs every 5 seconds
- Calls RPC `claim_lead_thread_recompute_batch(p_limit: 20)`
- RPC uses `SELECT ... FOR UPDATE SKIP LOCKED` then deletes claimed rows, returns `(thread_id, organization_id)`
- For each claimed row: `computeThreadLeadScore(thread_id, organization_id)`
- Rows are already deleted by the RPC (atomic claim+delete)
- Returns `{ processed, errors }`

**Database:** `database/lead_thread_recompute_rpc.sql` defines `claim_lead_thread_recompute_batch(p_limit)`. Run this migration after `lead_thread_recompute_queue.sql`.

---

## 3 Scheduler bootstrap

**Location:** `backend/scheduler/cron.ts`

**Implementation:**
- Import `runLeadThreadRecomputeWorker`
- Add `leadThreadRecomputeInterval` (5 seconds)
- On cron start: `setInterval(runLeadThreadRecomputeWorker, 5000)`
- On shutdown: clear `leadThreadRecomputeInterval`

---

## 4 Queue insertion logic

**Location:** `backend/services/leadThreadScoring.ts` — `scheduleThreadScoreUpdate()`

**Implementation:**
- Insert into `lead_thread_recompute_queue`:
  - `thread_id`
  - `organization_id`
  - `scheduled_at` = NOW() + 5 seconds
- Upsert with `onConflict: 'thread_id,organization_id', ignoreDuplicates: true` (equivalent to ON CONFLICT DO NOTHING)
- No return-value check; insert is fire-and-forget

---

**Migration required:** Run `database/lead_thread_recompute_rpc.sql` before deploying.

**Implementation complete.**
