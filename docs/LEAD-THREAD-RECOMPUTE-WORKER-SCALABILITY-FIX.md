# LEAD THREAD RECOMPUTE WORKER SCALABILITY FIX

**Report** — Four scalability corrections applied to the lead thread recompute worker.

---

## 1 Removed full queue COUNT scan

**Location:** `database/lead_thread_recompute_rpc.sql`, `backend/workers/leadThreadRecomputeWorker.ts`

**Problem:** `SELECT COUNT(*) FROM lead_thread_recompute_queue` ran every 5 seconds. On large queues (100k+ rows), this caused expensive sequential scans.

**Fix:**
- Added RPC `get_lead_recompute_queue_approx_count()` using `pg_class.reltuples`
- Query: `SELECT reltuples::bigint FROM pg_class c JOIN pg_namespace n ... WHERE relname = 'lead_thread_recompute_queue'`
- Worker uses approximate count for batch sizing; falls back to MIN_BATCH on error

---

## 2 Added worker jitter

**Location:** `backend/scheduler/cron.ts`

**Problem:** Multiple workers ran every 5 seconds in sync, causing burst load (stampede).

**Fix:**
- Replaced fixed `setInterval(5s)` with recursive `setTimeout`
- Interval: `5000ms + random(0–2000ms)` (5–7 seconds)
- Each instance schedules next run after completing the current one

---

## 3 Added recompute queue index

**Location:** `database/lead_thread_recompute_queue_v2.sql`

**Problem:** Claim query `SELECT ... WHERE scheduled_at <= NOW() AND (claimed_at IS NULL OR ...) FOR UPDATE SKIP LOCKED` could hotspot on large tables.

**Fix:**
- Added index: `CREATE INDEX idx_lead_recompute_sched_claim ON lead_thread_recompute_queue (scheduled_at, claimed_at)`
- Speeds up selection of eligible rows for claiming

---

## 4 Prevented unnecessary recompute scheduling

**Location:** `database/lead_thread_score_cache.sql`, `backend/services/leadThreadScoring.ts`, `backend/workers/leadThreadRecomputeWorker.ts`

**Problem:** `scheduleThreadScoreUpdate()` could enqueue recompute even when thread_lead_score had not changed.

**Fix:**
- Created `lead_thread_score_cache` (thread_id, organization_id, thread_lead_score, updated_at)
- **scheduleThreadScoreUpdate:** Compute new score, read cache; if `cached_score === new_score`, skip insert
- **Worker:** After successful compute, upsert cache with `thread_lead_score`

---

**Migrations (in order):**
1. `database/lead_thread_recompute_queue_v2.sql` (includes index)
2. `database/lead_thread_recompute_rpc.sql` (includes get_lead_recompute_queue_approx_count)
3. `database/lead_thread_score_cache.sql`

**Implementation complete.**
