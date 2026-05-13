-- Phase 1A: additive columns on market_pulse_findings.
--
-- Backstory: prior to Phase 1A, syncLegacyJobIntoRun wrote
--   relevance_score = topic.momentum_score ?? 65
--   confidence_score = legacyJob.confidence_index ?? 60
--   freshness_score = 75 (literal)
-- with no per-finding priority signal beyond impact_type. The new
-- centralized scoringService computes:
--   - priority_tier ('P0' | 'P1' | 'P2')
--   - severity_modifier (0..1, reserved for Phase 1B per-category dampening)
--   - company_alignment_score (0..1, Jaccard overlap with executor context)
-- These columns are NULLABLE so existing rows continue to render and the
-- UI tolerates the legacy NULL state during the rollout window.

ALTER TABLE market_pulse_findings
  ADD COLUMN IF NOT EXISTS priority_tier TEXT NULL;

ALTER TABLE market_pulse_findings
  ADD COLUMN IF NOT EXISTS severity_modifier NUMERIC NULL;

ALTER TABLE market_pulse_findings
  ADD COLUMN IF NOT EXISTS company_alignment_score NUMERIC NULL;

-- Defensive constraint: priority_tier accepts only the documented enum
-- values. Drop-then-add so re-running the migration is idempotent.
ALTER TABLE market_pulse_findings
  DROP CONSTRAINT IF EXISTS market_pulse_findings_priority_tier_check;

ALTER TABLE market_pulse_findings
  ADD CONSTRAINT market_pulse_findings_priority_tier_check
  CHECK (priority_tier IS NULL OR priority_tier IN ('P0', 'P1', 'P2'));

-- Index supports the new feed view's "show P0 first" ordering and the
-- alert wiring's "any P0 risks in this run?" probe.
CREATE INDEX IF NOT EXISTS idx_market_pulse_findings_run_priority
  ON market_pulse_findings (run_id, priority_tier);
