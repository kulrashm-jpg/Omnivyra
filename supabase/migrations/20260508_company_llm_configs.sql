-- ============================================================
-- Company LLM Configuration
-- Per-company selection of which LLM provider + model to use.
-- Supports BYOK (Bring Your Own Key): company can supply their
-- own encrypted API key, or use the platform default.
-- ============================================================

CREATE TABLE IF NOT EXISTS company_llm_configs (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID        NOT NULL UNIQUE,  -- one config per company
  provider_id          UUID        NOT NULL REFERENCES llm_providers(id) ON DELETE RESTRICT,
  model_id             UUID        NOT NULL REFERENCES llm_models(id) ON DELETE RESTRICT,
  -- BYOK: company's own API key (AES-256-GCM encrypted, same as credential store).
  -- NULL = use platform default key from env.
  api_key_encrypted    TEXT        NULL,
  -- Whether this company has activated LLM provider config (false = use platform default)
  is_active            BOOLEAN     NOT NULL DEFAULT true,
  -- Who last modified this config
  updated_by           UUID        NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_llm_configs_company_id  ON company_llm_configs(company_id);
CREATE INDEX IF NOT EXISTS idx_company_llm_configs_provider_id ON company_llm_configs(provider_id);
CREATE INDEX IF NOT EXISTS idx_company_llm_configs_model_id    ON company_llm_configs(model_id);
