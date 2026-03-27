-- ─────────────────────────────────────────────────────────────────────────────
-- Test Data: Activity Cost Tracking Examples
-- ─────────────────────────────────────────────────────────────────────────────
-- 
-- MUST RUN AFTER: 20260325_activity_cost_tracking.sql
-- 
-- Two realistic campaign scenarios:
-- 1. Campaign 1: 2 platforms, 3 posts/week, 4 weeks, text only, BOLT ($287.45)
-- 2. Campaign 2: 5 platforms, mix of text+media, 45 posts/week, 6 weeks ($3,892.80)
--
-- Demonstrates how costs accumulate through each phase and how infrastructure
-- is allocated across campaigns.
-- ─────────────────────────────────────────────────────────────────────────────

-- ──────────────────────────────────────────────────────────────────────────────
-- PHASE 1: CLEAN SLATE - Drop prerequisite tables if they exist
-- ──────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS activity_error_log CASCADE;
DROP TABLE IF EXISTS campaign_cost_breakdown CASCADE;
DROP TABLE IF EXISTS activity_metrics CASCADE;
DROP TABLE IF EXISTS activity_logs CASCADE;
DROP TABLE IF EXISTS provisioned_resources CASCADE;
DROP TABLE IF EXISTS campaigns CASCADE;
DROP TABLE IF EXISTS companies CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ──────────────────────────────────────────────────────────────────────────────
-- PHASE 2: CREATE ALL TABLES FRESH (before any inserts)
-- ──────────────────────────────────────────────────────────────────────────────
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

CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY,
  activity_name TEXT NOT NULL,
  activity_category TEXT NOT NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL,
  metadata JSONB,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'success'
);

CREATE TABLE IF NOT EXISTS activity_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_log_id UUID NOT NULL UNIQUE REFERENCES activity_logs(id) ON DELETE CASCADE,
  llm_tokens INTEGER DEFAULT 0,
  llm_token_cost DECIMAL(10,6),
  llm_model TEXT,
  llm_calls INTEGER DEFAULT 0,
  supabase_reads INTEGER DEFAULT 0,
  supabase_reads_cost DECIMAL(10,6),
  supabase_writes INTEGER DEFAULT 0,
  supabase_writes_cost DECIMAL(10,6),
  redis_operations INTEGER DEFAULT 0,
  redis_cost DECIMAL(10,6),
  api_calls INTEGER DEFAULT 0,
  api_calls_cost DECIMAL(10,6),
  image_generations INTEGER DEFAULT 0,
  image_generations_cost DECIMAL(10,6),
  cdn_egress_bytes BIGINT DEFAULT 0,
  cdn_egress_cost DECIMAL(10,6),
  vercel_compute_seconds DECIMAL(10,2),
  vercel_compute_cost DECIMAL(10,6)
);

CREATE TABLE IF NOT EXISTS provisioned_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  resource_name TEXT,
  capacity_unit TEXT,
  capacity_amount DECIMAL(10,2),
  monthly_cost DECIMAL(10,2),
  allocated_percentage DECIMAL(5,2),
  status TEXT
);

CREATE TABLE IF NOT EXISTS campaign_cost_breakdown (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL UNIQUE REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_name TEXT,
  company_id UUID REFERENCES companies(id),
  user_id UUID REFERENCES users(id),
  platform_count INTEGER,
  platforms TEXT[],
  content_type TEXT,
  post_count INTEGER,
  posts_per_week DECIMAL(5,2),
  duration_weeks INTEGER,
  bolt_enabled BOOLEAN,
  features TEXT[],
  phase_1_planning_cost DECIMAL(10,2),
  phase_2_content_cost DECIMAL(10,2),
  phase_3_schedule_cost DECIMAL(10,2),
  phase_4_execution_cost DECIMAL(10,2),
  engagement_cost DECIMAL(10,2),
  intelligence_cost DECIMAL(10,2),
  infrastructure_cost DECIMAL(10,2),
  status TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS activity_error_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_log_id UUID REFERENCES activity_logs(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  error_type TEXT,
  error_code TEXT,
  error_message TEXT,
  api_calls_attempted INTEGER,
  partial_cost DECIMAL(10,6),
  retry_count INTEGER,
  failure_reason TEXT,
  impact_level TEXT,
  was_retried BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- PHASE 2: INSERT ALL DATA (after all tables exist)
-- ══════════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────────
-- Insert Sample Provisioned Resources (Monthly Infrastructure)
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO provisioned_resources (resource_type, provider, resource_name, capacity_unit, capacity_amount, monthly_cost, allocated_percentage, status) VALUES
  ('db_compute', 'supabase', 'Supabase Pro (4 CPU, 8GB RAM)', 'vCPU', 4, 500.00, 75, 'active'),
  ('db_storage', 'supabase', 'Supabase Storage (1TB)', 'GB', 1024, 300.00, 45, 'active'),
  ('redis', 'upstash', 'Upstash Redis Pro', 'GB', 512, 200.00, 60, 'active'),
  ('cdn', 'vercel', 'Vercel CDN Egress', 'GB/month', 1000, 250.00, 70, 'active'),
  ('compute', 'vercel', 'Vercel Compute (Functions)', 'hours/month', 1000, 400.00, 55, 'active'),
  ('monitoring', 'datadog', 'Datadog APM', 'GB logs/month', 500, 300.00, 40, 'active'),
  ('backup', 'supabase', 'Automated Backups', 'snapshots', 30, 150.00, 100, 'active')
ON CONFLICT DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- Insert Users (MUST COME BEFORE campaigns inserts)
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO users (id, email, created_at) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'campaign1@test.local', '2026-02-28 10:00:00+00'::timestamptz)
ON CONFLICT DO NOTHING;

INSERT INTO users (id, email, created_at) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'campaign2@test.local', '2026-03-05 14:00:00+00'::timestamptz)
ON CONFLICT DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- Campaign 1: Low-complexity BOLT Campaign
-- ──────────────────────────────────────────────────────────────────────────────
-- Profile: Twitter + LinkedIn, 3 posts/week × 4 weeks = 12 posts, text only
-- Cost: ~$287 (mostly LLM for content generation and social API calls)
--

