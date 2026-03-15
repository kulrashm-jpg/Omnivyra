# LEAD THREAD CLAIM FAIRNESS FIX

**Report** — Scheduling fairness fix for expired-claim starvation.

---

## 1 Added periodic expired-claim prioritization

**Location:** `database/lead_thread_recompute_rpc.sql`, `backend/workers/leadThreadRecomputeWorker.ts`

**Problem:** With a steady stream of new unclaimed rows, Step 1 always filled `p_limit`. Step 2 never ran, so expired claims stayed in the queue indefinitely.

**Fix:**
- Every 5 worker cycles: run Step 2 (expired claims) first
- Otherwise: run Step 1 (unclaimed) first
- New RPC parameter: `p_prioritize_expired BOOLEAN DEFAULT FALSE`

---

## 2 Implemented worker cycle counter

**Location:** `backend/workers/leadThreadRecomputeWorker.ts`

**Implementation:**
- Module-level `claimCycleCounter` incremented each worker run
- `prioritizeExpired = claimCycleCounter % 5 === 0`
- Passed to RPC as `p_prioritize_expired`

---

## 3 Balanced claim path execution

**Location:** `database/lead_thread_recompute_rpc.sql`

**Implementation:**
- When `p_prioritize_expired` is true: expired claims first (LIMIT lim), then unclaimed (LIMIT remaining)
- When false: unclaimed first, then expired claims
- Both paths use `FOR UPDATE OF q SKIP LOCKED`
- Same batch limit (LEAST(p_limit, 200)) in both paths

---

**Migration:** Re-run `database/lead_thread_recompute_rpc.sql` (signature changed; DROP added for old overloads).

**Implementation complete.**
