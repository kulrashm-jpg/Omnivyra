-- ══════════════════════════════════════════════════════════════════════════════
-- Intelligence Orchestration Control Panel
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Global Config ──────────────────────────────────────────────────────────
-- One row per job_type. Applies to ALL companies unless a company override exists.

CREATE TABLE IF NOT EXISTS intelligence_global_config (
  job_type           TEXT        PRIMARY KEY,
  label              TEXT        NOT NULL,
  description        TEXT,

  -- Scheduling
  priority           SMALLINT    NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  frequency_minutes  INTEGER     NOT NULL DEFAULT 60 CHECK (frequency_minutes > 0),
  enabled            BOOLEAN     NOT NULL DEFAULT true,

  -- Execution
  max_concurrent     SMALLINT    NOT NULL DEFAULT 1 CHECK (max_concurrent >= 1),
  timeout_seconds    INTEGER     NOT NULL DEFAULT 300,
  retry_count        SMALLINT    NOT NULL DEFAULT 2,

  -- AI model override (null = use engine default)
  model              TEXT,

  -- Metadata
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         TEXT        NOT NULL DEFAULT 'system'
);

-- Seed all known intelligence job types
INSERT INTO intelligence_global_config
  (job_type, label, description, priority, frequency_minutes, enabled, max_concurrent, timeout_seconds, retry_count)
VALUES
  ('signal_clustering',      'Signal Clustering',         'Clusters recent unclustered signals into groups',                          4,  30,   true,  1, 120, 2),
  ('signal_intelligence',    'Signal Intelligence',       'Converts signal clusters into actionable intelligence',                    5,  60,   true,  1, 180, 2),
  ('strategic_themes',       'Strategic Themes',          'Converts intelligence into strategic theme cards',                         5,  60,   true,  1, 180, 2),
  ('campaign_opportunities', 'Campaign Opportunities',    'Converts strategic themes into campaign opportunities',                    6,  60,   true,  1, 180, 2),
  ('content_opportunities',  'Content Opportunities',     'Converts strategic themes into content opportunity suggestions',           6,  120,  true,  1, 240, 2),
  ('narrative_engine',       'Narrative Engine',          'Converts content opportunities into campaign narratives',                  7,  240,  true,  1, 300, 2),
  ('community_posts',        'Community Post Engine',     'Converts campaign narratives into platform-ready posts',                   7,  180,  true,  1, 300, 2),
  ('thread_engine',          'Thread Engine',             'Converts community posts into multi-part threads',                        7,  180,  true,  1, 240, 2),
  ('engagement_capture',     'Engagement Capture',        'Captures platform metrics into engagement_signals table',                  3,  30,   true,  2, 120, 3),
  ('engagement_polling',     'Engagement Polling',        'Polls external engagement sources at high frequency',                     3,  10,   true,  3,  60, 3),
  ('intelligence_polling',   'Intelligence Polling',      'Polls external intelligence APIs for signals',                            4,  120,  true,  2, 180, 2),
  ('feedback_intelligence',  'Feedback Intelligence',     'Analyses engagement data and generates strategic insights',               8,  360,  true,  1, 300, 1),
  ('trend_relevance',        'Trend Relevance',           'Scores theme relevance per company by industry + keywords',               8,  360,  true,  1, 300, 1),
  ('publish',                'Post Publisher',            'Publishes scheduled posts to social platforms via integrations',          2,   5,   true,  5,  60, 3),
  ('blog_generation',        'Blog Generation',           'AI-powered blog post generation from strategic theme',                    9,  1440, true,  1, 120, 1),
  ('hook_analysis',          'Hook Strength Analysis',    'Evaluates opening hook quality for AI-generated blog posts',              9,  1440, true,  1,  60, 1)
ON CONFLICT (job_type) DO NOTHING;

-- ── 2. Company Overrides ──────────────────────────────────────────────────────
-- Per-company overrides. Any non-null field supersedes the global default.
-- Resolution rule: company_override.field ?? global_config.field

CREATE TABLE IF NOT EXISTS intelligence_company_overrides (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         TEXT        NOT NULL,
  job_type           TEXT        NOT NULL REFERENCES intelligence_global_config(job_type) ON DELETE CASCADE,

  -- Nullable overrides — null means "use global"
  priority           SMALLINT    CHECK (priority BETWEEN 1 AND 10),
  frequency_minutes  INTEGER     CHECK (frequency_minutes > 0),
  enabled            BOOLEAN,
  max_concurrent     SMALLINT    CHECK (max_concurrent >= 1),
  timeout_seconds    INTEGER,
  retry_count        SMALLINT,
  model              TEXT,

  -- New-account boost fields
  boost_until        TIMESTAMPTZ,           -- if now() < boost_until → boost is active
  boost_priority     SMALLINT    CHECK (boost_priority BETWEEN 1 AND 10),
  boost_frequency_minutes INTEGER CHECK (boost_frequency_minutes > 0),

  -- Audit
  reason             TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         TEXT        NOT NULL DEFAULT 'system',

  UNIQUE (company_id, job_type)
);

CREATE INDEX IF NOT EXISTS ico_company_idx  ON intelligence_company_overrides (company_id);
CREATE INDEX IF NOT EXISTS ico_job_type_idx ON intelligence_company_overrides (job_type);
CREATE INDEX IF NOT EXISTS ico_boost_idx    ON intelligence_company_overrides (boost_until)
  WHERE boost_until IS NOT NULL;

-- ── 3. Execution log (lightweight — for the control panel live view) ──────────

CREATE TABLE IF NOT EXISTS intelligence_execution_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type    TEXT        NOT NULL,
  company_id  TEXT,                         -- null = global run
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  status      TEXT        NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','skipped')),
  result      JSONB,
  error       TEXT,
  triggered_by TEXT       NOT NULL DEFAULT 'scheduler'  -- 'scheduler' | 'manual' | 'boost'
);

CREATE INDEX IF NOT EXISTS iel_job_type_idx  ON intelligence_execution_log (job_type, started_at DESC);
CREATE INDEX IF NOT EXISTS iel_company_idx   ON intelligence_execution_log (company_id, started_at DESC)
  WHERE company_id IS NOT NULL;

-- Auto-cleanup: keep only last 7 days (call via pg_cron or periodic purge)
-- DELETE FROM intelligence_execution_log WHERE started_at < now() - interval '7 days';
