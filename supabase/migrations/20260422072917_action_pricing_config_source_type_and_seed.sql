-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260422072917  Name: action_pricing_config_source_type_and_seed
-- Idempotency: GUARDED (ADD COLUMN IF NOT EXISTS, DO blocks for constraint, ON CONFLICT DO NOTHING).

-- ── Phase 1: extend action_pricing_config + seed every action with real margin.
--
-- Context
--   org credit_rate_usd = 0.01 USD/credit today → 1 credit = $0.01
--   minimum_charge_usd is anchored to existing fixed-credit pricing (credits × 0.01),
--   so short LLM calls still cost at least as much as today.
--   ceiling_usd caps a single call at 10× its current minimum (hard abuse brake).
--   cost_multiplier = 3.0 on LLM/embedding rows → 3× raw provider cost = real margin.
--   Fixed-price actions (auto_post, voice_per_minute) have min = ceiling = fixed charge.

ALTER TABLE public.action_pricing_config
  ADD COLUMN IF NOT EXISTS source_type        TEXT,
  ADD COLUMN IF NOT EXISTS minimum_charge_usd NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ceiling_usd        NUMERIC;

-- Enforce valid source_type values. 'llm' and 'embedding' are metered from
-- provider tokens; 'fixed' bypasses token math and charges minimum_charge_usd.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'action_pricing_config_source_type_check'
  ) THEN
    ALTER TABLE public.action_pricing_config
      ADD CONSTRAINT action_pricing_config_source_type_check
      CHECK (source_type IN ('llm', 'embedding', 'fixed'));
  END IF;
END $$;

-- ── Seed: 22 LLM actions + 1 embedding + 2 fixed + 5 utility keys
-- Idempotent: unique (action_key) WHERE is_active prevents dupes on re-run.
CREATE UNIQUE INDEX IF NOT EXISTS action_pricing_config_active_uniq
  ON public.action_pricing_config(action_key) WHERE is_active = true;

INSERT INTO public.action_pricing_config
  (action_key, source_type, cost_multiplier, minimum_charge_usd, ceiling_usd, is_active, notes)
VALUES
  -- ── LLM-metered actions ─ multiplier=3.0× raw tokens, min floors, ceiling caps
  ('ai_reply',               'llm',       3.0, 0.01, 0.10, true, 'LLM reply suggestion; floor 1 credit, ceiling 10'),
  ('reply_generation',       'llm',       3.0, 0.02, 0.20, true, 'Community reply; floor 2 credits, ceiling 20'),
  ('content_rewrite',        'llm',       3.0, 0.03, 0.30, true, 'Single-variant rewrite; floor 3 credits, ceiling 30'),
  ('content_basic',          'llm',       3.0, 0.05, 0.50, true, 'Basic content generation; floor 5 credits, ceiling 50'),
  ('insight_generation',     'llm',       3.0, 0.08, 0.80, true, 'Intelligence insight; floor 8 credits'),
  ('trend_analysis',         'llm',       3.0, 0.25, 2.50, true, 'Trend analysis; floor 25 credits'),
  ('market_insight_manual',  'llm',       3.0, 0.30, 3.00, true, 'Manual market insight; floor 30 credits'),
  ('campaign_creation',      'llm',       3.0, 0.40, 4.00, true, 'Campaign creation; floor 40 credits'),
  ('website_audit',          'llm',       3.0, 0.50, 5.00, true, 'Website audit; floor 50 credits'),
  ('prediction',             'llm',       3.0, 0.10, 1.50, true, 'Campaign outcome prediction; floor 10 credits'),
  ('pattern_detection',      'llm',       3.0, 0.12, 2.00, true, 'Pattern detection; floor 12 credits'),
  ('market_positioning',     'llm',       3.0, 0.10, 1.50, true, 'Market positioning; floor 10 credits'),
  ('competitor_signals',     'llm',       3.0, 0.08, 1.50, true, 'Competitor intelligence; floor 8 credits'),
  ('lead_detection',         'llm',       3.0, 0.15, 2.00, true, 'Lead signal detection; floor 15 credits'),
  ('daily_insight_scan',     'llm',       3.0, 0.20, 3.00, true, 'Daily insight scan; floor 20 credits'),
  ('campaign_optimization',  'llm',       3.0, 0.30, 4.00, true, 'Campaign optimisation; floor 30 credits'),
  ('optimization_loop',      'llm',       3.0, 0.15, 2.50, true, 'Live optimization iteration; floor 15 credits'),
  ('portfolio_decision',     'llm',       3.0, 0.20, 3.00, true, 'Portfolio rebalancing; floor 20 credits'),
  ('strategy_evolution',     'llm',       3.0, 0.15, 2.50, true, 'Strategy evolution; floor 15 credits'),
  ('deep_analysis',          'llm',       3.0, 0.60, 8.00, true, 'Deep multi-step analysis; floor 60 credits'),
  ('full_strategy',          'llm',       3.0, 0.80, 10.00, true, 'Full campaign strategy; floor 80 credits'),
  ('campaign_generation',    'llm',       3.0, 0.50, 7.00, true, 'Autonomous campaign generation; floor 50 credits'),

  -- ── Embedding — separate billing code (system-only today)
  ('embedding',              'embedding', 3.0, 0.0001, 0.10, true, 'Embedding generation; token-priced'),

  -- ── Fixed-price actions — no LLM tokens, minimum = ceiling = the fixed charge
  ('auto_post',              'fixed',     1.0, 0.02, 0.02, true, 'Social auto-post; flat 2 credits'),
  ('voice_per_minute',       'fixed',     1.0, 0.10, 0.10, true, 'Voice per minute; flat 10 credits'),

  -- ── Utility / catch-all keys referenced by PROCESS_TYPE_TO_ACTION_KEY in usageLedgerService
  ('system',                 'llm',       3.0, 0.005, 0.50, true, 'Internal/background LLM calls (e.g. sentiment_classification)'),
  ('external_api',           'fixed',     1.0, 0.005, 1.00, true, 'Metered external API call (GA4, platform adapters)'),
  ('profile_enrichment',     'llm',       3.0, 0.10, 1.50, true, 'Company profile enrichment; floor 10 credits'),
  ('profile_extraction',     'llm',       3.0, 0.10, 1.50, true, 'Company profile extraction; floor 10 credits'),
  ('blogAnalyticsInsight',   'llm',       3.0, 0.08, 1.00, true, 'Blog analytics insight; floor 8 credits')
ON CONFLICT (action_key) WHERE is_active = true DO NOTHING;

-- Backfill: if any existing rows have null source_type (pre-migration), infer
UPDATE public.action_pricing_config
SET source_type = 'llm'
WHERE source_type IS NULL;

ALTER TABLE public.action_pricing_config
  ALTER COLUMN source_type SET NOT NULL;
