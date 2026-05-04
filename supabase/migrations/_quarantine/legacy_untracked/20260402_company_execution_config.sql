-- ─────────────────────────────────────────────────────────────────────────────
-- company_execution_config — per-company feature flags + frequency preferences
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Each row controls which background features run for a given company and
-- at what cadence. The intent execution service reads this table (with Redis
-- caching) before every cron cycle so that jobs with no enabled companies are
-- skipped entirely, saving unnecessary Redis/DB/AI operations.
--
-- Feature flags map to groups of intelligence job types:
--   insights.market_trends       → signal_clustering, signal_intelligence,
--                                   strategic_themes, trend_relevance,
--                                   engagement_signal_scheduler,
--                                   engagement_opportunity_scanner
--   insights.competitor_tracking → intelligence_polling, engagement_polling
--   insights.ai_recommendations  → campaign_opportunities, content_opportunities,
--                                   narrative_engine, community_posts,
--                                   thread_engine, daily_intelligence,
--                                   campaign_health_evaluation
--
-- Frequency tiers control the minimum interval between runs (enforced by the
-- scheduler as a multiplier on the hardcoded base interval):
--   1h → run at most once per hour
--   2h → run at most once per 2 hours  (default)
--   8h → run at most once per 8 hours
--
-- Rows are created with defaults on first access (upsert semantics).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS company_execution_config (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id  TEXT        NOT NULL,

  -- ── Feature flags ──────────────────────────────────────────────────────────
  insights_market_trends        BOOLEAN NOT NULL DEFAULT TRUE,
  insights_competitor_tracking  BOOLEAN NOT NULL DEFAULT TRUE,
  insights_ai_recommendations   BOOLEAN NOT NULL DEFAULT TRUE,

  -- ── Frequency preference ───────────────────────────────────────────────────
  frequency_insights  TEXT NOT NULL DEFAULT '2h'
    CONSTRAINT chk_frequency_insights CHECK (frequency_insights IN ('1h', '2h', '8h')),

  -- ── Metadata ───────────────────────────────────────────────────────────────
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT company_execution_config_company_id_unique UNIQUE (company_id)
);

-- Fast lookup by company
CREATE INDEX IF NOT EXISTS idx_cec_company_id ON company_execution_config (company_id);

-- Partial index for rows that have at least one feature disabled (rare — only
-- scanned to find companies that need selective job filtering)
CREATE INDEX IF NOT EXISTS idx_cec_any_disabled
  ON company_execution_config (company_id)
  WHERE insights_market_trends = FALSE
     OR insights_competitor_tracking = FALSE
     OR insights_ai_recommendations = FALSE;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION trg_cec_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cec_set_updated_at ON company_execution_config;
CREATE TRIGGER cec_set_updated_at
  BEFORE UPDATE ON company_execution_config
  FOR EACH ROW EXECUTE FUNCTION trg_cec_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- intent_savings_log — daily aggregate of skipped jobs + estimated saved ops
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Written by the intent execution service at the end of each cron cycle.
-- Used by the savings-report dashboard to display:
--   "Saved ~35,000 Redis ops today by skipping unused jobs"
--
-- One row per (day, skip_reason).  Upserted with ON CONFLICT DO UPDATE
-- so no duplicates accumulate.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS intent_savings_log (
  id                    UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  day                   DATE        NOT NULL,              -- UTC date
  skip_reason           TEXT        NOT NULL,              -- 'feature_disabled' | 'company_inactive' | 'frequency_not_elapsed' | 'no_active_companies'
  skipped_jobs_count    BIGINT      NOT NULL DEFAULT 0,
  skipped_redis_ops_est BIGINT      NOT NULL DEFAULT 0,    -- estimated ops saved (20 ops/job lifecycle)
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT intent_savings_log_day_reason UNIQUE (day, skip_reason)
);

CREATE INDEX IF NOT EXISTS idx_isl_day ON intent_savings_log (day DESC);

COMMENT ON TABLE intent_savings_log IS
  'Daily aggregate of jobs skipped by the intent execution service. '
  'Used by the savings-report dashboard API.';

COMMENT ON TABLE company_execution_config IS
  'Per-company feature flags and frequency preferences for background job execution. '
  'Rows are created on first access with all features enabled at 2h cadence.';
