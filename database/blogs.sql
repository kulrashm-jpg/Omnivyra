-- ─── BLOG PUBLISHING SYSTEM ──────────────────────────────────────────────────
-- Run AFTER company-integrations.sql

CREATE TABLE IF NOT EXISTS blogs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by     UUID        NOT NULL,
  title          TEXT        NOT NULL DEFAULT 'Untitled',
  content        TEXT        NOT NULL DEFAULT '',
  status         TEXT        NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft', 'published', 'failed')),
  -- null = hosted internally; set when published via external integration
  integration_id UUID        REFERENCES company_integrations(id) ON DELETE SET NULL,
  -- ID returned by external platform (e.g. WordPress post ID)
  external_id    TEXT,
  published_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS blogs_company_id_idx ON blogs(company_id);
CREATE INDEX IF NOT EXISTS blogs_status_idx     ON blogs(company_id, status);
CREATE INDEX IF NOT EXISTS blogs_created_at_idx ON blogs(created_at DESC);
