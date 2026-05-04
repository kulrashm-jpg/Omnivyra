-- ─────────────────────────────────────────────────────────────────────────────
-- Activity Cost Tracking System
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Comprehensive cost tracking for every activity:
-- - Tracks every action: campaign creation, posting, engagement, intelligence
-- - Records resource consumption: LLM tokens, DB ops, Redis, APIs, compute, CDN
-- - Captures errors and connection failures
-- - Enables complete cost allocation and optimization analysis
--
-- Tables:
--   activity_logs: Master log of all activities
--   activity_metrics: Resource consumption per activity (1:1 with activity_logs)
--   campaign_cost_breakdown: Detailed cost tracking per campaign
--   provisioned_resources: Infrastructure cost baseline
--   activity_error_log: All errors and connection failures (critical for cost analysis)
-- ─────────────────────────────────────────────────────────────────────────────

-- ──────────────────────────────────────────────────────────────────────────────
-- CREATE PREREQUISITE TABLES (Users, Companies, Campaigns)
-- ──────────────────────────────────────────────────────────────────────────────
-- These must exist before activity_logs references them
--
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT,
  current_stage TEXT,
  timeframe TEXT,
  start_date DATE,
  end_date DATE,
  thread_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  launched_at TIMESTAMPTZ
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. ACTIVITY_LOGS - Master log of all platform activities
-- ──────────────────────────────────────────────────────────────────────────────
-- Every action leaves a trace here with full context
--
CREATE TABLE IF NOT EXISTS activity_logs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Activity identification
  activity_name         TEXT        NOT NULL,  -- "bolt_campaign_phase_1", "post_content", "engagement_sentiment_analysis", etc.
  activity_category     TEXT        NOT NULL,  -- 'campaign', 'content', 'engagement', 'intelligence', 'integration', 'system'
  parent_activity       UUID        REFERENCES activity_logs(id) ON DELETE SET NULL,  -- For nested activities
  
  -- Entity references (denormalized for fast lookup)
  campaign_id           UUID        REFERENCES campaigns(id) ON DELETE CASCADE,
  company_id            UUID        REFERENCES companies(id) ON DELETE CASCADE,
  user_id               UUID        REFERENCES users(id) ON DELETE SET NULL,
  
  -- Activity context
  activity_type         TEXT        NOT NULL,  -- 'create', 'update', 'execute', 'fetch', 'analyze', 'error'
  status                TEXT        NOT NULL DEFAULT 'success'  -- 'success', 'error', 'retry', 'partial'
  CHECK (status IN ('success', 'error', 'retry', 'partial')),
  
  -- Metadata: varies by activity type (JSONB for flexibility)
  metadata              JSONB,  -- {
                                --   "campaign_name": "High Velocity Q1 Push",
                                --   "platforms": ["instagram", "tiktok", "linkedin"],
                                --   "platform_count": 3,
                                --   "content_type": "mixed",  -- 'text_only', 'text_with_images', 'video', 'mixed'
                                --   "bolt_phase": 1,
                                --   "post_count": 3,
                                --   "duration_weeks": 4,
                                --   "features": ["competitor_intel", "sentiment_analysis"]
                                -- }
  
  -- Timing
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  duration_ms           INTEGER,  -- Actual execution time in milliseconds
  
  -- Cost allocation context
  cost_multiplier       DECIMAL(4,2) DEFAULT 1.0,  -- For discount/premium pricing
  allocation_note       TEXT,  -- e.g., "shared_db_cost", "platform_specific", "user_dependent"
  
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Indexes for common queries
  CONSTRAINT activity_logs_campaign_ref CHECK (
    (activity_category IN ('campaign', 'content', 'system') AND campaign_id IS NOT NULL) OR
    activity_category NOT IN ('campaign', 'content', 'system')
  )
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_category ON activity_logs(activity_category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_campaign ON activity_logs(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_company ON activity_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_type ON activity_logs(activity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_status ON activity_logs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON activity_logs(created_at DESC);

COMMENT ON TABLE activity_logs IS
  'Master log: Every platform activity (campaign creation, posting, intelligence, engagement, integrations). '
  'Never deleted. Used for cost tracking, audit trails, and optimization analysis. '
  'Parent activity tracking enables hierarchical cost analysis (e.g., campaign -> phases -> individual posts).';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. ACTIVITY_METRICS - Resource consumption per activity (1:1 with activity_logs)
-- ──────────────────────────────────────────────────────────────────────────────
-- Detailed cost drivers: LLM tokens, database operations, external APIs, compute, bandwidth
--
CREATE TABLE IF NOT EXISTS activity_metrics (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_log_id       UUID        NOT NULL UNIQUE REFERENCES activity_logs(id) ON DELETE CASCADE,
  
  -- LLM/AI costs
  llm_tokens            INTEGER     DEFAULT 0,  -- Total tokens (input + output)
  llm_token_cost        DECIMAL(10,6),  -- Calculated cost (tokens × $0.000005)
  llm_model             TEXT,  -- 'claude-3.5-sonnet', 'gpt-4', etc.
  llm_calls             INTEGER     DEFAULT 0,  -- Number of API calls
  
  -- Database operations (Supabase PostgreSQL)
  supabase_reads        INTEGER     DEFAULT 0,  -- Read operations
  supabase_reads_cost   DECIMAL(10,6),  -- Cost: reads × $0.0000025
  supabase_writes       INTEGER     DEFAULT 0,  -- Write operations
  supabase_writes_cost  DECIMAL(10,6),  -- Cost: writes × $0.000005
  
  -- Cache operations (Redis/Upstash)
  redis_operations      INTEGER     DEFAULT 0,  -- Get, set, delete, etc.
  redis_operations_cost DECIMAL(10,6),  -- Cost: ops × $0.000001
  
  -- External API calls (third-party integrations)
  api_calls             INTEGER     DEFAULT 0,  -- Count of external API calls
  api_calls_cost        DECIMAL(10,6),  -- Cost: calls × $0.05
  api_call_details      JSONB,  -- {
                                --   "twitter": 2,
                                --   "instagram": 1,
                                --   "platform_connector": 3
                                -- }
  
  -- Image generation (DALL-E, Midjourney, etc.)
  image_generations     INTEGER     DEFAULT 0,
  image_generations_cost DECIMAL(10,6),  -- Cost: images × $0.05
  
  -- Video processing (if applicable, future)
  video_seconds         INTEGER     DEFAULT 0,
  video_processing_cost DECIMAL(10,6),
  
  -- Compute/Serverless (Vercel Functions, Workers, etc.)
  vercel_compute_seconds DECIMAL(10,2) DEFAULT 0,  -- Seconds of execution
  vercel_compute_cost   DECIMAL(10,6),  -- Cost: seconds × $0.00001
  
  -- Bandwidth/CDN (Vercel, Cloudflare, etc.)
  cdn_egress_bytes      BIGINT      DEFAULT 0,  -- Bytes transferred
  cdn_egress_gb         DECIMAL(10,2),  -- Calculated GB
  cdn_egress_cost       DECIMAL(10,6),  -- Cost: GB × $0.05
  
  -- Monitoring/Observability (APM, error tracking)
  observability_events  INTEGER     DEFAULT 0,
  observability_cost    DECIMAL(10,6),
  
  -- Total cost of this activity
  total_resource_cost   DECIMAL(10,6) GENERATED ALWAYS AS (
    COALESCE(llm_token_cost, 0) +
    COALESCE(supabase_reads_cost, 0) +
    COALESCE(supabase_writes_cost, 0) +
    COALESCE(redis_operations_cost, 0) +
    COALESCE(api_calls_cost, 0) +
    COALESCE(image_generations_cost, 0) +
    COALESCE(video_processing_cost, 0) +
    COALESCE(vercel_compute_cost, 0) +
    COALESCE(cdn_egress_cost, 0) +
    COALESCE(observability_cost, 0)
  ) STORED,
  
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_metrics_activity ON activity_metrics(activity_log_id);
CREATE INDEX IF NOT EXISTS idx_activity_metrics_cost ON activity_metrics(total_resource_cost DESC);

COMMENT ON TABLE activity_metrics IS
  'Resource consumption detail: Every activity has exactly one metrics row. '
  'Records consumption in granular units (tokens, operations, calls) and calculated costs. '
  'Cost calculations: LLM=$0.000005/token, DB_read=$0.0000025, DB_write=$0.000005, '
  'Redis=$0.000001, API=$0.05, Images=$0.05, Compute=$0.00001/sec, CDN=$0.05/GB.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. CAMPAIGN_COST_BREAKDOWN - Detailed per-campaign cost tracking
-- ──────────────────────────────────────────────────────────────────────────────
-- Aggregated costs by phase/stage for easy campaign ROI analysis
--
CREATE TABLE IF NOT EXISTS campaign_cost_breakdown (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           UUID        NOT NULL UNIQUE REFERENCES campaigns(id) ON DELETE CASCADE,
  
  -- Campaign profile (denormalized)
  campaign_name         TEXT        NOT NULL,
  company_id            UUID        REFERENCES companies(id) ON DELETE SET NULL,
  user_id               UUID        REFERENCES users(id) ON DELETE SET NULL,
  
  -- Campaign configuration
  platform_count        INTEGER,  -- How many platforms
  platforms             TEXT[],  -- ['instagram', 'tiktok', 'linkedin']
  content_type          TEXT,  -- 'text_only', 'text_with_images', 'video', 'mixed'
  post_count            INTEGER,  -- Total planned posts
  posts_per_week        INTEGER,  -- Posting frequency
  duration_weeks        INTEGER,  -- Campaign length
  bolt_enabled          BOOLEAN DEFAULT true,  -- Using BOLT AI engine
  features              TEXT[],  -- ['competitor_intel', 'sentiment_analysis', 'multi_language']
  
  -- Cost breakdown by phase (cumulative)
  phase_1_planning_cost DECIMAL(10,2) DEFAULT 0,  -- Market research, angle selection, content outline
  phase_2_content_cost  DECIMAL(10,2) DEFAULT 0,  -- Content creation, image generation, blog
  phase_3_schedule_cost DECIMAL(10,2) DEFAULT 0,  -- Scheduling, platform optimization
  phase_4_execution_cost DECIMAL(10,2) DEFAULT 0,  -- Posting, API calls per post
  
  -- Ongoing costs (during campaign runtime)
  engagement_cost       DECIMAL(10,2) DEFAULT 0,  -- Comment monitoring, sentiment analysis, responses
  intelligence_cost     DECIMAL(10,2) DEFAULT 0,  -- Performance analysis, recommendations, continuity
  
  -- Infrastructure allocation
  infrastructure_cost   DECIMAL(10,2) DEFAULT 0,  -- Proportional DB, cache, compute overhead
  
  -- Total
  total_cost            DECIMAL(10,2) GENERATED ALWAYS AS (
    COALESCE(phase_1_planning_cost, 0) +
    COALESCE(phase_2_content_cost, 0) +
    COALESCE(phase_3_schedule_cost, 0) +
    COALESCE(phase_4_execution_cost, 0) +
    COALESCE(engagement_cost, 0) +
    COALESCE(intelligence_cost, 0) +
    COALESCE(infrastructure_cost, 0)
  ) STORED,
  
  -- Cost per unit
  cost_per_post         DECIMAL(10,6),  -- total_cost / post_count
  cost_per_platform     DECIMAL(10,6),  -- total_cost / platform_count
  
  -- Status tracking
  status                TEXT DEFAULT 'planning'
  CHECK (status IN ('planning', 'active', 'completed', 'cancelled')),
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_cost_company ON campaign_cost_breakdown(company_id);
CREATE INDEX IF NOT EXISTS idx_campaign_cost_user ON campaign_cost_breakdown(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_cost_total ON campaign_cost_breakdown(total_cost DESC);
COMMENT ON TABLE campaign_cost_breakdown IS
  'Per-campaign cost summary: Phase breakdown (planning→content→schedule→execution→engagement→intelligence). '
  'Used for ROI analysis, cost prediction, and optimization. '
  'Updated incrementally as campaign progresses through phases.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. PROVISIONED_RESOURCES - Infrastructure cost baseline
-- ──────────────────────────────────────────────────────────────────────────────
-- Tracks what infrastructure is provisioned and its monthly cost
-- Used to calculate "System Overhead" (unallocated infrastructure)
--
CREATE TABLE IF NOT EXISTS provisioned_resources (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Resource identification
  resource_type         TEXT        NOT NULL,  -- 'db_compute', 'db_storage', 'redis', 'cdn', 'monitoring', 'logging'
  provider              TEXT        NOT NULL,  -- 'supabase', 'vercel', 'upstash', 'cloudflare', 'datadog'
  resource_name         TEXT,  -- e.g., 'Supabase Pro', 'Vercel Pro'
  
  -- Capacity & Cost
  capacity_unit         TEXT,  -- 'GB', 'vCPU', 'requests/sec', 'connections', 'events/month'
  capacity_amount       DECIMAL(10,2),
  monthly_cost          DECIMAL(10,2) NOT NULL,
  
  -- Allocation (what % is actually used)
  allocated_percentage  DECIMAL(5,2) DEFAULT 0,  -- % of capacity currently allocated to users
  unallocated_percentage DECIMAL(5,2) GENERATED ALWAYS AS (100 - COALESCE(allocated_percentage, 0)) STORED,
  
  -- Status
  status                TEXT DEFAULT 'active'  -- 'active', 'reserved', 'deprecated'
  CHECK (status IN ('active', 'reserved', 'deprecated')),
  active_from           TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until           TIMESTAMPTZ,
  
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provisioned_resources_type ON provisioned_resources(resource_type);
CREATE INDEX IF NOT EXISTS idx_provisioned_resources_status ON provisioned_resources(status);
COMMENT ON TABLE provisioned_resources IS
  'Infrastructure baseline: DB, cache, CDN, monitoring costs provisioned monthly. '
  'Tracks allocated vs unallocated capacity. Unallocated = "System Overhead" in cost reports. '
  'Example: Supabase Pro costs $500/month, 65% allocated, 35% overhead.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. ACTIVITY_ERROR_LOG - All errors and connection failures
-- ──────────────────────────────────────────────────────────────────────────────
-- CRITICAL: Database changes even for errors/failures (cost doesn't disappear if API call fails)
-- Tracks failures to understand cost drivers that weren't successful
--
CREATE TABLE IF NOT EXISTS activity_error_log (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Link to activity that failed
  activity_log_id       UUID        REFERENCES activity_logs(id) ON DELETE CASCADE,
  campaign_id           UUID        REFERENCES campaigns(id) ON DELETE CASCADE,
  
  -- Error details
  error_type            TEXT        NOT NULL,  -- 'api_error', 'db_error', 'llm_error', 'network_timeout', 'rate_limit', 'auth_error', 'validation_error'
  error_code            TEXT,  -- HTTP status, SQL error code, API error code
  error_message         TEXT        NOT NULL,
  error_stack_trace     TEXT,
  
  -- Cost implications
  -- Important: Even failed API calls, LLM tokens used, DB read/writes costs money!
  llm_tokens_used       INTEGER DEFAULT 0,  -- Tokens charged even if request failed
  db_operations_count   INTEGER DEFAULT 0,  -- DB reads/writes even if failed
  api_calls_attempted   INTEGER DEFAULT 0,
  partial_cost          DECIMAL(10,6),  -- Cost already incurred before failure
  
  -- Failure context
  retry_count           INTEGER DEFAULT 0,  -- Number of retry attempts
  failure_reason        TEXT,  -- 'timeout', 'rate_limited', 'auth_failed', 'invalid_input', 'service_unavailable'
  
  -- Impact assessment
  impact_level          TEXT,  -- 'critical', 'high', 'medium', 'low'
  was_retried           BOOLEAN DEFAULT false,
  retry_successful      BOOLEAN,
  
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_activity_error_activity ON activity_error_log(activity_log_id);
CREATE INDEX IF NOT EXISTS idx_activity_error_campaign ON activity_error_log(campaign_id);
CREATE INDEX IF NOT EXISTS idx_activity_error_type ON activity_error_log(error_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_error_cost ON activity_error_log(partial_cost DESC);
COMMENT ON TABLE activity_error_log IS
  'Error tracking: Every connection failure, API error, timeout, rate limit. '
  'CRITICAL: Cost is incurred even on failures (partial_cost). '
  'Enables cost analysis of failed operations (wasted spend on retries, timeouts, rate limits). '
  'Helps identify cost optimization opportunities (e.g., reduce API call retries, cache more aggressive).';

-- ──────────────────────────────────────────────────────────────────────────────
-- Indexes and Views for Fast Cost Queries
-- ──────────────────────────────────────────────────────────────────────────────

-- View: Monthly cost summary by all companies
CREATE OR REPLACE VIEW v_monthly_cost_summary AS
SELECT
  DATE_TRUNC('month', al.created_at)::date AS month,
  al.company_id,
  SUM(am.total_resource_cost) AS total_cost,
  COUNT(DISTINCT al.id) AS activity_count,
  COUNT(DISTINCT CASE WHEN al.status = 'error' THEN al.id END) AS error_count,
  SUM(am.llm_tokens) AS total_tokens,
  SUM(am.supabase_reads) AS total_reads,
  SUM(am.supabase_writes) AS total_writes,
  SUM(am.api_calls) AS total_api_calls
FROM activity_logs al
LEFT JOIN activity_metrics am ON al.id = am.activity_log_id
WHERE al.company_id IS NOT NULL
GROUP BY 1, 2
ORDER BY month DESC, total_cost DESC;

-- View: Error costs (failures still cost money!)
CREATE OR REPLACE VIEW v_error_cost_analysis AS
SELECT
  me.month,
  me.error_type,
  me.error_count,
  me.total_cost_on_errors,
  me.avg_cost_per_error,
  ROUND(100.0 * me.total_cost_on_errors / 
    (SELECT SUM(COALESCE(partial_cost, 0)) FROM activity_error_log 
     WHERE DATE_TRUNC('month', created_at)::date = me.month), 2) AS pct_of_monthly_errors
FROM (
  SELECT
    DATE_TRUNC('month', created_at)::date AS month,
    error_type,
    COUNT(*) AS error_count,
    SUM(partial_cost) AS total_cost_on_errors,
    AVG(partial_cost) AS avg_cost_per_error
  FROM activity_error_log
  GROUP BY DATE_TRUNC('month', created_at)::date, error_type
) me
ORDER BY me.month DESC, me.total_cost_on_errors DESC;

-- View: Unallocated Infrastructure Cost
CREATE OR REPLACE VIEW v_infrastructure_overhead AS
SELECT
  resource_type,
  provider,
  monthly_cost,
  allocated_percentage,
  unallocated_percentage,
  ROUND(monthly_cost * unallocated_percentage / 100, 2) AS unallocated_cost,
  created_at
FROM provisioned_resources
WHERE status = 'active'
ORDER BY unallocated_cost DESC;
