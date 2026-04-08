-- ============================================================
-- LLM Provider Configuration
-- Super Admin controlled registry of LLM providers and models.
-- Does NOT affect existing execution logic — config layer only.
-- ============================================================

-- ── llm_providers ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS llm_providers (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT    NOT NULL UNIQUE,          -- e.g. "openai"
  display_name TEXT    NOT NULL,                 -- e.g. "OpenAI"
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── llm_models ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS llm_models (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  UUID    NOT NULL REFERENCES llm_providers(id) ON DELETE CASCADE,
  model_key    TEXT    NOT NULL,                 -- e.g. "gpt-4o-mini"
  display_name TEXT    NOT NULL,                 -- e.g. "GPT-4o Mini"
  is_active    BOOLEAN NOT NULL DEFAULT true,
  metadata     JSONB   NOT NULL DEFAULT '{}'::jsonb,  -- tokens, cost, context window, etc.
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, model_key)
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_llm_models_provider_id ON llm_models(provider_id);
CREATE INDEX IF NOT EXISTS idx_llm_providers_is_active ON llm_providers(is_active);
CREATE INDEX IF NOT EXISTS idx_llm_models_is_active    ON llm_models(is_active);

-- ── Seed: OpenAI provider ────────────────────────────────────
INSERT INTO llm_providers (name, display_name, is_active)
VALUES ('openai', 'OpenAI', true)
ON CONFLICT (name) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      updated_at   = now();

-- ── Seed: OpenAI models ──────────────────────────────────────
INSERT INTO llm_models (provider_id, model_key, display_name, is_active, metadata)
SELECT
  p.id,
  m.model_key,
  m.display_name,
  true,
  m.metadata::jsonb
FROM llm_providers p
CROSS JOIN (
  VALUES
    ('gpt-4o-mini', 'GPT-4o Mini',   '{"context_window": 128000, "input_cost_per_1k": 0.00015, "output_cost_per_1k": 0.0006}'),
    ('gpt-4o',      'GPT-4o',        '{"context_window": 128000, "input_cost_per_1k": 0.0025,  "output_cost_per_1k": 0.01}')
) AS m(model_key, display_name, metadata)
WHERE p.name = 'openai'
ON CONFLICT (provider_id, model_key) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      metadata     = EXCLUDED.metadata,
      updated_at   = now();
