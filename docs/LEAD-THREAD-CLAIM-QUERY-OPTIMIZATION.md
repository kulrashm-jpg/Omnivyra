# LEAD THREAD CLAIM QUERY OPTIMIZATION

**Report** — Four performance corrections for the lead thread recompute queue claim logic.

---

## 1 Index-safe claim filter order

**Location:** `database/lead_thread_recompute_rpc.sql`, `database/lead_thread_recompute_queue_v2.sql`

**Problem:** With `scheduled_at <= NOW()` alone, the claim could trigger large scans without proper index use.

**Fix:**
- Composite index `idx_lead_recompute_sched_claim (scheduled_at, claimed_at)` already exists
- Claim filter: `WHERE (claimed_at IS NULL OR claimed_at < NOW() - interval '60 seconds') AND scheduled_at <= NOW()`
- Order allows efficient index use on `(scheduled_at, claimed_at)`

---

## 2 Claimed row exclusion improvement

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Problem:** Ordering and filtering could re-evaluate rows already claimed but not yet expired.

**Fix:**
- Claim filter ordering: `claimed_at` condition first, then `scheduled_at`
- Excludes claimed (non-expired) rows earlier in the predicate evaluation

---

## 3 Partial index for ready rows

**Location:** `database/lead_thread_recompute_queue_v2.sql`

**Problem:** `ORDER BY scheduled_at ASC` may sort large candidate sets when the queue is very large.

**Fix:**
- Added partial index: `CREATE INDEX idx_lead_recompute_ready ON lead_thread_recompute_queue (scheduled_at) WHERE claimed_at IS NULL`
- Lets the planner quickly locate unclaimed ready rows

---

## 4 Hard cap for claim batch size

**Location:** `database/lead_thread_recompute_rpc.sql` — `claim_lead_thread_recompute_batch`

**Problem:** Dynamic batch sizing could pass very large `p_limit`.

**Fix:**
- Enforced inside RPC: `LIMIT LEAST(p_limit, 200)`
- Maximum batch size capped at 200

---

**Migrations:** Re-run `database/lead_thread_recompute_queue_v2.sql` and `database/lead_thread_recompute_rpc.sql`.

**Implementation complete.**
