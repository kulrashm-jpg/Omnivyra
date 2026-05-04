-- =====================================================
-- LEAD THREAD RECOMPUTE QUEUE v2
-- Add claimed_at (claim-before-delete), retry_count, and claim index
-- Run after: lead_thread_recompute_queue.sql
-- =====================================================

ALTER TABLE lead_thread_recompute_queue
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

-- Expression index aligned with ORDER BY (claimed_at IS NOT NULL) DESC, scheduled_at ASC, retry_count ASC
DROP INDEX IF EXISTS idx_lead_recompute_claim_priority;
CREATE INDEX idx_lead_recompute_claim_priority
  ON lead_thread_recompute_queue ((claimed_at IS NOT NULL) DESC, scheduled_at ASC, retry_count ASC);

-- Legacy index (keep for backward compatibility)
CREATE INDEX IF NOT EXISTS idx_lead_recompute_claim_path
  ON lead_thread_recompute_queue (scheduled_at, claimed_at, retry_count);

-- Partial index for unclaimed rows (claimed_at IS NULL branch)
CREATE INDEX IF NOT EXISTS idx_lead_recompute_ready
  ON lead_thread_recompute_queue (scheduled_at, retry_count)
  WHERE claimed_at IS NULL;

-- Index audit cleanup: drop redundant indexes
DROP INDEX IF EXISTS idx_lead_recompute_sched_claim;
DROP INDEX IF EXISTS idx_lead_recompute_sched_claimed;
DROP INDEX IF EXISTS idx_lead_recompute_sched_retry;
DROP INDEX IF EXISTS idx_lead_recompute_claim_sched;
DROP INDEX IF EXISTS idx_lead_recompute_reclaim;
