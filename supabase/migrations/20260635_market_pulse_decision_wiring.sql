-- Phase 2: Decision wiring & cross-product intelligence.
--
-- Four additive surfaces (no DROPs, no NOT NULLs on existing columns):
--
--   1. market_pulse_memory — longitudinal columns for trajectory tracking.
--      We already have times_seen + first_seen_at + last_seen_at; this
--      adds the velocity, cadence, persistence, spread, and tier-history
--      signals needed by marketMemoryEvolutionService.
--
--   2. market_pulse_findings — cross-product linkage so findings can
--      reference upstream signal_clusters / intelligence_signals (Phase 2
--      cross-product correlation), the recommendation row that tracked
--      this finding's "shown" event, and the opportunity/campaign that
--      was generated from it.
--
--   3. market_pulse_runs — pre-computed executive panels (momentum,
--      category acceleration, competitor pressure, escalation timeline)
--      so the UI doesn't have to re-aggregate every render.
--
--   4. cluster_role enum gains two new values:
--        'emerging_market_shift'         (cluster spreading rapidly)
--        'coordinated_competitor_movement' (multiple findings about same
--                                           set of competitors in one run)

-- ── 1. market_pulse_memory longitudinal tracking ─────────────────────────────
ALTER TABLE market_pulse_memory
  ADD COLUMN IF NOT EXISTS escalation_velocity     NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS recurrence_cadence_days NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS category_persistence_runs INTEGER NULL,
  ADD COLUMN IF NOT EXISTS regional_spread_score   NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS last_priority_tier      TEXT    NULL,
  ADD COLUMN IF NOT EXISTS peak_priority_tier      TEXT    NULL,
  ADD COLUMN IF NOT EXISTS trajectory              TEXT    NULL,
  ADD COLUMN IF NOT EXISTS tier_history            JSONB   NULL,
  ADD COLUMN IF NOT EXISTS first_priority_tier     TEXT    NULL,
  ADD COLUMN IF NOT EXISTS last_category           TEXT    NULL;

ALTER TABLE market_pulse_memory
  DROP CONSTRAINT IF EXISTS market_pulse_memory_trajectory_check;
ALTER TABLE market_pulse_memory
  ADD CONSTRAINT market_pulse_memory_trajectory_check
  CHECK (trajectory IS NULL OR trajectory IN ('accelerating', 'fading', 'cyclic', 'structural', 'stable'));

-- Helps the trajectory-classification SELECT find the company's most-recent
-- evolving entries quickly.
CREATE INDEX IF NOT EXISTS idx_market_pulse_memory_company_trajectory
  ON market_pulse_memory (company_id, trajectory)
  WHERE trajectory IS NOT NULL;

-- ── 2. market_pulse_findings cross-product linkage ───────────────────────────
ALTER TABLE market_pulse_findings
  ADD COLUMN IF NOT EXISTS cluster_signal_ids                 JSONB   NULL,
  ADD COLUMN IF NOT EXISTS related_intelligence_signal_ids    JSONB   NULL,
  ADD COLUMN IF NOT EXISTS historical_finding_ids             JSONB   NULL,
  ADD COLUMN IF NOT EXISTS recommendation_shown_id            TEXT    NULL,
  ADD COLUMN IF NOT EXISTS generated_opportunity_id           UUID    NULL,
  ADD COLUMN IF NOT EXISTS generated_campaign_payload         JSONB   NULL,
  ADD COLUMN IF NOT EXISTS trajectory                         TEXT    NULL,
  ADD COLUMN IF NOT EXISTS escalation_level                   TEXT    NULL;

-- New cluster_role values — drop and re-add the existing CHECK constraint with
-- the expanded value set. The existing constraint is from migration 20260634.
ALTER TABLE market_pulse_findings
  DROP CONSTRAINT IF EXISTS market_pulse_findings_cluster_role_check;
ALTER TABLE market_pulse_findings
  ADD CONSTRAINT market_pulse_findings_cluster_role_check
  CHECK (cluster_role IS NULL OR cluster_role IN (
    'isolated', 'repeated', 'market_wide', 'localized_anomaly',
    'emerging_market_shift', 'coordinated_competitor_movement'
  ));

ALTER TABLE market_pulse_findings
  DROP CONSTRAINT IF EXISTS market_pulse_findings_trajectory_check;
ALTER TABLE market_pulse_findings
  ADD CONSTRAINT market_pulse_findings_trajectory_check
  CHECK (trajectory IS NULL OR trajectory IN ('accelerating', 'fading', 'cyclic', 'structural', 'stable'));

ALTER TABLE market_pulse_findings
  DROP CONSTRAINT IF EXISTS market_pulse_findings_escalation_level_check;
ALTER TABLE market_pulse_findings
  ADD CONSTRAINT market_pulse_findings_escalation_level_check
  CHECK (escalation_level IS NULL OR escalation_level IN (
    'first_occurrence', 'repeated', 'escalating_pattern', 'market_wide_propagation'
  ));

-- ── 3. market_pulse_runs pre-computed executive panels ───────────────────────
ALTER TABLE market_pulse_runs
  ADD COLUMN IF NOT EXISTS momentum_overview     JSONB NULL,
  ADD COLUMN IF NOT EXISTS category_acceleration JSONB NULL,
  ADD COLUMN IF NOT EXISTS competitor_pressure   JSONB NULL,
  ADD COLUMN IF NOT EXISTS propagation_map       JSONB NULL,
  ADD COLUMN IF NOT EXISTS trend_persistence     JSONB NULL,
  ADD COLUMN IF NOT EXISTS escalation_timeline   JSONB NULL;
