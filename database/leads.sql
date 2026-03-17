-- ─── LEAD CAPTURE SYSTEM ─────────────────────────────────────────────────────
-- Run AFTER company-integrations.sql (forms.integration_id references company_integrations)

-- Forms: SaaS-built lead capture forms with embeddable JS snippet
CREATE TABLE IF NOT EXISTS forms (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by     UUID        NOT NULL,
  name           TEXT        NOT NULL,
  fields         JSONB       NOT NULL DEFAULT '[]',
  -- optional: auto-forward captured leads to this lead_webhook integration
  integration_id UUID        REFERENCES company_integrations(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS forms_company_id_idx ON forms(company_id);

-- Leads: captured from SaaS forms, external webhooks, or manual entry
CREATE TABLE IF NOT EXISTS leads (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by     UUID,                             -- null for form/webhook submissions
  name           TEXT        NOT NULL,
  email          TEXT        NOT NULL,
  phone          TEXT,
  source         TEXT        NOT NULL DEFAULT 'direct',
  -- which integration delivered / received this lead
  integration_id UUID        REFERENCES company_integrations(id) ON DELETE SET NULL,
  -- which SaaS form captured this lead (null for webhook/manual)
  form_id        UUID        REFERENCES forms(id)  ON DELETE SET NULL,
  metadata       JSONB       NOT NULL DEFAULT '{}',
  is_test        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS leads_company_id_idx     ON leads(company_id);
CREATE INDEX IF NOT EXISTS leads_form_id_idx        ON leads(form_id);
CREATE INDEX IF NOT EXISTS leads_integration_id_idx ON leads(integration_id);
CREATE INDEX IF NOT EXISTS leads_created_at_idx     ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS leads_company_email_idx  ON leads(company_id, email);
