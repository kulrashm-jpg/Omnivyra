# LEAD THREAD RECOMPUTE WORKER RELIABILITY FIX

**Report** — Four reliability corrections applied to the lead thread recompute worker.

---

## 1 Safe claim-before-delete logic

**Location:** `database/lead_thread_recompute_rpc.sql`, `backend/workers/leadThreadRecomputeWorker.ts`

**Problem:** RPC deleted rows before `computeThreadLeadScore()` ran. If the worker crashed during processing, those jobs were permanently lost.

**Fix:**
- Step 1 — Claim: `UPDATE lead_thread_recompute_queue SET claimed_at = NOW() WHERE ... IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING thread_id, organization_id, retry_count`
- Step 2 — After successful `computeThreadLeadScore()`: `DELETE FROM lead_thread_recompute_queue WHERE thread_id = $ AND organization_id = $`
- Added `claimed_at` column via `database/lead_thread_recompute_queue_v2.sql`

---

## 2 Claim timeout recovery

**Location:** `database/lead_thread_recompute_rpc.sql`

**Problem:** If the worker crashed after claiming rows, `claimed_at` stayed set and rows were never processed.

**Fix:**
- Claim SELECT condition now allows: `claimed_at IS NULL OR claimed_at < NOW() - interval '60 seconds'`
- Stale claims older than 60 seconds can be reclaimed by any worker

---

## 3 Retry counter

**Location:** `database/lead_thread_recompute_queue_v2.sql`, `backend/workers/leadThreadRecomputeWorker.ts`

**Problem:** If recompute failed repeatedly, queue rows remained indefinitely.

**Fix:**
- Added `retry_count INTEGER DEFAULT 0` to `lead_thread_recompute_queue`
- On `computeThreadLeadScore()` failure: increment `retry_count`, set `claimed_at = null` (allow reclaim)
- If `retry_count > 10` after increment: delete row and log warning
- Claim RPC returns `retry_count` for worker logic

---

## 4 Dynamic worker batch sizing

**Location:** `backend/workers/leadThreadRecomputeWorker.ts`

**Problem:** Fixed `LIMIT 20` every 5 seconds. Under message spikes, the queue could grow faster than the worker could drain it.

**Fix:**
- `queue_size = SELECT COUNT(*) FROM lead_thread_recompute_queue`
- `batch_size = min(200, max(20, queue_size / 10))`
- Pass `batch_size` to `claim_lead_thread_recompute_batch(p_limit)`

---

**Migrations (in order):**
1. `database/lead_thread_recompute_queue_v2.sql`
2. `database/lead_thread_recompute_rpc.sql` (re-run to update function)

**Implementation complete.**
