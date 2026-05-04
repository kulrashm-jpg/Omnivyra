-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260422101355  Name: llm_model_pricing_context_limits
-- Idempotency: GUARDED on schema (ADD COLUMN IF NOT EXISTS); UPDATE seeds are no-ops on second apply.

-- Model hard limits — used by pricingService.validateModelLimits to reject
-- maxTokens inputs that exceed what the provider will accept. Prevents
-- billable pre-flight HOLDs from being placed for calls that will bounce
-- at the provider boundary.
ALTER TABLE public.llm_model_pricing
  ADD COLUMN IF NOT EXISTS max_context_tokens INT,
  ADD COLUMN IF NOT EXISTS max_output_tokens  INT;

-- Seed limits for active completion models.
UPDATE public.llm_model_pricing SET
  max_context_tokens = 128000,
  max_output_tokens  = 16000
WHERE provider = 'openai' AND model_name = 'gpt-4o-mini' AND kind = 'completion';

UPDATE public.llm_model_pricing SET
  max_context_tokens = 128000,
  max_output_tokens  = 16000
WHERE provider = 'openai' AND model_name = 'gpt-4o' AND kind = 'completion';

UPDATE public.llm_model_pricing SET
  max_context_tokens = 200000,
  max_output_tokens  = 8192
WHERE provider = 'anthropic' AND model_name = 'claude-3-5-sonnet' AND kind = 'completion';