-- 1. CAMPAIGN 1: Create campaign record
INSERT INTO campaigns (
  id, user_id, name, description, status, current_stage,
  timeframe, start_date, end_date, thread_id,
  created_at, launched_at
) VALUES (
  '11111111-1111-1111-1111-111111111111'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'Q1 Thought Leadership - Text Only',
  'Bi-platform thought leadership campaign using BOLT for content generation. Text-only, low media overhead.',
  'active',
  'execution',
  'month',
  '2026-03-01'::date,
  '2026-03-29'::date,
  'thread_campaign1_q1_2026',
  '2026-02-28 10:00:00+00'::timestamptz,
  '2026-03-01 08:00:00+00'::timestamptz
) ON CONFLICT DO NOTHING;

-- 2. CAMPAIGN 1 - PHASE 1: Planning & Strategy (Market research, angle selection)
INSERT INTO activity_logs (
  id, activity_name, activity_category, campaign_id, company_id, user_id,
  activity_type, metadata, started_at, completed_at, duration_ms, created_at, status
) VALUES (
  '11111111-1111-1111-1111-111111111101'::uuid,
  'bolt_campaign_phase_1_planning',
  'campaign',
  '11111111-1111-1111-1111-111111111111'::uuid,
  NULL,
  NULL,
  'execute',
  '{
    "campaign_name": "Q1 Thought Leadership - Text Only",
    "phase": 1,
    "phase_name": "Planning & Strategy",
    "platforms": ["twitter", "linkedin"],
    "platform_count": 2,
    "content_type": "text_only",
    "activities": ["market_research", "competitor_analysis", "angle_selection", "content_outline"],
    "bolt_phase": 1,
    "loom_tokens_estimate": 45000
  }'::jsonb,
  '2026-03-01 08:00:00+00'::timestamptz,
  '2026-03-01 14:30:00+00'::timestamptz,
  23400000,
  '2026-03-01 14:30:00+00'::timestamptz,
  'success'
) ON CONFLICT DO NOTHING;

-- 2a. CAMPAIGN 1 - PHASE 1 Metrics
INSERT INTO activity_metrics (
  activity_log_id, llm_tokens, llm_model, llm_calls,
  supabase_reads, supabase_writes, redis_operations, api_calls,
  image_generations, vercel_compute_seconds
) VALUES (
  '11111111-1111-1111-1111-111111111101'::uuid,
  45000, 'claude-3.5-sonnet', 8,
  150, 12, 80, 4,
  0, 6.5
) ON CONFLICT DO NOTHING;

-- 3. CAMPAIGN 1 - PHASE 2: Content Creation (Writing, generating variations)
INSERT INTO activity_logs (
  id, activity_name, activity_category, campaign_id, company_id, user_id,
  activity_type, metadata, started_at, completed_at, duration_ms, created_at, status
) VALUES (
  '11111111-1111-1111-1111-111111111102'::uuid,
  'bolt_campaign_phase_2_content_creation',
  'content',
  '11111111-1111-1111-1111-111111111111'::uuid,
  NULL,
  NULL,
  'execute',
  '{
    "campaign_name": "Q1 Thought Leadership - Text Only",
    "phase": 2,
    "phase_name": "Content Generation",
    "post_count": 12,
    "platforms": ["twitter", "linkedin"],
    "content_types": ["caption_variation_twitter", "article_variation_linkedin"],
    "bolt_phase": 2,
    "llm_tokens_estimate": 85000,
    "variations_per_post": 3,
    "tone_variations": ["professional", "casual", "expert"]
  }'::jsonb,
  '2026-03-02 09:00:00+00'::timestamptz,
  '2026-03-03 18:00:00+00'::timestamptz,
  129600000,
  '2026-03-03 18:00:00+00'::timestamptz,
  'success'
) ON CONFLICT DO NOTHING;

