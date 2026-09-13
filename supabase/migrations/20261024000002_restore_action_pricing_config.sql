-- ============================================================================
-- Forward reproducibility migration — B2 action_pricing_config DATA
--
-- Restores the 31 active, global rows of public.action_pricing_config. The
-- canonical schema snapshot (supabase/_schema/baseline.sql) carries this table
-- as SCHEMA ONLY, and its only data sources are 14-digit versions at or below
-- the baseline ledger position (or missing from the tree), so a fresh
-- reconstruction (baseline.sql + post-ledger replay) otherwise leaves it EMPTY.
-- Without these rows pricingService.fetchActionPricingRow() throws, the usage
-- ledger refuses every LLM usage row (usage_ledger_rejected_missing_cost +
-- critical pricing_missing anomaly), and token-priced credit execution cannot
-- place its HOLD (creditExecutionServiceRuntimeCore estimateLlmHoldCredits).
--
-- PROVENANCE (evidence chain: STEP 3AH-9, STEP 3AH-15)
--   The two INSERT statements below are copied VERBATIM (byte-for-byte) from:
--     20260422072917_action_pricing_config_source_type_and_seed.sql   (30 rows)
--       git blob b082e50ce69a6615a51fa91629f8afbb79ddede6
--     20260422074957_content_generation_action_pricing.sql            (1 row)
--       git blob 6bf017f43e17eb2fc81324d7d091dd14670dce10
--   recovered from commit a8ed6893 ("Phase B0-E: database governance + replay
--   validation", 2026-05-04), reachable only from
--   refs/original/refs/heads/phase-e-replay-test and the tag
--   backup/phase-e-replay-test-before-scrub. Those files state they were
--   "Reconstructed by Phase B0 ... from supabase_migrations.schema_migrations
--   (applied via supabase db push)". They never reached main, and production's
--   current migration ledger no longer lists any 20260422* version (known
--   ledger desync).
--   Production verification (SELECT-only, 2026-09-12): all 31 production rows
--   equal these tuples field-for-field (action_key, source_type,
--   cost_multiplier, minimum_charge_usd, ceiling_usd, is_active, notes);
--   credit_cost is NULL on every row; 0 missing, 0 unexpected, 0 value diffs.
--
-- DELIBERATELY NOT CARRIED OVER FROM THE SOURCES
--   * Their schema DDL (ADD COLUMN source_type / minimum_charge_usd /
--     ceiling_usd, the source_type CHECK, the partial unique index, the NULL
--     backfill UPDATE and SET NOT NULL) is already represented in baseline.sql.
--   * The in-tree 20260422_cost_engine_v2.sql seed is NOT used: it predates
--     source_type (NOT NULL, no default) and its values (multiplier 1.0,
--     floor 0, no ceiling) do not match production.
--
-- SCHEMA ASSUMPTIONS (verified on production and in baseline.sql)
--   Columns: action_key text NOT NULL, source_type text NOT NULL
--   CHECK (llm|embedding|fixed), cost_multiplier numeric NOT NULL,
--   minimum_charge_usd numeric NOT NULL, ceiling_usd numeric, is_active
--   boolean NOT NULL, notes text. Conflict target: the partial unique index on
--   (action_key) WHERE is_active = true (action_pricing_config_active_uniq /
--   uq_action_pricing_config_active).
--
-- NOT COPIED (instance metadata, exactly as the sources left them)
--   id, credit_cost (NULL), effective_from, created_at and updated_at take their
--   column defaults. In production they equal the sources' apply date
--   (2026-04-22) and the 2026-05-16 updated_at column backfill. No source value
--   is transformed.
--
-- SAFETY
--   * INSERT only. No UPDATE, DELETE, TRUNCATE, DROP, GRANT or DDL.
--   * ON CONFLICT (action_key) WHERE is_active = true DO NOTHING: an existing
--     ACTIVE row for a key is never overwritten, so applying this to an
--     already-configured database (including production) changes nothing.
--   * Safe to run twice: the second run inserts zero rows.
--   * No secrets, credentials, tenant data or lead-credit rows (this table has
--     no lead_qualification / lead_predictive_scoring rows).
-- ============================================================================

-- ─── 1. Verbatim from 20260422072917_action_pricing_config_source_type_and_seed.sql (30 rows) ───
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

-- ─── 2. Verbatim from 20260422074957_content_generation_action_pricing.sql (1 row) ───
INSERT INTO public.action_pricing_config
  (action_key, source_type, cost_multiplier, minimum_charge_usd, ceiling_usd, is_active, notes)
VALUES
  ('content_generation', 'llm', 3.0, 0.05, 0.50, true,
   'Master content generation (activity workspace generate_master flow); floor 5 credits, ceiling 50 credits')
ON CONFLICT (action_key) WHERE is_active = true DO NOTHING;
