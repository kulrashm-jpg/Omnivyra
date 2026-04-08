-- Block Templates
-- Layout/structure templates for blog content with reusable block skeletons.
-- Company-scoped with system-provided defaults (is_default = true).

CREATE TABLE IF NOT EXISTS block_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id) ON DELETE CASCADE,
  created_by      UUID REFERENCES users(id),
  name            TEXT NOT NULL,
  description     TEXT,
  content_type    TEXT NOT NULL DEFAULT 'blog',
  format_type     TEXT,
  content_blocks  JSONB NOT NULL,
  thumbnail_url   TEXT,
  is_default      BOOLEAN DEFAULT false,
  is_public       BOOLEAN DEFAULT false,
  usage_count     INT DEFAULT 0,
  tags            TEXT[],
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_block_templates_company ON block_templates(company_id);
CREATE INDEX IF NOT EXISTS idx_block_templates_content_type ON block_templates(content_type);
CREATE INDEX IF NOT EXISTS idx_block_templates_default ON block_templates(is_default) WHERE is_default = true;