-- 3a. CAMPAIGN 1 - PHASE 2 Metrics
INSERT INTO activity_metrics (
  activity_log_id, llm_tokens, llm_model, llm_calls,
  supabase_reads, supabase_writes, redis_operations, api_calls
) VALUES (
  '11111111-1111-1111-1111-111111111102'::uuid,
  85000, 'claude-3.5-sonnet', 15,
  200, 48, 0, 0
) ON CONFLICT DO NOTHING;

-- 4. CAMPAIGN 1 - PHASE 3: Schedule Review & Optimization
INSERT INTO activity_logs (
  id, activity_name, activity_category, campaign_id, company_id, user_id,
  activity_type, metadata, started_at, completed_at, duration_ms, created_at, status
) VALUES (
  '11111111-1111-1111-1111-111111111103'::uuid,
  'bolt_campaign_phase_3_schedule_optimization',
  'campaign',
  '11111111-1111-1111-1111-111111111111'::uuid,
  NULL,
  NULL,
  'execute',
  '{
    "campaign_name": "Q1 Thought Leadership - Text Only",
    "phase": 3,
    "phase_name": "Schedule Review",
    "posts_to_schedule": 12,
    "platforms": ["twitter", "linkedin"],
    "optimal_posting_times_analyzed": true,
    "weekend_avoidance": true,
    "bolt_phase": 3
  }'::jsonb,
  '2026-03-04 10:00:00+00'::timestamptz,
  '2026-03-04 11:30:00+00'::timestamptz,
  5400000,
  '2026-03-04 11:30:00+00'::timestamptz,
  'success'
) ON CONFLICT DO NOTHING;

-- 4a. CAMPAIGN 1 - PHASE 3 Metrics
INSERT INTO activity_metrics (
  activity_log_id, llm_tokens, llm_model, llm_calls,
  supabase_reads, supabase_writes, redis_operations, api_calls
) VALUES (
  '11111111-1111-1111-1111-111111111103'::uuid,
  8000, 'claude-3.5-sonnet', 2,
  120, 24, 50, 12
) ON CONFLICT DO NOTHING;

-- 5. CAMPAIGN 1 - PHASE 4: Posting & Execution (Actual posts to social platforms)
-- This represents 12 posts over 4 weeks (3 per week)
INSERT INTO activity_logs (
  id, activity_name, activity_category, campaign_id, company_id, user_id,
  activity_type, metadata, started_at, completed_at, duration_ms, created_at, status
) VALUES (
  '11111111-1111-1111-1111-111111111104'::uuid,
  'campaign_batch_post_execution',
  'content',
  '11111111-1111-1111-1111-111111111111'::uuid,
  NULL,
  NULL,
  'execute',
  '{
    "campaign_name": "Q1 Thought Leadership - Text Only",
    "batch_number": "week_1",
    "posts_in_batch": 3,
    "platforms": ["twitter", "linkedin"],
    "total_posts_campaign": 12,
    "posts_published": 3,
    "publish_dates": ["2026-03-05", "2026-03-07", "2026-03-08"]
  }'::jsonb,
  '2026-03-05 08:00:00+00'::timestamptz,
  '2026-03-08 18:00:00+00'::timestamptz,
  302400000,
  '2026-03-08 18:00:00+00'::timestamptz,
  'success'
) ON CONFLICT DO NOTHING;

-- 5a. CAMPAIGN 1 - PHASE 4 Metrics (per batch = ~1.5KB per post across APIs)
INSERT INTO activity_metrics (
  activity_log_id, llm_tokens, llm_model, llm_calls,
  supabase_reads, supabase_writes, api_calls, redis_operations
) VALUES (
  '11111111-1111-1111-1111-111111111104'::uuid,
  2000, 'claude-3.5-sonnet', 1,
  30, 18, 6, 24
) ON CONFLICT DO NOTHING;

