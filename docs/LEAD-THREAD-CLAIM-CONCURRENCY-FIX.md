# LEAD THREAD CLAIM CONCURRENCY FIX

**Report** — Four concurrency corrections for the lead thread recompute claim logic.

---

## 1 Step 2 conditional execution

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Problem:** Step 2 could run even when Step 1 already returned enough rows.

**Fix:**
- Track rows from Step 1 with `GET DIAGNOSTICS cnt = ROW_COUNT`
- Run Step 2 only when `cnt < lim`
- Step 2 uses `LIMIT (lim - cnt)` to avoid over-claiming

---

## 2 Lock-safe expired claim path

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Problem:** Expired-claim query might lock rows already locked by other workers.

**Fix:**
- Both Step 1 and Step 2 use `FOR UPDATE OF q SKIP LOCKED`
- Rows locked by another worker are skipped
- Prevents contention and relocking

---

## 3 Removed redundant ordering

**Location:** `database/lead_thread_recompute_rpc.sql`, `backend/workers/leadThreadRecomputeWorker.ts`

**Problem:** Results were ordered in SQL and again in application logic.

**Fix:**
- SQL returns rows ordered by `scheduled_at, retry_count` via `ORDER BY b.scheduled_at, b.retry_count` in `RETURN QUERY`
- Worker iterates without sorting
- No re-sorting in application code

---

## 4 Scan depth guard

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Problem:** Very large queues could cause deep index scans.

**Fix:**
- Added predicate to both Step 1 and Step 2: `scheduled_at >= NOW() - interval '24 hours'`
- Limits claim scan to the last 24 hours
- Older jobs left for periodic maintenance (e.g. orphan cleanup)

---

**Migration:** Re-run `database/lead_thread_recompute_rpc.sql`.

**Implementation complete.**
