-- Company Integrations: Lead Capture + Blog Publishing
-- Scoped per company (not per user), reusable across modules.

CREATE TABLE IF NOT EXISTS company_integrations (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by    UUID        NOT NULL,                          -- user_id who created it
  type          TEXT        NOT NULL CHECK (type IN ('lead_webhook', 'wordpress', 'custom_blog_api')),
  name          TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('connected', 'failed', 'pending')),
  config        JSONB       NOT NULL DEFAULT '{}',             -- auth + endpoint fields (see below)
  last_tested_at TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast company-scoped lookups
CREATE INDEX IF NOT EXISTS idx_company_integrations_company_id
  ON company_integrations (company_id);

CREATE INDEX IF NOT EXISTS idx_company_integrations_type
  ON company_integrations (company_id, type);

-- config field shape by type:
--
-- lead_webhook:
--   { webhook_url: string, secret?: string }
--
-- wordpress:
--   { site_url: string, username: string, app_password: string }
--   (uses Application Passwords, not main account password)
--
-- custom_blog_api:
--   { endpoint_url: string, api_key: string, auth_header?: string }
--   (auth_header defaults to "Authorization: Bearer <api_key>")

-- Row-level security (optional — service role bypasses this)
ALTER TABLE company_integrations ENABLE ROW LEVEL SECURITY;