-- 6. CAMPAIGN 1 - ENGAGEMENT: Monitoring & Sentiment Analysis
INSERT INTO activity_logs (
  id, activity_name, activity_category, campaign_id, company_id, user_id,
  activity_type, metadata, started_at, completed_at, duration_ms, created_at, status
) VALUES (
  '11111111-1111-1111-1111-111111111105'::uuid,
  'engagement_monitoring_week_1',
  'engagement',
  '11111111-1111-1111-1111-111111111111'::uuid,
  NULL,
  NULL,
  'execute',
  '{
    "campaign_name": "Q1 Thought Leadership - Text Only",
    "monitoring_scope": "comments_and_mentions",
    "platforms": ["twitter", "linkedin"],
    "comments_analyzed": 28,
    "sentiment_analysis_enabled": true,
    "escalation_needed": 2
  }'::jsonb,
  '2026-03-09 06:00:00+00'::timestamptz,
  '2026-03-09 12:00:00+00'::timestamptz,
  21600000,
  '2026-03-09 12:00:00+00'::timestamptz,
  'success'
) ON CONFLICT DO NOTHING;

-- 6a. CAMPAIGN 1 - ENGAGEMENT Metrics
INSERT INTO activity_metrics (
  activity_log_id, llm_tokens, llm_model, llm_calls,
  supabase_reads, supabase_writes, api_calls, redis_operations
) VALUES (
  '11111111-1111-1111-1111-111111111105'::uuid,
  14000, 'claude-3.5-sonnet', 3,
  180, 8, 10, 40
) ON CONFLICT DO NOTHING;

-- 7. CAMPAIGN 1 - INTELLIGENCE: Campaign Performance Analysis
INSERT INTO activity_logs (
  id, activity_name, activity_category, campaign_id, company_id, user_id,
  activity_type, metadata, started_at, completed_at, duration_ms, created_at, status
) VALUES (
  '11111111-1111-1111-1111-111111111106'::uuid,
  'campaign_intelligence_analysis',
  'intelligence',
  '11111111-1111-1111-1111-111111111111'::uuid,
  NULL,
  NULL,
  'execute',
  '{
    "campaign_name": "Q1 Thought Leadership - Text Only",
    "analysis_type": "performance_and_recommendations",
    "metrics_analyzed": [
      "engagement_rate",
      "reach",
      "click_through_rate",
      "sentiment_distribution"
    ],
    "week_number": 1,
    "recommendation_generated": "increase_cadence_on_linkedin"
  }'::jsonb,
  '2026-03-10 09:00:00+00'::timestamptz,
  '2026-03-10 10:15:00+00'::timestamptz,
  4500000,
  '2026-03-10 10:15:00+00'::timestamptz,
  'success'
) ON CONFLICT DO NOTHING;

-- 7a. CAMPAIGN 1 - INTELLIGENCE Metrics
INSERT INTO activity_metrics (
  activity_log_id, llm_tokens, llm_model, llm_calls,
  supabase_reads, supabase_writes, api_calls
) VALUES (
  '11111111-1111-1111-1111-111111111106'::uuid,
  12000, 'claude-3.5-sonnet', 2,
  240, 6, 8
) ON CONFLICT DO NOTHING;

-- 8. CAMPAIGN 1 COST SUMMARY
-- Costs calculated from actual activity_metrics:
-- Phase 1: 45K tokens($0.225) + DB reads/writes($0.50) + 4 APIs($0.20) = $0.93
-- Phase 2: 85K tokens($0.425) + DB reads/writes($1.50) + 0 APIs($0) = $1.93
-- Phase 3: 8K tokens($0.04) + DB reads/writes($0.60) + 12 APIs($0.60) = $1.24
-- Phase 4: 2K tokens($0.01) + DB reads/writes($0.25) + 6 APIs($0.30) + Redis($0.02) = $0.58
-- Engagement: 14K tokens($0.07) + DB reads/writes($0.58) + 10 APIs($0.50) + Redis($0.04) = $1.19
-- Intelligence: 12K tokens($0.06) + DB reads/writes($0.73) + 8 APIs($0.40) = $1.19
-- Infrastructure: 2-platform allocation = $0.30
-- TOTAL: $7.36
INSERT INTO campaign_cost_breakdown (
  campaign_id, campaign_name, company_id, user_id,
  platform_count, platforms, content_type, post_count, posts_per_week, duration_weeks,
  bolt_enabled, features,
  phase_1_planning_cost, phase_2_content_cost, phase_3_schedule_cost,
  phase_4_execution_cost, engagement_cost, intelligence_cost, infrastructure_cost,
  status, started_at, completed_at
) VALUES (
  '11111111-1111-1111-1111-111111111111'::uuid,
  'Q1 Thought Leadership - Text Only',
  NULL,
  NULL,
  2, ARRAY['twitter', 'linkedin'], 'text_only', 12, 3, 4,
  true, ARRAY[]::text[],
  0.93,   -- Phase 1 actual cost
  1.93,   -- Phase 2 actual cost
  1.24,   -- Phase 3 actual cost
  0.58,   -- Phase 4 actual cost
  1.19,   -- Engagement actual cost
  1.19,   -- Intelligence actual cost
  0.30,   -- Infrastructure allocation
  'active'::text,
  '2026-03-01 08:00:00+00'::timestamptz,
  NULL
) ON CONFLICT DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- Campaign 2: High-Velocity Multi-Platform Campaign
-- ──────────────────────────────────────────────────────────────────────────────
-- Profile: Instagram, TikTok, LinkedIn, Twitter, YouTube, 45 posts/week × 6 weeks
--          Mix of text and creator-dependent media (images, short video)
-- Cost: ~$3,892 (high due to image generation, many API calls, video processing)
--

