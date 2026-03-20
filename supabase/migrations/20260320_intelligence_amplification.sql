-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 6 — Intelligence Amplification
-- Global learning layer, long-term memory extensions, competitive signals.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: global_campaign_patterns ─────────────────────────────────────────
-- Aggregates high-signal patterns across all accounts (anonymised).
-- Used to inject cross-account intelligence into future planning prompts.
CREATE TABLE IF NOT EXISTS global_campaign_patterns (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform              text NOT NULL,
  content_type          text NOT NULL,
  pattern_type          text NOT NULL CHECK (pattern_type IN ('hook', 'cta', 'structure', 'format', 'timing')),
  pattern               text NOT NULL,
  avg_engagement_rate   float NOT NULL DEFAULT 0,
  sample_count          int   NOT NULL DEFAULT 1,
  confidence            float NOT NULL DEFAULT 0.5,
  industry_tags         text[] NOT NULL DEFAULT '{}',
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, content_type, pattern_type, pattern)
);

CREATE INDEX IF NOT EXISTS global_patterns_platform_type_idx ON global_campaign_patterns(platform, pattern_type);
CREATE INDEX IF NOT EXISTS global_patterns_engagement_idx ON global_campaign_patterns(avg_engagement_rate DESC);
CREATE INDEX IF NOT EXISTS global_patterns_confidence_idx ON global_campaign_patterns(confidence DESC);

ALTER TABLE global_campaign_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON global_campaign_patterns
  FOR ALL USING (auth.role() = 'service_role');

-- ── Step 3: competitor_signals ────────────────────────────────────────────────
-- Stores inferred competitor activity derived from community mentions + benchmarks.
CREATE TABLE IF NOT EXISTS competitor_signals (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL,
  competitor_name        text NOT NULL,
  signal_type            text NOT NULL CHECK (signal_type IN ('mention', 'benchmark', 'format', 'frequency')),
  platform               text,
  value                  jsonb NOT NULL DEFAULT '{}',
  confidence             float NOT NULL DEFAULT 0.5,
  detected_at            timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS competitor_signals_company_idx ON competitor_signals(company_id, detected_at DESC);

ALTER TABLE competitor_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON competitor_signals
  FOR ALL USING (auth.role() = 'service_role');

-- ── Step 5: Long-term memory extensions on campaign_learnings ─────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'campaign_learnings' AND column_name = 'decay_factor'
  ) THEN
    ALTER TABLE campaign_learnings ADD COLUMN decay_factor float NOT NULL DEFAULT 1.0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'campaign_learnings' AND column_name = 'reinforcement_score'
  ) THEN
    ALTER TABLE campaign_learnings ADD COLUMN reinforcement_score float NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'campaign_learnings' AND column_name = 'times_reinforced'
  ) THEN
    ALTER TABLE campaign_learnings ADD COLUMN times_reinforced int NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'campaign_learnings' AND column_name = 'last_reinforced_at'
  ) THEN
    ALTER TABLE campaign_learnings ADD COLUMN last_reinforced_at timestamptz;
  END IF;
END $$;

-- ── Step 6: strategy_evolution_log ───────────────────────────────────────────
-- Tracks how strategy has shifted over time per company.
CREATE TABLE IF NOT EXISTS strategy_evolution_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL,
  previous_snapshot   jsonb NOT NULL DEFAULT '{}',
  new_snapshot        jsonb NOT NULL DEFAULT '{}',
  changes             jsonb NOT NULL DEFAULT '[]',
  evolution_reason    text NOT NULL,
  confidence          float NOT NULL DEFAULT 0.5,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strategy_evolution_company_idx ON strategy_evolution_log(company_id, created_at DESC);

ALTER TABLE strategy_evolution_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON strategy_evolution_log
  FOR ALL USING (auth.role() = 'service_role');

-- ── Step 7: portfolio_decision_log ───────────────────────────────────────────
-- Multi-campaign budget reallocation decisions.
CREATE TABLE IF NOT EXISTS portfolio_decision_log (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL,
  campaign_ids         uuid[] NOT NULL,
  budget_allocations   jsonb NOT NULL DEFAULT '{}',
  rebalance_actions    jsonb NOT NULL DEFAULT '[]',
  reasoning            text[] NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portfolio_decision_company_idx ON portfolio_decision_log(company_id, created_at DESC);

ALTER TABLE portfolio_decision_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON portfolio_decision_log
  FOR ALL USING (auth.role() = 'service_role');
