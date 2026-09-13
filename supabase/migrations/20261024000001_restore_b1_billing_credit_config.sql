-- ============================================================================
-- Forward reproducibility migration — B1 billing / credit configuration DATA
--
-- Restores the resolved reference rows of eight configuration tables that the
-- canonical production snapshot (supabase/_schema/baseline.sql) carries as
-- SCHEMA ONLY. Their historical seed migrations are 8-digit legacy files, which
-- the repository's replay rule (scripts/ci/real-schema-ci.sh:
-- `[ "${#ver}" -eq 14 ] || continue`) skips — so a fresh reconstruction
-- (baseline.sql + post-ledger replay) otherwise leaves these tables EMPTY.
--
-- Evidence chain: STEP 3AH-2 (production content audit, SELECT-only, 2026-09-12),
-- STEP 3AH-3 (restoration decisions), STEP 3AH-4 (lead-credit provenance).
--
-- WHAT IS RESTORED (94 rows)
--   action_registry                     9   (20260411)
--   credit_cost_config                 43   (20260320 + 20260665; activity_class per 20260822)
--   credit_packages                     3   (20260723 — supersedes 20260721)
--   billing_fx_rates                    3   (20260723)
--   billing_plan_pricing                3   (20260723)
--   intelligence_global_config         16   (20260328)
--   free_credit_config                  8   (20260322 x2 + 20260602; 3 values elevated)
--   credit_action_approval_thresholds   9   (20260663)
--   Every row was verified field-for-field against production in STEP 3AH-2.
--
-- DELIBERATELY EXCLUDED — UNRESOLVED (STEP 3AH-4: INCONCLUSIVE)
--   credit_cost_config.lead_qualification
--   credit_cost_config.lead_predictive_scoring
--   Production (8 / 10 credits, dedup 21600) and the tracked migration 20260821
--   (2 / 3 credits, dedup 0) disagree and no evidence establishes which is the
--   intended policy. NEITHER version is restored here. Until a human decision
--   is recorded, getCreditCost() throws for these two keys on a fresh
--   reconstruction; leadJobProcessor treats lead billing as best-effort, so lead
--   jobs complete uncharged locally. Production's existing rows are unaffected.
--
-- NOT COPIED FROM PRODUCTION
--   Random ids, created_at / updated_at, updated_by, company_id and any other
--   instance-specific metadata take their column defaults (NULL / now() /
--   gen_random_uuid() / 'system'). The only literal ids are the three fixed
--   credit_packages ids, which are tracked constants referenced by
--   lib/billing/commercialPlans.ts and lib/billing/topupCatalog.ts.
--
-- ELEVATED VALUES
--   Where a value below contradicts its historical tracked source, it is marked
--   `ELEVATED FROM PRODUCTION, observed 2026-09-12 (STEP 3AH-2)`. That marker
--   records PROVENANCE ONLY; it does not assert historical intent.
--
-- SAFETY
--   * INSERT only. No UPDATE, DELETE, TRUNCATE, DROP, GRANT or DDL.
--   * Every INSERT is ON CONFLICT (<table's unique key>) DO NOTHING: an existing
--     row is NEVER overwritten, so applying this to an already-configured
--     database (including production) changes nothing that exists.
--   * Safe to run twice: the second run inserts zero rows.
--   * No secrets, connection strings, or environment-specific values.
--   * Never run the legacy seed files these values came from against a
--     configured database — several of them use ON CONFLICT DO UPDATE.
--
-- ORDERING NOTE
--   action_registry is FORCE ROW LEVEL SECURITY. It is inserted FIRST so that,
--   if the applying role can neither bypass RLS nor satisfy a policy, the
--   migration stops (ON_ERROR_STOP) before any other table is touched.
-- ============================================================================


-- ─── 1. action_registry (9) — exact tracked source 20260411 ─────────────────
-- Required by trigger trg_decision_objects_validate_action: an unregistered
-- action_type makes every decision_objects write raise.
-- company_id deliberately omitted (NULL), matching production.
INSERT INTO public.action_registry (action_type, handler_key, required_payload_fields, is_active)
VALUES
  ('fix_cta',           'CTAService.execute',         ARRAY['campaign_id']::text[],      TRUE),
  ('improve_content',   'ContentService.generate',    ARRAY[]::text[],                   TRUE),
  ('reallocate_budget', 'AdsService.adjust',          ARRAY['campaign_id']::text[],      TRUE),
  ('launch_campaign',   'CampaignService.launch',     ARRAY[]::text[],                   TRUE),
  ('fix_distribution',  'DistributionService.repair', ARRAY[]::text[],                   TRUE),
  ('capture_leads',     'LeadService.capture',        ARRAY['opportunity_type']::text[], TRUE),
  ('improve_tracking',  'TrackingService.audit',      ARRAY['campaign_id']::text[],      TRUE),
  ('adjust_strategy',   'StrategyService.adjust',     ARRAY['campaign_id']::text[],      TRUE),
  ('apply_learning',    'LearningService.apply',      ARRAY['campaign_id']::text[],      TRUE)
ON CONFLICT (action_type) DO NOTHING;


-- ─── 2. credit_cost_config (43) — exact tracked sources ─────────────────────
-- 24 rows from 20260320_credit_intelligence.sql + 19 rows from
-- 20260665_credit_catalog_phase2_coverage.sql = 43. activity_class values are
-- the final state of the 20260822_activity_economy_catalog.sql backfill.
-- (No FK: activity_class is a soft pointer.)
-- EXCLUDED (unresolved, STEP 3AH-4): lead_qualification, lead_predictive_scoring.
INSERT INTO public.credit_cost_config (action_type, credits, category, description, smart_dedup_seconds, activity_class)
VALUES
  -- 20260320_credit_intelligence.sql (24)
  ('ai_reply',                          1, 'low',    'AI reply suggestion',                                        0, 'REPLY'),
  ('auto_post',                         2, 'low',    'Social auto-post',                                           0, 'REPLY'),
  ('content_rewrite',                   3, 'low',    'Content rewrite',                                            0, 'SHORT_GENERATION'),
  ('content_basic',                     5, 'low',    'Basic content generation',                                   0, 'SHORT_GENERATION'),
  ('trend_analysis',                   25, 'medium', 'Trend analysis',                                          3600, 'DEEP_RESEARCH'),
  ('market_insight_manual',            30, 'medium', 'Market insight (manual)',                                    0, 'DEEP_RESEARCH'),
  ('campaign_creation',                40, 'medium', 'Campaign creation',                                          0, 'AUTOMATION'),
  ('website_audit',                    50, 'medium', 'Website audit',                                          86400, 'DEEP_RESEARCH'),
  ('lead_detection',                   15, 'high',   'Lead signal detection (value-gated)',                    21600, 'INTELLIGENCE_SCAN'),
  ('daily_insight_scan',               20, 'high',   'Daily insight scan (value-gated)',                       86400, 'INTELLIGENCE_SCAN'),
  ('campaign_optimization',            30, 'high',   'Campaign optimisation scan',                             43200, 'INTELLIGENCE_SCAN'),
  ('voice_per_minute',                 10, 'heavy',  'Voice interaction per minute',                               0, 'VOICE'),
  ('deep_analysis',                    60, 'heavy',  'Deep multi-step analysis',                                   0, 'DEEP_RESEARCH'),
  ('full_strategy',                    80, 'heavy',  'Full campaign strategy',                                     0, 'DEEP_RESEARCH'),
  ('campaign_generation',              50, 'heavy',  'Autonomous campaign generation',                             0, 'AUTOMATION'),
  ('prediction',                       10, 'medium', 'Campaign outcome prediction',                                0, 'INTELLIGENCE_SCAN'),
  ('optimization_loop',                15, 'high',   'Live optimization loop iteration',                           0, 'INTELLIGENCE_SCAN'),
  ('reply_generation',                  2, 'low',    'Community reply generation',                                 0, 'REPLY'),
  ('insight_generation',                8, 'medium', 'Intelligence insight generation',                         3600, 'INTELLIGENCE_SCAN'),
  ('pattern_detection',                12, 'medium', 'Pattern detection sweep',                                86400, 'INTELLIGENCE_SCAN'),
  ('market_positioning',               10, 'medium', 'Market positioning evaluation',                          86400, 'INTELLIGENCE_SCAN'),
  ('portfolio_decision',               20, 'high',   'Portfolio multi-campaign rebalancing',                   43200, 'INTELLIGENCE_SCAN'),
  ('strategy_evolution',               15, 'high',   'Strategy evolution computation',                         86400, 'INTELLIGENCE_SCAN'),
  ('competitor_signals',                8, 'medium', 'Competitor intelligence fetch',                          21600, 'INTELLIGENCE_SCAN'),
  -- 20260665_credit_catalog_phase2_coverage.sql (19)
  ('blog_generation',                  60, 'heavy',  'Blog article generation (token-priced; flat = fallback)',    0, 'LONG_GENERATION'),
  ('blog_rewrite_hook',                 3, 'low',    'Blog hook rewrite',                                          0, 'SHORT_GENERATION'),
  ('blog_brief_suggestions',            1, 'low',    'Blog brief suggestions',                                     0, 'REPLY'),
  ('content_repurpose',                 5, 'low',    'Repurpose content for another platform',                     0, 'SHORT_GENERATION'),
  ('content_suggestions',               3, 'low',    'AI content improvement suggestions',                         0, 'REPLY'),
  ('quick_platform_adapt',              3, 'low',    'Quick platform content adaptation',                          0, 'SHORT_GENERATION'),
  ('creator_content',                   5, 'low',    'Creator content generation',                                 0, 'SHORT_GENERATION'),
  ('chat_theme_refine',                 1, 'low',    'Strategic theme chat refinement (per turn)',                 0, 'REPLY'),
  ('engagement_refine',                 1, 'low',    'Engagement reply refinement (per turn)',                     0, 'REPLY'),
  ('campaign_chat',                     1, 'low',    'BOLT/campaign chat (per turn)',                              0, 'REPLY'),
  ('campaign_suggest_update',           1, 'low',    'Campaign plan update suggestion',                            0, 'REPLY'),
  ('campaign_suggest_duration',         1, 'low',    'Campaign duration suggestion',                               0, 'REPLY'),
  ('campaign_preplanning',              1, 'low',    'Pre-planning explanation',                                   0, 'REPLY'),
  ('skeleton_command',                  5, 'low',    'Campaign skeleton generation from command',                  0, 'SHORT_GENERATION'),
  ('async_campaign_planning',          50, 'heavy',  'Async campaign planning (queue)',                            0, 'AUTOMATION'),
  ('recommendations_generate',          8, 'medium', 'Recommendation generation',                               3600, 'INTELLIGENCE_SCAN'),
  ('recommendations_opportunities',     8, 'medium', 'Opportunity detection (value-gated)',                     3600, 'INTELLIGENCE_SCAN'),
  ('recommendations_preview_strategy',  1, 'low',    'Recommendation strategy preview',                            0, 'REPLY'),
  ('recommendations_group_preview',     1, 'low',    'Recommendation group preview',                               0, 'REPLY')
ON CONFLICT (action_type) DO NOTHING;


-- ─── 3. credit_packages (3) — exact tracked source 20260723 ─────────────────
-- 20260723 supersedes 20260721 (whose INR placeholders 2499/4599/8299 were
-- replaced by 2520/4620/8400 via ON CONFLICT DO UPDATE). Production matches
-- 20260723. The fixed ids are canonical tracked constants.
INSERT INTO public.credit_packages (id, name, credits, price, is_active, sku, canonical_usd_price)
VALUES
  ('0a0a0a25-0000-4000-8000-000000000250'::uuid, 'Top-up 250 credits',   250, 2520.00, TRUE, 'topup_250',   30.00),
  ('0a0a0500-0000-4000-8000-000000000500'::uuid, 'Top-up 500 credits',   500, 4620.00, TRUE, 'topup_500',   55.00),
  ('0a0a1000-0000-4000-8000-000000001000'::uuid, 'Top-up 1000 credits', 1000, 8400.00, TRUE, 'topup_1000', 100.00)
ON CONFLICT (id) DO NOTHING;


-- ─── 4. billing_fx_rates (3) — exact tracked source 20260723 ────────────────
-- updated_by deliberately omitted (NULL), matching production.
INSERT INTO public.billing_fx_rates (currency, rate)
VALUES
  ('USD',  1.000000),
  ('INR', 84.000000),
  ('EUR',  0.920000)
ON CONFLICT (currency) DO NOTHING;


-- ─── 5. billing_plan_pricing (3) — exact tracked source 20260723 ────────────
-- updated_by deliberately omitted (NULL), matching production.
INSERT INTO public.billing_plan_pricing (plan_key, founder_usd, regular_usd, active)
VALUES
  ('starter',   39.00, 100.00, TRUE),
  ('growth',    79.00, 200.00, TRUE),
  ('business', 159.00, 400.00, TRUE)
ON CONFLICT (plan_key) DO NOTHING;


-- ─── 6. intelligence_global_config (16) — exact tracked source 20260328 ─────
-- A missing row makes the scheduler skip that job. model (NULL) and
-- updated_by ('system') take their defaults, matching production.
INSERT INTO public.intelligence_global_config
  (job_type, label, description, priority, frequency_minutes, enabled, max_concurrent, timeout_seconds, retry_count)
VALUES
  ('signal_clustering',      'Signal Clustering',      'Clusters recent unclustered signals into groups',                 4,   30, TRUE, 1, 120, 2),
  ('signal_intelligence',    'Signal Intelligence',    'Converts signal clusters into actionable intelligence',           5,   60, TRUE, 1, 180, 2),
  ('strategic_themes',       'Strategic Themes',       'Converts intelligence into strategic theme cards',                5,   60, TRUE, 1, 180, 2),
  ('campaign_opportunities', 'Campaign Opportunities', 'Converts strategic themes into campaign opportunities',           6,   60, TRUE, 1, 180, 2),
  ('content_opportunities',  'Content Opportunities',  'Converts strategic themes into content opportunity suggestions',  6,  120, TRUE, 1, 240, 2),
  ('narrative_engine',       'Narrative Engine',       'Converts content opportunities into campaign narratives',         7,  240, TRUE, 1, 300, 2),
  ('community_posts',        'Community Post Engine',  'Converts campaign narratives into platform-ready posts',          7,  180, TRUE, 1, 300, 2),
  ('thread_engine',          'Thread Engine',          'Converts community posts into multi-part threads',               7,  180, TRUE, 1, 240, 2),
  ('engagement_capture',     'Engagement Capture',     'Captures platform metrics into engagement_signals table',         3,   30, TRUE, 2, 120, 3),
  ('engagement_polling',     'Engagement Polling',     'Polls external engagement sources at high frequency',            3,   10, TRUE, 3,  60, 3),
  ('intelligence_polling',   'Intelligence Polling',   'Polls external intelligence APIs for signals',                   4,  120, TRUE, 2, 180, 2),
  ('feedback_intelligence',  'Feedback Intelligence',  'Analyses engagement data and generates strategic insights',      8,  360, TRUE, 1, 300, 1),
  ('trend_relevance',        'Trend Relevance',        'Scores theme relevance per company by industry + keywords',      8,  360, TRUE, 1, 300, 1),
  ('publish',                'Post Publisher',         'Publishes scheduled posts to social platforms via integrations', 2,    5, TRUE, 5,  60, 3),
  ('blog_generation',        'Blog Generation',        'AI-powered blog post generation from strategic theme',           9, 1440, TRUE, 1, 120, 1),
  ('hook_analysis',          'Hook Strength Analysis', 'Evaluates opening hook quality for AI-generated blog posts',     9, 1440, TRUE, 1,  60, 1)
ON CONFLICT (job_type) DO NOTHING;


-- ─── 7. free_credit_config (8) — tracked sources + production-canonical drift ─
-- Tracked: 20260322_domain_credit_hardening.sql (6 rows),
--          20260322_expiry_category_guard.sql (incentive_expiry),
--          20260602_initial_free_credit_50.sql (initial_free_credit; and the
--          deactivation of the legacy 'initial' row, reproduced here as its
--          final state is_active = FALSE).
-- Canonical basis for 300 / 30 over the tracked 50 / 14 (STEP 3AH-3 decision B):
--   backend/services/initialFreeCreditService.ts:30-34 — "Canonical signup grant
--   per approved credit policy: 300 FREE credits, 30-day validity"
--   (commit 1a185bb8, 2026-06-25, "release approved FREE/PAID/INCENTIVE credit
--   model"; reaffirmed by 7e8a08d0 AUTH-001, 2026-07-13), and production holds
--   exactly 300 / 30. The 50 / 14 migration predates that policy release.
INSERT INTO public.free_credit_config (category, credits, expiry_days, is_active)
VALUES
  -- ELEVATED FROM PRODUCTION, observed 2026-09-12 (STEP 3AH-2):
  --   expiry_days 30 (tracked 20260322 source: 14). Legacy row, inactive.
  ('initial',             300,   30, FALSE),
  ('invite_friend',       200, NULL, TRUE),
  ('feedback',            100, NULL, TRUE),
  ('setup',               100, NULL, TRUE),
  ('connect_social',      150, NULL, TRUE),
  ('first_campaign',      200, NULL, TRUE),
  ('incentive_expiry',      0, NULL, FALSE),
  -- ELEVATED FROM PRODUCTION, observed 2026-09-12 (STEP 3AH-2):
  --   credits 300 (tracked 20260602 source: 50) and expiry_days 30 (tracked: 14).
  ('initial_free_credit', 300,   30, TRUE)
ON CONFLICT (category) DO NOTHING;


-- ─── 8. credit_action_approval_thresholds (9) — exact tracked source 20260663 ─
-- When empty, required_approvals_for_action() falls back to 1 approval,
-- silently weakening admin credit governance.
INSERT INTO public.credit_action_approval_thresholds (action_type, amount_threshold_credits, required_approvals, is_active)
VALUES
  ('admin_grant',           0, 1, TRUE),
  ('admin_grant',        5000, 2, TRUE),
  ('admin_grant',       50000, 3, TRUE),
  ('admin_adjust',          0, 1, TRUE),
  ('admin_adjust',       5000, 2, TRUE),
  ('admin_adjust',      50000, 3, TRUE),
  ('admin_refund',          0, 2, TRUE),
  ('admin_refund',      50000, 3, TRUE),
  ('admin_rate_change',     0, 2, TRUE)
ON CONFLICT (action_type, amount_threshold_credits) DO NOTHING;