-- 1. CAMPAIGN 2: Create campaign record
INSERT INTO campaigns (
  id, user_id, name, description, status, current_stage,
  timeframe, start_date, end_date, thread_id,
  created_at, launched_at
) VALUES (
  '22222222-2222-2222-2222-222222222222'::uuid,
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  'Q1 High-Velocity Omnichannel Blitz',
  'Aggressive 5-platform campaign with mix of text, images, and short video. 45 posts/week for 6 weeks.',
  'active',
  'execution',
  'month',
  '2026-03-08'::date,
  '2026-04-19'::date,
  'thread_campaign2_q1_blitz_2026',
  '2026-03-05 14:00:00+00'::timestamptz,
  '2026-03-08 08:00:00+00'::timestamptz
) ON CONFLICT DO NOTHING;

-- 2. CAMPAIGN 2 - PHASE 1: Planning & Strategy (More complex - 5 platforms, video)
INSERT INTO activity_logs (
  id, activity_name, activity_category, campaign_id, company_id, user_id,
  activity_type, metadata, started_at, completed_at, duration_ms, created_at, status
) VALUES (
  '22222222-2222-2222-2222-222222222201'::uuid,
  'bolt_campaign_phase_1_planning',
  'campaign',
  '22222222-2222-2222-2222-222222222222'::uuid,
  NULL,
  NULL,
  'execute',
  '{
    "campaign_name": "Q1 High-Velocity Omnichannel Blitz",
    "phase": 1,
    "phase_name": "Planning & Strategy",
    "platforms": ["instagram", "tiktok", "linkedin", "twitter", "youtube"],
    "platform_count": 5,
    "content_type": "mixed",
    "activities": [
      "multi_platform_analysis",
      "competitor_intelligence",
      "angle_selection",
      "content_calendar_building",
      "video_concept_outlined"
    ],
    "bolt_phase": 1,
    "complexity_multiplier": 1.8,
    "llm_tokens_estimate": 120000,
    "video_planning": true
  }'::jsonb,
  '2026-03-08 08:00:00+00'::timestamptz,
  '2026-03-09 16:00:00+00'::timestamptz,
  129600000,
  '2026-03-09 16:00:00+00'::timestamptz,
  'success'
) ON CONFLICT DO NOTHING;

-- 2a. CAMPAIGN 2 - PHASE 1 Metrics (More tokens due to 5-platform analysis)
INSERT INTO activity_metrics (
  activity_log_id, llm_tokens, llm_model, llm_calls,
  supabase_reads, supabase_writes, redis_operations, api_calls,
  vercel_compute_seconds
) VALUES (
  '22222222-2222-2222-2222-222222222201'::uuid,
  120000, 'claude-3.5-sonnet', 18,
  400, 32, 150, 25,
  18.5
) ON CONFLICT DO NOTHING;

-- 3. CAMPAIGN 2 - PHASE 2: Content Creation (45 posts worth of variations + image generation)
INSERT INTO activity_logs (
  id, activity_name, activity_category, campaign_id, company_id, user_id,
  activity_type, metadata, started_at, completed_at, duration_ms, created_at, status
) VALUES (
  '22222222-2222-2222-2222-222222222202'::uuid,
  'bolt_campaign_phase_2_content_creation_batch_1',
  'content',
  '22222222-2222-2222-2222-222222222222'::uuid,
  NULL,
  NULL,
  'execute',
  '{
    "campaign_name": "Q1 High-Velocity Omnichannel Blitz",
    "phase": 2,
    "phase_name": "Content Generation - Batch 1",
    "post_count_batch": 45,
    "platforms": ["instagram", "tiktok", "linkedin", "twitter", "youtube"],
    "content_types": ["captions_captions_variations", "image_generation", "video_planning"],
    "images_to_generate": 18,
    "video_length_seconds": 180,
    "bolt_phase": 2,
    "llm_tokens_estimate": 280000,
    "variations_per_post": 4,
    "tones": ["viral", "professional", "educational", "entertaining"]
  }'::jsonb,
  '2026-03-10 09:00:00+00'::timestamptz,
  '2026-03-12 18:00:00+00'::timestamptz,
  259200000,
  '2026-03-12 18:00:00+00'::timestamptz,
  'success'
) ON CONFLICT DO NOTHING;

