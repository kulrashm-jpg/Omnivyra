-- Market Pulse Engine v2: predictive intelligence upgrade.
-- Adds narrative_phase, velocity_score, momentum_score to items;
-- region_divergence_score, arbitrage_opportunities, localized_risk_pockets to jobs.

-- Items: predictive signals
ALTER TABLE market_pulse_items_v1
ADD COLUMN IF NOT EXISTS narrative_phase text;

ALTER TABLE market_pulse_items_v1
ADD COLUMN IF NOT EXISTS velocity_score numeric DEFAULT 0;

ALTER TABLE market_pulse_items_v1
ADD COLUMN IF NOT EXISTS momentum_score numeric DEFAULT 0;

-- Jobs: regional intelligence
ALTER TABLE market_pulse_jobs_v1
ADD COLUMN IF NOT EXISTS region_divergence_score numeric DEFAULT 0;

ALTER TABLE market_pulse_jobs_v1
ADD COLUMN IF NOT EXISTS arbitrage_opportunities jsonb;

ALTER TABLE market_pulse_jobs_v1
ADD COLUMN IF NOT EXISTS localized_risk_pockets jsonb;

-- Constraint for narrative_phase
ALTER TABLE market_pulse_items_v1
DROP CONSTRAINT IF EXISTS market_pulse_items_narrative_phase_check;

ALTER TABLE market_pulse_items_v1
ADD CONSTRAINT market_pulse_items_narrative_phase_check CHECK (
  narrative_phase IS NULL OR narrative_phase IN (
    'EMERGING', 'ACCELERATING', 'PEAKING', 'DECLINING', 'STRUCTURAL'
  )
);
