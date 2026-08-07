-- WS-3 Milestone-5A — internal task dispatch (ADDITIVE ONLY).
--
-- Two changes, both additive:
--   1. `outreach_attempts` gains the two provenance columns an attempt must
--      record but could not: the execution runtime version that performed it,
--      and which durable limiter layer answered.
--   2. `outreach_internal_work_items` — the ONLY thing this milestone's
--      transport creates. An "internal dispatch" produces a work item somebody
--      inside the tenant can act on. Nothing leaves the platform.
--
-- Modifies NOTHING existing beyond adding nullable columns. ADD COLUMN is DDL,
-- not a row mutation, so it does not conflict with the append-only guarantee on
-- outreach_attempts.

ALTER TABLE outreach_attempts ADD COLUMN IF NOT EXISTS execution_runtime_version text;
ALTER TABLE outreach_attempts ADD COLUMN IF NOT EXISTS limiter_layer text;

DO $$ BEGIN
  ALTER TABLE outreach_attempts
    ADD CONSTRAINT outreach_attempts_limiter_layer_valid
    CHECK (limiter_layer IS NULL OR limiter_layer IN ('redis', 'db'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── internal work items ─────────────────────────────────────────────────────
--
-- Append-only, like every other execution record in WS-3. A work item is
-- evidence that an internal action was dispatched; it is not a mutable to-do
-- list, and rewriting it would rewrite the execution record.
--
-- `attempt_id` ties the item to the exact dispatch attempt that produced it, so
-- "why does this work item exist" is always answerable.

CREATE TABLE IF NOT EXISTS outreach_internal_work_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   text NOT NULL,
  task_id      uuid NOT NULL REFERENCES outreach_tasks(id) ON DELETE RESTRICT,
  attempt_id   uuid REFERENCES outreach_attempts(id) ON DELETE RESTRICT,
  lead_id      text NOT NULL,
  title        text NOT NULL,
  detail       text,
  /** Copied from the task so the item stands alone after a plan regenerates. */
  action       text,
  /** Whoever the plan nominated, when known. Assignment routing is not WS-3. */
  suggested_owner text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outreach_internal_work_items_company_not_blank CHECK (length(btrim(company_id)) > 0),
  CONSTRAINT outreach_internal_work_items_title_not_blank CHECK (length(btrim(title)) > 0),
  -- One work item per dispatch attempt: the anti-duplicate-execution anchor.
  CONSTRAINT outreach_internal_work_items_attempt_unique UNIQUE (company_id, task_id, attempt_id)
);

CREATE INDEX IF NOT EXISTS idx_outreach_internal_work_items_company
  ON outreach_internal_work_items (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_internal_work_items_task
  ON outreach_internal_work_items (company_id, task_id);

DROP TRIGGER IF EXISTS outreach_internal_work_items_append_only ON outreach_internal_work_items;
CREATE TRIGGER outreach_internal_work_items_append_only
  BEFORE UPDATE OR DELETE ON outreach_internal_work_items
  FOR EACH ROW EXECUTE FUNCTION ws3_reject_mutation();

ALTER TABLE outreach_internal_work_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY outreach_internal_work_items_service_role ON outreach_internal_work_items
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