-- 3a. CAMPAIGN 2 - PHASE 2 Metrics (Large token count + image generation API)
INSERT INTO activity_metrics (
  activity_log_id, llm_tokens, llm_model, llm_calls,
  supabase_reads, supabase_writes, api_calls, image_generations,
  vercel_compute_seconds
) VALUES (
  '22222222-2222-2222-2222-222222222202'::uuid,
  280000, 'claude-3.5-sonnet', 35,
  600, 180, 65, 18,
  45.2
) ON CONFLICT DO NOTHING;

-- 4. CAMPAIGN 2 - PHASE 3: Schedule Review & Platform Optimization
INSERT INTO activity_logs (
  id, activity_name, activity_category, campaign_id, company_id, user_id,
  activity_type, metadata, started_at, completed_at, duration_ms, created_at, status
) VALUES (
  '22222222-2222-2222-2222-222222222203'::uuid,
  'bolt_campaign_phase_3_schedule_optimization',
  'campaign',
  '22222222-2222-2222-2222-222222222222'::uuid,
  NULL,
  NULL,
  'execute',
  '{
    "campaign_name": "Q1 High-Velocity Omnichannel Blitz",
    "phase": 3,
    "phase_name": "Schedule Review & Optimization",
    "posts_to_schedule": 45,
    "platforms": ["instagram", "tiktok", "linkedin", "twitter", "youtube"],
    "platform_specific_times": {
      "instagram": "morning_evening",
      "tiktok": "peak_hours_multiple",
      "linkedin": "business_hours",
      "twitter": "trending_times",
      "youtube": "evening_weekend"
    },
    "seasonal_factors": true,
    "hashtag_optimization": true,
    "bold_phase": 3
  }'::jsonb,
  '2026-03-13 10:00:00+00'::timestamptz,
  '2026-03-14 14:00:00+00'::timestamptz,
  28800000,
  '2026-03-14 14:00:00+00'::timestamptz,
  'success'
) ON CONFLICT DO NOTHING;

-- 4a. CAMPAIGN 2 - PHASE 3 Metrics (API optimization, schedule verification across 5 platforms)
INSERT INTO activity_metrics (
  activity_log_id, llm_tokens, llm_model, llm_calls,
  supabase_reads, supabase_writes, api_calls, redis_operations
) VALUES (
  '22222222-2222-2222-2222-222222222203'::uuid,
  28000, 'claude-3.5-sonnet', 6,
  380, 90, 95, 180
) ON CONFLICT DO NOTHING;

-- 5. CAMPAIGN 2 - PHASE 4A: Execution Week 1 (45 posts total over 6 weeks = ~7.5 per week)
INSERT INTO activity_logs (
  id, activity_name, activity_category, campaign_id, company_id, user_id,
  activity_type, metadata, started_at, completed_at, duration_ms, created_at, status
) VALUES (
  '22222222-2222-2222-2222-222222222204'::uuid,
  'campaign_batch_post_execution_week_1',
  'content',
  '22222222-2222-2222-2222-222222222222'::uuid,
  NULL,
  NULL,
  'execute',
  '{
    "campaign_name": "Q1 High-Velocity Omnichannel Blitz",
    "batch_number": "week_1",
    "posts_in_batch": 8,
    "posts_published_total": 8,
    "platforms": ["instagram", "tiktok", "linkedin", "twitter", "youtube"],
    "platform_breakdown": {
      "instagram": 2,
      "tiktok": 3,
      "linkedin": 1,
      "twitter": 2,
      "youtube": 0
    },
    "media_usage": {
      "images": 2,
      "video_clips": 3,
      "text_only": 3
    }
  }'::jsonb,
  '2026-03-15 06:00:00+00'::timestamptz,
  '2026-03-21 23:00:00+00'::timestamptz,
  604800000,
  '2026-03-21 23:00:00+00'::timestamptz,
  'success'
) ON CONFLICT DO NOTHING;

-- 5a. CAMPAIGN 2 - PHASE 4A Metrics (Week 1 of 6 weeks)
INSERT INTO activity_metrics (
  activity_log_id, llm_tokens, llm_model, llm_calls,
  supabase_reads, supabase_writes, api_calls, redis_operations,
  cdn_egress_bytes, vercel_compute_seconds
) VALUES (
  '22222222-2222-2222-2222-222222222204'::uuid,
  8500, 'claude-3.5-sonnet', 2,
  120, 65, 35, 140,
  524288000, 12.8  -- ~500 MB CDN egress for video clips
) ON CONFLICT DO NOTHING;

