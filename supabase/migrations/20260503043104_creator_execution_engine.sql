-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260503043104  Name: creator_execution_engine
-- Idempotency: GUARDED.

ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS intent_type TEXT;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS asset_type TEXT;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS template_id TEXT;

CREATE TABLE IF NOT EXISTS creator_template_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  structure_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  style_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  mapping_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creator_template_registry_type ON creator_template_registry(type);
CREATE INDEX IF NOT EXISTS idx_creator_template_registry_company ON creator_template_registry(company_id);
CREATE INDEX IF NOT EXISTS idx_creator_template_registry_default ON creator_template_registry(is_default) WHERE is_default = true;
