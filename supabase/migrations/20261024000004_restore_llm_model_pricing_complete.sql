-- ============================================================================
-- Forward reproducibility migration — complete llm_model_pricing rows for FRESH
-- reconstructions (INSERT-only)
--
-- WHY
--   The six model-pricing rows are seeded by 20260515_pricing_engine.sql, an
--   8-digit legacy migration that the repository's replay rule
--   (scripts/ci/real-schema-ci.sh: `[ "${#ver}" -eq 14 ] || continue`) skips.
--   baseline.sql is schema-only, so a fresh reconstruction (baseline.sql +
--   post-ledger replay) has ZERO llm_model_pricing rows, and every AI gateway
--   call fails closed with PricingMissingError before reaching a provider.
--   Production additionally carries per-model token limits (max_context_tokens /
--   max_output_tokens) that no migration sets; validateModelLimits enforces them.
--
-- SOURCE
--   Prices, kinds and notes: copied verbatim from 20260515_pricing_engine.sql.
--   Token limits: ELEVATED FROM PRODUCTION, observed 2026-09-12 (STEP 3AH-16,
--   SELECT-only). No tracked source sets these columns; the tracked value they
--   replace is NULL (column default). Public vendor model specifications, not
--   secrets.
--       openai/gpt-4o-mini          completion  128000 / 16000
--       openai/gpt-4o               completion  128000 / 16000
--       anthropic/claude-3-5-sonnet completion  200000 /  8192
--       openai/text-embedding-3-small, -3-large, ada-002  embedding  NULL / NULL
--   Every price, kind and note below equals the production row field-for-field
--   (STEP 3AH-16). id, effective_from and created_at take their column defaults,
--   exactly as the source statement left them; is_active defaults to true.
--
-- SEMANTICS — INSERT ONLY, NEVER REWRITES PRICING HISTORY
--   ON CONFLICT (provider, model_name, kind) WHERE is_active = true DO NOTHING
--   targets the partial unique index uq_llm_model_pricing_active: a row is
--   inserted only when no ACTIVE row exists for that (provider, model_name,
--   kind). An existing active row is never overwritten, deactivated or updated.
--
--   Environment                              Effect of this migration
--   ---------------------------------------  --------------------------------------
--   Fresh reconstruction (20260515 skipped)  inserts all 6 complete rows
--   Production (6 active rows, limits set)   inserts 0 rows (no-op)
--   Any environment where 20260515 already
--   ran, including local cert (6 active
--   rows, limits NULL)                       inserts 0 rows; limits stay NULL
--
--   KNOWN LIMITATION (by design): in an environment whose active rows predate
--   this migration and lack limits, INSERT-only semantics cannot add them —
--   pricing lookups read only active rows and uq_llm_model_pricing_active allows
--   one active row per key. Such an environment keeps NULL limits
--   (validateModelLimits then logs validate_model_limits_unconfigured and does
--   not enforce). Completing it requires a separately authorised change; this
--   migration deliberately does not UPDATE.
--
-- SAFETY
--   * One INSERT. No UPDATE, DELETE, TRUNCATE, DROP, ALTER, GRANT or DDL.
--   * Safe to run twice: the second run inserts zero rows.
--   * llm_model_pricing has no triggers and no FORCE ROW LEVEL SECURITY.
-- ============================================================================

INSERT INTO public.llm_model_pricing
  (provider, model_name, kind, input_per_1k_usd, output_per_1k_usd, notes, max_context_tokens, max_output_tokens)
VALUES
  ('openai',    'gpt-4o-mini',              'completion', 0.0003,    0.0006,  'seeded from code', 128000, 16000),
  ('openai',    'gpt-4o',                   'completion', 0.005,     0.015,   'seeded from code', 128000, 16000),
  ('anthropic', 'claude-3-5-sonnet',        'completion', 0.003,     0.015,   'seeded from code', 200000,  8192),
  ('openai',    'text-embedding-3-small',   'embedding',  0.00002,   0,       'seeded from code',   NULL,  NULL),
  ('openai',    'text-embedding-3-large',   'embedding',  0.00013,   0,       'seeded from code',   NULL,  NULL),
  ('openai',    'text-embedding-ada-002',   'embedding',  0.00010,   0,       'seeded from code',   NULL,  NULL)
ON CONFLICT (provider, model_name, kind) WHERE is_active = true DO NOTHING;
