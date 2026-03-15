# LEAD DETECTION RELIABILITY CORRECTION

**Report** — Four reliability corrections applied to the Lead Detection pipeline.

---

## 1 Insert race window fix

**Location:** `backend/services/leadDetectionService.ts` — `processMessageForLeads()`

**Problem:** Between loading `existingRow` and running `insert()`, another worker may insert the row. Previous handling skipped on unique violation (23505), which dropped the stronger signal from the second pass.

**Fix:**
- When insert fails with 23505:
  1. Reload the row from the database
  2. Compare scores with "better signal" logic
  3. Run update if the new signal is better
- Use same update logic as normal update path: `.or()` filter so update runs only when `new.lead_score > existing` OR `(new.lead_score === existing AND new.confidence_score > existing)`

---

## 2 Thread context timestamp ordering

**Location:** `backend/services/leadDetectionService.ts` — `processMessageForLeads()`

**Problem:** Reversing array did not preserve timestamp order guarantees when `platform_created_at` values were missing or ambiguous.

**Fix:**
- Select both `content` and `platform_created_at` from `engagement_messages`
- Sort in code: `messages.sort((a,b) => new Date(a.platform_created_at).getTime() - new Date(b.platform_created_at).getTime())`
- Pass only concatenated `content` to `detectLeadSignals()`

---

## 3 Multi-instance recompute guard

**Location:** `database/lead_thread_recompute_queue.sql`, `backend/services/leadThreadScoring.ts`

**Problem:** `threadScoreUpdateQueue` was in-memory only; multiple workers would still recompute thread scores in multi-instance deployments.

**Fix:**
- Created table `lead_thread_recompute_queue`:
  - `thread_id` (FK → engagement_threads)
  - `organization_id` (FK → companies)
  - `scheduled_at` (TIMESTAMPTZ)
  - PRIMARY KEY (thread_id, organization_id)
- `scheduleThreadScoreUpdate()` inserts with `upsert(..., { onConflict: 'thread_id,organization_id', ignoreDuplicates: true })`
- Only schedules local `setTimeout` when insert succeeds; on conflict, another worker has it
- When timeout fires, worker claims row via `DELETE ... RETURNING` and runs `computeThreadLeadScore` only if it claimed the row

**Migration:** Run `database/lead_thread_recompute_queue.sql` before deploying.

---

## 4 Thread score stale protection

**Location:** `backend/services/leadDetectionService.ts` — `processMessageForLeads()`

**Problem:** Recompute ran only when `lead_score` increased. If second pass reduced `lead_score` (e.g. intent normalization corrected a false positive), thread score remained inflated.

**Fix:**
- Trigger recompute when `lead_score` changes (increase OR decrease)
- Changed condition from `signal.lead_score > existingScore` to `signal.lead_score !== existingScore`

---

**Implementation complete.**
