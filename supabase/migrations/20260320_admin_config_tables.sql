-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3 — Admin Control System
-- Config tables that replace ALL hardcoded thresholds and rules.
-- Run on Supabase: psql or Dashboard SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Platform rules config (replaces hardcoded PLATFORM_RULES map)
CREATE TABLE IF NOT EXISTS platform_rules_config (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform      text NOT NULL,
  content_type  text NOT NULL DEFAULT 'post',
  rules         jsonb NOT NULL DEFAULT '{}',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, content_type)
);

-- Seed with current hardcoded defaults
INSERT INTO platform_rules_config (platform, content_type, rules) VALUES
  ('linkedin',  'post',      '{"max_sentences_per_paragraph":2,"prefer_sentence_per_line":false,"enforce_cta_at_end":true,"guidelines":["Strong opening hook line","Max 2 lines before spacing","Short paragraphs","CTA at end"]}'),
  ('instagram', 'post',      '{"max_sentences_per_paragraph":1,"prefer_sentence_per_line":false,"enforce_cta_at_end":true,"guidelines":["Hook in first 125 chars","Storytelling blocks","CTA near end"]}'),
  ('x',         'post',      '{"max_sentences_per_paragraph":1,"prefer_sentence_per_line":true,"enforce_cta_at_end":false,"guidelines":["Short punchy lines","Line breaks every thought"]}'),
  ('twitter',   'post',      '{"max_sentences_per_paragraph":1,"prefer_sentence_per_line":true,"enforce_cta_at_end":false,"guidelines":["Short punchy lines","Line breaks every thought"]}'),
  ('tiktok',    'post',      '{"max_sentences_per_paragraph":2,"prefer_sentence_per_line":true,"enforce_cta_at_end":true,"guidelines":["First 5 words must create curiosity","Pattern interrupt after hook","Direct low-friction CTA"]}'),
  ('facebook',  'post',      '{"max_sentences_per_paragraph":3,"prefer_sentence_per_line":false,"enforce_cta_at_end":true,"guidelines":["Warm friendly opening","Short conversational paragraphs","Engagement question at end"]}'),
  ('youtube',   'video',     '{"max_sentences_per_paragraph":2,"prefer_sentence_per_line":false,"enforce_cta_at_end":false,"guidelines":["Keyword-loaded first sentence","Structured description blocks","CTA in description"]}'),
  ('pinterest', 'image',     '{"max_sentences_per_paragraph":2,"prefer_sentence_per_line":false,"enforce_cta_at_end":false,"guidelines":["Lead with searchable keyword phrase","State outcome or benefit clearly"]}'),
  ('reddit',    'post',      '{"max_sentences_per_paragraph":3,"prefer_sentence_per_line":false,"enforce_cta_at_end":true,"guidelines":["Title specific and searchable","No corporate tone","Close with community question","No hashtags"]}')
ON CONFLICT (platform, content_type) DO NOTHING;

-- 2. Decision engine config (replaces hardcoded engagement thresholds)
CREATE TABLE IF NOT EXISTS decision_engine_config (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  min_engagement_threshold float NOT NULL DEFAULT 0.01,
  critical_drop_percent   float NOT NULL DEFAULT 0.40,
  ad_scale_threshold      float NOT NULL DEFAULT 0.05,
  ad_test_threshold       float NOT NULL DEFAULT 0.02,
  accuracy_good_threshold float NOT NULL DEFAULT 0.70,
  pause_condition_days    int   NOT NULL DEFAULT 2,
  at_risk_windows         int   NOT NULL DEFAULT 2,
  critical_runs_for_pause int   NOT NULL DEFAULT 2,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Single-row config (enforced by app layer)
INSERT INTO decision_engine_config DEFAULT VALUES
ON CONFLICT DO NOTHING;

-- 3. Content validation config (replaces hardcoded carousel/thread limits)
CREATE TABLE IF NOT EXISTS content_validation_config (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hook_min_score     float NOT NULL DEFAULT 0.30,
  carousel_max_words int   NOT NULL DEFAULT 15,
  thread_min_count   int   NOT NULL DEFAULT 5,
  thread_max_count   int   NOT NULL DEFAULT 7,
  tweet_char_limit   int   NOT NULL DEFAULT 280,
  hook_min_words     int   NOT NULL DEFAULT 4,
  hook_max_words     int   NOT NULL DEFAULT 20,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

INSERT INTO content_validation_config DEFAULT VALUES
ON CONFLICT DO NOTHING;

-- 4. Tone config (named tone rule sets for language refinement)
CREATE TABLE IF NOT EXISTS tone_config (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tone_name text NOT NULL UNIQUE,
  rules     jsonb NOT NULL DEFAULT '{}'
);

INSERT INTO tone_config (tone_name, rules) VALUES
  ('professional', '{"filler_words":["basically","literally","actually","just","very"],"sentence_style":"concise","punctuation":"formal"}'),
  ('conversational', '{"filler_words":["basically","literally"],"sentence_style":"casual","punctuation":"relaxed"}'),
  ('bold', '{"filler_words":["basically","literally","actually","just","very","somewhat","rather"],"sentence_style":"punchy","punctuation":"assertive"}')
ON CONFLICT (tone_name) DO NOTHING;

-- 5. Experiment config (A/B testing without deploy)
CREATE TABLE IF NOT EXISTS experiment_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_name text NOT NULL UNIQUE,
  variant_a       jsonb NOT NULL DEFAULT '{}',
  variant_b       jsonb NOT NULL DEFAULT '{}',
  traffic_split   float NOT NULL DEFAULT 0.50,
  active          boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 6. Config change audit log
CREATE TABLE IF NOT EXISTS config_change_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_type text NOT NULL,
  changed_by  text NOT NULL DEFAULT 'admin',
  before_json jsonb,
  after_json  jsonb NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_platform_rules_config_platform ON platform_rules_config(platform);
CREATE INDEX IF NOT EXISTS idx_experiment_config_active       ON experiment_config(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_config_change_logs_type        ON config_change_logs(config_type, created_at DESC);

-- RLS: admin-only write, service-role read (adjust to your policy model)
ALTER TABLE platform_rules_config     ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_engine_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_validation_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tone_config               ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_config         ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_change_logs        ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS — these tables are read by Railway backend only
-- Frontend admin panel writes via authenticated API routes (not direct DB)
