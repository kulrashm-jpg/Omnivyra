-- ============================================================
-- Outcome Tracking + Continuity Engine
-- Adds campaign goal structure, performance records, and
-- topic mapping tables for the continuity decision system.
-- Fully idempotent — safe to re-run after partial failure.
-- ============================================================

-- ── 1. Extend campaigns with goal + topic fields ─────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'campaigns' AND column_name = 'goal_type'
  ) THEN
    ALTER TABLE campaigns ADD COLUMN goal_type TEXT
      CHECK (goal_type IN ('awareness','engagement','authority','lead_gen','conversion'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'campaigns' AND column_name = 'goal_benchmarks'
  ) THEN
    ALTER TABLE campaigns ADD COLUMN goal_benchmarks JSONB;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'campaigns' AND column_name = 'topic_seed'
  ) THEN
    ALTER TABLE campaigns ADD COLUMN topic_seed TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'campaigns' AND column_name = 'source_blog_id'
  ) THEN
    ALTER TABLE campaigns ADD COLUMN source_blog_id UUID;
  END IF;
END $$;

-- ── 2. campaign_performance table ────────────────────────────────────────────

DROP TABLE IF EXISTS campaign_performance CASCADE;

CREATE TABLE campaign_performance (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         UUID        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  company_id          UUID,

  -- Raw aggregated metrics
  total_reach         INTEGER,
  total_impressions   INTEGER,
  engagement_rate     DECIMAL(6,3),
  avg_likes           DECIMAL(8,2),
  total_likes         INTEGER,
  total_comments      INTEGER,
  total_clicks        INTEGER,
  total_shares        INTEGER,
  total_leads         INTEGER,

  -- Outcome evaluation (computed by outcomeEvaluator)
  evaluation_status   TEXT
    CHECK (evaluation_status IN ('exceeded','met','underperformed')),
  evaluation_score    DECIMAL(5,2),
  evaluation_summary  TEXT,
  metric_breakdown    JSONB,
  confidence_level    TEXT
    CHECK (confidence_level IN ('high','medium','low')),
  confidence_reason   TEXT,

  -- Continuity decision (computed by continuityDecisionEngine)
  recommended_action          TEXT
    CHECK (recommended_action IN ('continue','optimize','pivot')),
  next_topic                  TEXT,
  next_topic_reason           TEXT,
  suggested_blog_id           UUID,
  decision_confidence_level   TEXT
    CHECK (decision_confidence_level IN ('high','medium','low')),
  decision_confidence_reason  TEXT,
  stability_signal            TEXT
    CHECK (stability_signal IN ('stable','sensitive','volatile')),
  stability_message           TEXT,
  trade_off_gained            TEXT,
  trade_off_sacrificed        TEXT,
  trade_off_summary           TEXT,
  alternative_topic           TEXT,
  alternative_goal_type       TEXT,
  alternative_rationale       TEXT,
  counterfactual_insight      TEXT,
  effort_level                TEXT
    CHECK (effort_level IN ('high','medium','low')),
  effort_signal               TEXT
    CHECK (effort_signal IN ('leverage','high_performance','inefficiency','underpowered','moderate_return','strong_return','efficient_baseline','baseline')),

  recorded_at         TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_campaign_performance_campaign
  ON campaign_performance(campaign_id);
CREATE INDEX idx_campaign_performance_company
  ON campaign_performance(company_id) WHERE company_id IS NOT NULL;

-- ── 3. campaign_topic_map ─────────────────────────────────────────────────────

DROP TABLE IF EXISTS campaign_topic_map CASCADE;

CREATE TABLE campaign_topic_map (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  company_id      UUID,
  topic           TEXT        NOT NULL,
  related_topics  TEXT[]      DEFAULT '{}',
  blog_ids        UUID[]      DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_campaign_topic_map_campaign
  ON campaign_topic_map(campaign_id);

-- ── 4. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE campaign_performance  ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_topic_map    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON campaign_performance
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all" ON campaign_topic_map
  FOR ALL USING (auth.role() = 'service_role');
