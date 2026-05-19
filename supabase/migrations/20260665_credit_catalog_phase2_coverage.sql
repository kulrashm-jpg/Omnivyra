-- =============================================================================
-- Phase 2 — Credit catalog coverage for previously-unbilled AI activities
--
-- Source of decision: CREDIT_COVERAGE_AUDIT.md §C.4 (+ Appendix G Task 3).
-- Adds one DISTINCT action_type per uncovered activity so the ledger's
-- reference_type attributes spend to the REAL activity (not a generic tier),
-- satisfying the "per-activity, how many credits" requirement.
--
-- SAFETY:
--   * Purely additive. No existing row is modified, no schema change.
--   * Idempotent: ON CONFLICT (action_type) DO UPDATE keeps it re-runnable.
--   * ZERO runtime behavior change until a route passes one of these keys
--     through executeWithCredits() (Phase 2 Task 4, shipped dark behind the
--     canary flag).
--   * Pricing reuses EXISTING tiers (no new pricing invented):
--       low/1  = ai_reply tier         low/3  = content_rewrite tier
--       low/5  = content_basic tier    medium/8 = insight_generation tier
--       heavy/60 = deep_analysis tier  heavy/50 = campaign_generation tier
--     blog_generation is ALSO token-priced via llm_model_pricing +
--     action_pricing_config; this flat value is only the resolver fallback.
--
-- NOT APPLIED by this change. Apply only via the controlled migration
-- process (prod migration ledger is intentionally not bulk-pushed).
-- =============================================================================

INSERT INTO credit_cost_config (action_type, credits, category, description, smart_dedup_seconds) VALUES
  -- Blog suite
  ('blog_generation',                60, 'heavy',  'Blog article generation (token-priced; flat = fallback)', 0),
  ('blog_rewrite_hook',               3,  'low',    'Blog hook rewrite',                                       0),
  ('blog_brief_suggestions',          1,  'low',    'Blog brief suggestions',                                  0),
  ('content_repurpose',               5,  'low',    'Repurpose content for another platform',                  0),
  -- Content assist
  ('content_suggestions',             3,  'low',    'AI content improvement suggestions',                      0),
  ('quick_platform_adapt',            3,  'low',    'Quick platform content adaptation',                       0),
  ('creator_content',                 5,  'low',    'Creator content generation',                              0),
  -- Interactive (PER TURN — see approved defaults)
  ('chat_theme_refine',               1,  'low',    'Strategic theme chat refinement (per turn)',              0),
  ('engagement_refine',               1,  'low',    'Engagement reply refinement (per turn)',                  0),
  ('campaign_chat',                   1,  'low',    'BOLT/campaign chat (per turn)',                           0),
  -- Campaign planner assists
  ('campaign_suggest_update',         1,  'low',    'Campaign plan update suggestion',                         0),
  ('campaign_suggest_duration',       1,  'low',    'Campaign duration suggestion',                            0),
  ('campaign_preplanning',            1,  'low',    'Pre-planning explanation',                                0),
  ('skeleton_command',                5,  'low',    'Campaign skeleton generation from command',               0),
  ('async_campaign_planning',         50, 'heavy',  'Async campaign planning (queue)',                         0),
  -- Recommendations / intelligence surface
  ('recommendations_generate',        8,  'medium', 'Recommendation generation',                               3600),
  ('recommendations_opportunities',   8,  'medium', 'Opportunity detection (value-gated)',                     3600),
  ('recommendations_preview_strategy',1,  'low',    'Recommendation strategy preview',                         0),
  ('recommendations_group_preview',   1,  'low',    'Recommendation group preview',                            0)
ON CONFLICT (action_type) DO UPDATE SET
  credits             = EXCLUDED.credits,
  category            = EXCLUDED.category,
  description         = EXCLUDED.description,
  smart_dedup_seconds = EXCLUDED.smart_dedup_seconds,
  updated_at          = NOW();
