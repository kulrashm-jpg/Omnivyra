# CAMPAIGN STATE PERSISTENCE LAYER

## Goal

Ensure campaign execution can resume from last completed week/day after:

- Server restart
- Deployment
- Internet interruption
- Worker crash

No changes to enrichment logic or alignment engine.

---

## CAMPAIGN STATE MODEL

### 1. Table schema (SQL-style)

```sql
-- campaign_execution_state: One row per campaign, tracks execution progress
CREATE TABLE campaign_execution_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL UNIQUE REFERENCES campaigns(id) ON DELETE CASCADE,

  -- Plan dimensions (read-only at execution; from enrichment/blueprint)
  duration_weeks SMALLINT NOT NULL CHECK (duration_weeks IN (2, 4, 8, 12)),

  -- Current position (1-based; where execution will continue)
  current_week SMALLINT NOT NULL DEFAULT 1 CHECK (current_week >= 1 AND current_week <= 12),
  current_day SMALLINT NOT NULL DEFAULT 1 CHECK (current_day >= 1 AND current_day <= 7),

  -- Audit: which weeks/days are fully completed
  completed_weeks SMALLINT[] NOT NULL DEFAULT '{}',
  completed_days JSONB NOT NULL DEFAULT '[]',
  -- completed_days: [{week: 1, day: 1}, {week: 1, day: 2}, ...] — ordered (week, day)

  -- Execution context for resume
  momentum_snapshot JSONB NOT NULL DEFAULT '{}',
  -- momentum_snapshot: { week: N, momentum_level: "low"|"medium"|"high"|"peak", psychological_movement: "..." }

  -- Content linkage (last produced item; used for dedup / continuity)
  last_generated_content_id UUID REFERENCES daily_content_plans(id) ON DELETE SET NULL,

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),

  -- Timestamps
  started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_current_week_range CHECK (current_week <= duration_weeks)
);

CREATE INDEX idx_campaign_execution_state_campaign ON campaign_execution_state(campaign_id);
CREATE INDEX idx_campaign_execution_state_status ON campaign_execution_state(status);
```

**Field notes:**

| Field | Type | Purpose |
|-------|------|---------|
| `campaign_id` | UUID | FK to campaigns; one execution state per campaign |
| `duration_weeks` | 2,4,8,12 | From enrichment; bounds `current_week` |
| `current_week` | 1..12 | Next week to work on |
| `current_day` | 1..7 | Next day within current week |
| `completed_weeks` | SMALLINT[] | Weeks fully done (all 7 days) |
| `completed_days` | JSONB | Individual days completed; `{week, day}` pairs |
| `momentum_snapshot` | JSONB | Current week's momentum_level + psychological_movement for execution layer |
| `last_generated_content_id` | UUID | Last created daily_content_plans row |
| `status` | active \| paused \| completed | Execution lifecycle |

---

## 2. Execution lifecycle

### Start campaign

**Preconditions:** Campaign exists; blueprint/enrichment committed; no existing `campaign_execution_state` row.

**Actions:**
1. INSERT `campaign_execution_state` with:
   - `campaign_id`, `duration_weeks` (from blueprint)
   - `current_week = 1`, `current_day = 1`
   - `completed_weeks = []`, `completed_days = []`
   - `status = 'active'`
   - `started_at = NOW()`
2. Set `momentum_snapshot` from week 1 guidance (momentum_level, psychological_movement).

**Idempotency:** If row exists with `status = 'active'`, treat as resume; do not insert.

---

### Complete day

**Preconditions:** `status = 'active'`; `current_week` and `current_day` within bounds.

**Actions:**
1. Append `{week: current_week, day: current_day}` to `completed_days`.
2. If `last_generated_content_id` provided, UPDATE it.
3. Advance: `current_day = current_day + 1`.
4. If `current_day > 7`: set `current_week = current_week + 1`, `current_day = 1`; append `current_week - 1` to `completed_weeks`.
5. If `current_week > duration_weeks`: set `status = 'completed'`.
6. Else: refresh `momentum_snapshot` from weekly guidance for new `current_week`.
7. `updated_at = NOW()`.

**Idempotency:** If `completed_days` already contains `{week, day}`, skip. Optionally accept idempotency key; if present, no-op on duplicate.

---

### Complete week

**Preconditions:** All 7 days of the week are in `completed_days`; `status = 'active'`.

**Actions:**
1. Verify week is fully represented in `completed_days`.
2. Add week to `completed_weeks` if not already present.
3. Advance `current_week`, reset `current_day = 1`.
4. If `current_week > duration_weeks`: set `status = 'completed'`.
5. Refresh `momentum_snapshot`.
6. `updated_at = NOW()`.

**Idempotency:** If week already in `completed_weeks`, no-op.

---

### Resume campaign

**Preconditions:** Row exists; `status IN ('active', 'paused')`.

**Actions:**
1. SELECT `campaign_execution_state` by `campaign_id`.
2. Read `current_week`, `current_day`, `momentum_snapshot`.
3. Load weekly guidance (from enrichment/blueprint) for `current_week`.
4. If `status = 'paused'` and caller intends to run: set `status = 'active'`.
5. Execution layer continues from `(current_week, current_day)` using `momentum_snapshot` and guidance.

**Idempotency:** Read is idempotent. No state change unless explicit (e.g. unpause).

---

## 3. Idempotency rules

| Operation | Rule |
|-----------|------|
| **Start** | If `campaign_execution_state` exists for `campaign_id`, do not INSERT. Return existing row (resume path). |
| **Complete day** | If `(week, day)` already in `completed_days`, treat as no-op. Return success without advancing. |
| **Complete week** | If week already in `completed_weeks`, no-op. |
| **Resume** | Pure read; no state mutation. |
| **Pause** | If `status` already `paused`, no-op. |

**Idempotency key:** For `complete_day`, caller may pass `idempotency_key` (e.g. hash of `campaign_id + week + day + timestamp`). Store in separate `campaign_execution_idempotency` table; reject duplicate key.

---

## 4. Failure recovery rules

| Scenario | Recovery |
|---------|---------|
| **Server restart** | On startup, worker queries `campaign_execution_state WHERE status = 'active'`. Resumes each at `(current_week, current_day)` using `momentum_snapshot`. |
| **Deployment** | Same as restart. State is persisted; new process loads and resumes. |
| **Internet interruption** | Worker retries `complete_day` / `complete_week` when connection restored. Idempotency ensures no double-count. |
| **Worker crash mid-day** | `complete_day` not called; `current_week`/`current_day` unchanged. On resume, retry day from start. Content already written (if any) identified via `last_generated_content_id`; caller may dedup or overwrite per policy. |
| **Worker crash after DB write, before response** | Client retries with same idempotency key; server treats as duplicate, returns success. |
| **Corrupted state** | `current_week`/`current_day` can be recalculated from `completed_days`: max `(week, day)` + 1. Admin repair: UPDATE from derived values. |
| **Completed campaign restarted** | If `status = 'completed'` and start requested: either reject, or support explicit "restart" that resets to week 1, day 1, clears `completed_*`, sets `status = 'active'`. |

---

## Summary

| Item | Value |
|------|-------|
| Table | `campaign_execution_state` |
| Cardinality | One row per campaign |
| Status flow | active → paused (optional) → completed |
| Resume | Read `current_week`, `current_day`, `momentum_snapshot`; continue from there |
| Idempotency | Dedup by `completed_days` / `completed_weeks`; optional idempotency keys |
| Recovery | Reload state; retry operations; idempotent writes prevent double progress |
