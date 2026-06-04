-- =============================================================================
-- Phase 8A — ACTIVITY ECONOMY CATALOG (schema extension PROPOSAL)
--
-- Persists the activity-economy model that backend/services/activityEconomyCatalog.ts
-- already encodes in TypeScript: a small set of reusable ACTIVITY CLASSES, each
-- carrying entry consumption, a min/max credit band, and an abandonment timeout;
-- plus an activity_class pointer on the existing flat catalog so every
-- CreditAction inherits its economics from a class rather than re-defining them.
--
-- STATUS: INTENTIONALLY UNAPPLIED.
--   This file is the persistence PROPOSAL for a later, separately-approved phase.
--   During Phase 8A the TypeScript catalog is the runtime source of truth and is
--   read by NOTHING in any charging path. Do not db:push this in isolation
--   (prod migration ledger is hand-managed — see project memory).
--
-- SAFETY (when eventually applied):
--   * Purely additive. Creates one new table + one new NULLABLE column.
--   * No existing row is modified except a backfill of the new activity_class
--     column (which is otherwise NULL and read by nothing).
--   * Fully idempotent: IF NOT EXISTS + ON CONFLICT DO UPDATE, re-runnable.
--   * Changes NO billing behavior, enforcement, reconciliation, or HOLD/CONFIRM/
--     RELEASE logic — those read credit_cost_config.credits / action_pricing_config,
--     neither of which is altered here.
--
-- BACKWARD COMPATIBILITY:
--   * credit_cost_config.activity_class is nullable with no default; existing
--     readers (getCreditCost selects only `credits`) are unaffected.
--   * No FK is enforced from credit_cost_config -> activity_class_economics in
--     this proposal (kept as a soft pointer) so partial/forward catalogs never
--     block an insert. Enforcement can be added in a follow-up once backfill is
--     proven complete.
-- =============================================================================

-- 1. Class economics table -----------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_class_economics (
  activity_class              TEXT PRIMARY KEY,
  entry_consumption_credits   INTEGER NOT NULL,
  minimum_credits             INTEGER NOT NULL,
  maximum_credits             INTEGER NOT NULL,
  abandonment_timeout_seconds INTEGER NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Invariants mirrored in the TS catalog + unit tests.
  CONSTRAINT activity_class_economics_band_chk
    CHECK (entry_consumption_credits >= 0
           AND entry_consumption_credits <= minimum_credits
           AND minimum_credits <= maximum_credits),
  CONSTRAINT activity_class_economics_timeout_chk
    CHECK (abandonment_timeout_seconds >= 0)
);

COMMENT ON TABLE activity_class_economics IS
  'Phase 8A: per-class credit economics (entry consumption, min/max band, abandonment timeout). Source mirrored from backend/services/activityEconomyCatalog.ts. Inert until the economy is activated.';

-- 2. Seed the 10 classes (keep in lockstep with ACTIVITY_CLASS_ECONOMICS) -------
INSERT INTO activity_class_economics
  (activity_class, entry_consumption_credits, minimum_credits, maximum_credits, abandonment_timeout_seconds)
VALUES
  ('REPLY',              1,  1,  3,   300),
  ('SHORT_GENERATION',   2,  3,  15,  600),
  ('LONG_GENERATION',    10, 10, 60,  1800),
  ('DEEP_RESEARCH',      15, 20, 90,  3600),
  ('INTELLIGENCE_SCAN',  2,  2,  30,  1800),
  ('AUTOMATION',         20, 40, 120, 7200),
  ('IMAGE_GENERATION',   2,  2,  12,  900),
  ('VIDEO_GENERATION',   10, 20, 150, 3600),
  ('VOICE',              2,  5,  60,  1800),
  ('SYSTEM',             0,  0,  0,   60)
ON CONFLICT (activity_class) DO UPDATE SET
  entry_consumption_credits   = EXCLUDED.entry_consumption_credits,
  minimum_credits             = EXCLUDED.minimum_credits,
  maximum_credits             = EXCLUDED.maximum_credits,
  abandonment_timeout_seconds = EXCLUDED.abandonment_timeout_seconds,
  updated_at                  = now();

-- 3. Soft pointer on the existing flat catalog --------------------------------
ALTER TABLE credit_cost_config
  ADD COLUMN IF NOT EXISTS activity_class TEXT;

COMMENT ON COLUMN credit_cost_config.activity_class IS
  'Phase 8A: activity class this action inherits economics from (activity_class_economics). Nullable; read by nothing in a charging path yet.';

-- 4. Backfill activity_class per action_type (mirrors ACTIVITY_CLASS_MAP) -------
UPDATE credit_cost_config SET activity_class = 'REPLY' WHERE action_type IN (
  'ai_reply','auto_post','reply_generation','blog_brief_suggestions','content_suggestions',
  'chat_theme_refine','engagement_refine','campaign_chat','campaign_suggest_update',
  'campaign_suggest_duration','campaign_preplanning','recommendations_preview_strategy',
  'recommendations_group_preview'
);
UPDATE credit_cost_config SET activity_class = 'SHORT_GENERATION' WHERE action_type IN (
  'content_rewrite','content_basic','blog_rewrite_hook','content_repurpose',
  'quick_platform_adapt','creator_content','skeleton_command'
);
UPDATE credit_cost_config SET activity_class = 'LONG_GENERATION' WHERE action_type IN (
  'content_generation','blog_generation'
);
UPDATE credit_cost_config SET activity_class = 'DEEP_RESEARCH' WHERE action_type IN (
  'trend_analysis','market_insight_manual','website_audit','deep_analysis','full_strategy'
);
UPDATE credit_cost_config SET activity_class = 'INTELLIGENCE_SCAN' WHERE action_type IN (
  'prediction','insight_generation','pattern_detection','market_positioning','competitor_signals',
  'lead_detection','daily_insight_scan','campaign_optimization','optimization_loop',
  'portfolio_decision','strategy_evolution','recommendations_generate',
  'recommendations_opportunities','lead_qualification','lead_predictive_scoring'
);
UPDATE credit_cost_config SET activity_class = 'AUTOMATION' WHERE action_type IN (
  'campaign_creation','campaign_generation','async_campaign_planning'
);
UPDATE credit_cost_config SET activity_class = 'VOICE' WHERE action_type IN (
  'voice_per_minute'
);

-- IMAGE_GENERATION / VIDEO_GENERATION have no credit_cost_config members yet
-- (asset rendering is priced via creator/costProfiles.ts). SYSTEM keys
-- (embedding, external_api) live in action_pricing_config, not this table.
-- =============================================================================
