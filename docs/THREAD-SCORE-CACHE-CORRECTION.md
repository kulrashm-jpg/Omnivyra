# THREAD SCORE CACHE CORRECTION

**Report** — Design flaw corrections in the thread score caching mechanism.

---

## 1 Removed score computation from scheduler

**Location:** `backend/services/leadThreadScoring.ts` — `scheduleThreadScoreUpdate()`

**Problem:** scheduleThreadScoreUpdate() computed thread score, then the worker computed it again, duplicating expensive work.

**Fix:**
- scheduleThreadScoreUpdate() no longer calls `computeThreadLeadScore()`
- Only inserts into the queue; worker is the sole compute path

---

## 2 Removed cache read from scheduling path

**Location:** `backend/services/leadThreadScoring.ts` — `scheduleThreadScoreUpdate()`

**Problem:** Every schedule call read from `lead_thread_score_cache`, causing DB read pressure under heavy ingestion.

**Fix:**
- Removed all cache reads from scheduleThreadScoreUpdate()
- Cache is not accessed during scheduling

---

## 3 Cache used only for worker updates

**Location:** `backend/services/leadThreadScoring.ts`, `backend/workers/leadThreadRecomputeWorker.ts`

**Problem:** Cache was used to decide whether to schedule. Stale cache or worker crashes could cause skipped updates.

**Fix:**
- Cache never controls scheduling decisions
- Cache is a read-performance optimization only; worker updates it after successful compute
- Scheduling is independent of cache state

---

## 4 Idempotent queue insertion verified

**Location:** `backend/services/leadThreadScoring.ts` — `scheduleThreadScoreUpdate()`

**Implementation:**
- `INSERT INTO lead_thread_recompute_queue (thread_id, organization_id, scheduled_at) VALUES (...) ON CONFLICT DO NOTHING`
- Implemented via `upsert(..., { onConflict: 'thread_id,organization_id', ignoreDuplicates: true })`
- No score computation during scheduling

---

**Implementation complete.**
