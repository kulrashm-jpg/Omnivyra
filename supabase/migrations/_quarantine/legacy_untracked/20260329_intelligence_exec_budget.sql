-- ══════════════════════════════════════════════════════════════════════════════
-- Intelligence Execution Budget + Logging Enhancements
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Daily job limit — global default ───────────────────────────────────────
-- How many job executions a company may consume per calendar day (UTC).
-- Prevents runaway cost from heavy tenants.
ALTER TABLE intelligence_global_config
  ADD COLUMN IF NOT EXISTS daily_job_limit INTEGER NOT NULL DEFAULT 500;

-- ── 2. Daily job limit — company override (null = use global) ─────────────────
ALTER TABLE intelligence_company_overrides
  ADD COLUMN IF NOT EXISTS daily_job_limit INTEGER CHECK (daily_job_limit > 0);

-- ── 3. Reason column — execution log ─────────────────────────────────────────
-- Populated for every skipped entry (e.g. "disabled", "budget_exceeded",
-- "deferred") and optionally for failed entries alongside the error column.
ALTER TABLE intelligence_execution_log
  ADD COLUMN IF NOT EXISTS reason TEXT;

-- ── 4. Efficient budget-count index ───────────────────────────────────────────
-- Used by getDailyJobCount: count(company, today, non-skipped)
CREATE INDEX IF NOT EXISTS iel_budget_lookup_idx
  ON intelligence_execution_log (company_id, started_at DESC)
  WHERE company_id IS NOT NULL;