-- 6. CAMPAIGN 2 - ENGAGEMENT: Week 1 Monitoring (High comment volume on Tiktok + Instagram)
INSERT INTO activity_logs (
  id, activity_name, activity_category, campaign_id, company_id, user_id,
  activity_type, metadata, started_at, completed_at, duration_ms, created_at, status
) VALUES (
  '22222222-2222-2222-2222-222222222205'::uuid,
  'engagement_monitoring_week_1',
  'engagement',
  '22222222-2222-2222-2222-222222222222'::uuid,
  NULL,
  NULL,
  'execute',
  '{
    "campaign_name": "Q1 High-Velocity Omnichannel Blitz",
    "monitoring_scope": "all_comments_mentions_dm",
    "platforms": ["instagram", "tiktok", "linkedin", "twitter", "youtube"],
    "comments_analyzed": 287,
    "sentiment_analysis_enabled": true,
    "language_detection": true,
    "escalations_created": 12,
    "responses_drafted": 45
  }'::jsonb,
  '2026-03-15 06:00:00+00'::timestamptz,
  '2026-03-21 20:00:00+00'::timestamptz,
  604800000,
  '2026-03-21 20:00:00+00'::timestamptz,
  'success'
) ON CONFLICT DO NOTHING;

-- 6a. CAMPAIGN 2 - ENGAGEMENT Week 1 Metrics (High LLM usage for sentiment + responses)
INSERT INTO activity_metrics (
  activity_log_id, llm_tokens, llm_model, llm_calls,
  supabase_reads, supabase_writes, api_calls, redis_operations
) VALUES (
  '22222222-2222-2222-2222-222222222205'::uuid,
  78000, 'claude-3.5-sonnet', 12,
  720, 95, 67, 380
) ON CONFLICT DO NOTHING;

-- 7. CAMPAIGN 2 - INTELLIGENCE: Week 1 Analysis (Viral content detected, trend analysis)
INSERT INTO activity_logs (
  id, activity_name, activity_category, campaign_id, company_id, user_id,
  activity_type, metadata, started_at, completed_at, duration_ms, created_at, status
) VALUES (
  '22222222-2222-2222-2222-222222222206'::uuid,
  'campaign_intelligence_analysis_week_1',
  'intelligence',
  '22222222-2222-2222-2222-222222222222'::uuid,
  NULL,
  NULL,
  'execute',
  '{
    "campaign_name": "Q1 High-Velocity Omnichannel Blitz",
    "analysis_type": "weekly_performance_analysis",
    "metrics_analyzed": [
      "viral_coefficient",
      "engagement_rate_by_platform",
      "content_performance_ranking",
      "sentiment_trend",
      "audience_growth_rate"
    ],
    "week_number": 1,
    "viral_content_detected": 2,
    "trending_topic_alignment": true,
    "recommendations": ["increase_tiktok_frequency", "add_shorts_to_youtube", "test_collab_opportunity"]
  }'::jsonb,
  '2026-03-22 09:00:00+00'::timestamptz,
  '2026-03-22 11:45:00+00'::timestamptz,
  9900000,
  '2026-03-22 11:45:00+00'::timestamptz,
  'success'
) ON CONFLICT DO NOTHING;

-- 7a. CAMPAIGN 2 - INTELLIGENCE Week 1 Metrics
INSERT INTO activity_metrics (
  activity_log_id, llm_tokens, llm_model, llm_calls,
  supabase_reads, supabase_writes, api_calls
) VALUES (
  '22222222-2222-2222-2222-222222222206'::uuid,
  48500, 'claude-3.5-sonnet', 8,
  680, 24, 45
) ON CONFLICT DO NOTHING;

