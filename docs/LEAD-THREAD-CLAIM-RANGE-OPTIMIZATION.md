# LEAD THREAD CLAIM RANGE OPTIMIZATION

**Report** — Index range scan optimization for the lead thread recompute claim query.

---

## 1 Separated unclaimed-row claim path

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Problem:** Single predicate with `claimed_at IS NULL OR claimed_at <= NOW() - 60s` caused a wide index range scan.

**Fix:**
- **Step 1:** Dedicated query for unclaimed rows
- Predicate: `scheduled_at <= NOW() AND claimed_at IS NULL`
- Uses `idx_lead_recompute_ready (scheduled_at, retry_count) WHERE claimed_at IS NULL`
- Targeted index scan on unclaimed rows only

---

## 2 Expired-claim recovery path

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Implementation:**
- **Step 2:** Runs only when Step 1 returns fewer rows than `p_limit`
- Predicate: `scheduled_at <= NOW() AND claimed_at <= NOW() - interval '60 seconds'`
- Uses `idx_lead_recompute_claim_path (scheduled_at, claimed_at, retry_count)`
- `LIMIT (lim - cnt)` where `cnt` is the number of rows from Step 1

---

## 3 Targeted index scans verified

**Index usage:**
- **Unclaimed path:** `idx_lead_recompute_ready` — partial index on `(scheduled_at, retry_count)` where `claimed_at IS NULL`
- **Expired path:** `idx_lead_recompute_claim_path` — composite `(scheduled_at, claimed_at, retry_count)`

---

## 4 Reduced index range scanning

**Outcome:** Each query restricts `claimed_at` to a single range:
- Step 1: `claimed_at IS NULL`
- Step 2: `claimed_at <= NOW() - 60 seconds`

No mixed ranges, so the planner can use narrow index range scans.

---

**Migration:** Re-run `database/lead_thread_recompute_rpc.sql`. Function changed from `LANGUAGE sql` to `LANGUAGE plpgsql`.

**Implementation complete.**