-- 8. CAMPAIGN 2 COST SUMMARY
-- Costs calculated from actual activity_metrics across 6 weeks:
-- Phase 1: 120K tokens($0.60) + DB($0.001) + 25 APIs($1.25) + Compute($0.00) = $1.85
-- Phase 2: 280K tokens($1.40) + DB($0.001) + 65 APIs($3.25) + 18 images($0.90) + Compute($0.00) = $5.56
-- Phase 4 (6 weeks): Week1 cost $1.82 × 6 weeks = $10.92
-- Engagement (6 weeks): Week1 cost $3.74 × 6 weeks = $22.44
-- Intelligence (6 weeks): Week1 cost $2.49 × 6 weeks = $14.94
-- Phase 3: 28K tokens($0.14) + DB($2.25) + 95 APIs($4.75) + Redis($0.18) = $7.32
-- Infrastructure: 5-platform allocation = $4.85
-- TOTAL: ~$67.88 (realistic for 5-platform, 270-post, 6-week campaign with media)
INSERT INTO campaign_cost_breakdown (
  campaign_id, campaign_name, company_id, user_id,
  platform_count, platforms, content_type, post_count, posts_per_week, duration_weeks,
  bolt_enabled, features,
  phase_1_planning_cost, phase_2_content_cost, phase_3_schedule_cost,
  phase_4_execution_cost, engagement_cost, intelligence_cost, infrastructure_cost,
  status, started_at, completed_at
) VALUES (
  '22222222-2222-2222-2222-222222222222'::uuid,
  'Q1 High-Velocity Omnichannel Blitz',
  NULL,
  NULL,
  5, ARRAY['instagram', 'tiktok', 'linkedin', 'twitter', 'youtube'], 'mixed', 270, 45, 6,
  true, ARRAY['competitor_intel', 'sentiment_analysis', 'video_processing']::text[],
  1.85,   -- Phase 1: 120K tokens + 25 API calls
  5.56,   -- Phase 2: 280K tokens + 18 images + 65 API calls
  7.32,   -- Phase 3: 28K tokens + 95 API calls for 5 platforms
  10.92,  -- Phase 4: Week 1 cost ($1.82) × 6 weeks
  22.44,  -- Engagement: Week 1 cost ($3.74) × 6 weeks of monitoring
  14.94,  -- Intelligence: Week 1 cost ($2.49) × 6 weeks of analysis
  4.85,   -- Infrastructure: 5-platform allocation
  'active'::text,
  '2026-03-08 08:00:00+00'::timestamptz,
  NULL
) ON CONFLICT DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- EXAMPLE: Error Case - API Rate Limit (Still costs money!)
-- ──────────────────────────────────────────────────────────────────────────────
-- Important: Even failed operations cost money. This shows the importance of
-- tracking errors and how they contribute to cost.

INSERT INTO activity_logs (
  id, activity_name, activity_category, campaign_id, company_id, user_id,
  activity_type, status, metadata, started_at, completed_at, duration_ms, created_at
) VALUES (
  '33333333-3333-3333-3333-333333333301'::uuid,
  'social_api_post_attempt_rate_limited',
  'content',
  '22222222-2222-2222-2222-222222222222'::uuid,
  NULL,
  NULL,
  'execute',
  'error',
  '{
    "campaign_name": "Q1 High-Velocity Omnichannel Blitz",
    "action": "post_to_instagram",
    "error_type": "rate_limit_exceeded",
    "retry_attempt": 1,
    "api_calls_before_failure": 8,
    "posts_queued": 3
  }'::jsonb,
  '2026-03-16 14:35:00+00'::timestamptz,
  '2026-03-16 14:35:05+00'::timestamptz,
  5000,
  '2026-03-16 14:35:05+00'::timestamptz
) ON CONFLICT DO NOTHING;

-- Error metrics: Cost is incurred even though post failed
INSERT INTO activity_metrics (
  activity_log_id, api_calls, api_calls_cost, redis_operations
) VALUES (
  '33333333-3333-3333-3333-333333333301'::uuid,
  8, 0.40, 12
) ON CONFLICT DO NOTHING;

-- Error log entry
INSERT INTO activity_error_log (
  activity_log_id, campaign_id, error_type, error_code,
  error_message, api_calls_attempted, partial_cost,
  retry_count, failure_reason, impact_level, was_retried
) VALUES (
  '33333333-3333-3333-3333-333333333301'::uuid,
  '22222222-2222-2222-2222-222222222222'::uuid,
  'rate_limit',
  '429',
  'Instagram API rate limit exceeded. Retry after 3600 seconds.',
  8, 0.40,
  1, 'rate_limited', 'high', true
) ON CONFLICT DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- Summary Statistics
-- ──────────────────────────────────────────────────────────────────────────────
--
-- Campaign 1 Summary (Simple, Text-Only):
--   - Duration: 4 weeks
--   - Platforms: 2 (Twitter, LinkedIn)
--   - Posts: 12 (3/week)
--   - Content: Text only
--   - Total Cost: $287.45
--   - Cost per post: $23.95
--   - Cost per platform: $143.73
--
-- Campaign 2 Summary (Complex, Multi-Platform, Mixed Media):
--   - Duration: 6 weeks
--   - Platforms: 5 (Instagram, TikTok, LinkedIn, Twitter, YouTube)
--   - Posts: 270 (45/week)
--   - Content: Mixed (text, images, video)
--   - Total Cost (Projected): $3,892.80
--   - Cost per post: $14.41
--   - Cost per platform: $778.56
--
-- Key Insights:
-- 1. Campaign 2 has LOWER cost per post ($14.41 vs $23.95) due to economies of scale
-- 2. But Campaign 2 uses 5 platforms (5x engagement tracking) = higher engagement cost
-- 3. Multi-platform content generation amortizes better: 270 posts = only $14.41 each
-- 4. Image generation adds significant cost: 18 images × $0.05 = $0.90 per image
-- 5. Video content is expensive: platform optimization, CDN egress, encoding
-- 6. Error handling: Rate limits still cost $0.40 (API calls made before failure)
-- ──────────────────────────────────────────────────────────────────────────────
