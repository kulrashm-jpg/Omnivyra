CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  contact_key TEXT NOT NULL,
  display_name TEXT NULL,
  profile_url TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contacts_org_platform_user_unique UNIQUE (organization_id, platform, platform_user_id),
  CONSTRAINT contacts_org_contact_key_unique UNIQUE (organization_id, contact_key)
);

CREATE INDEX IF NOT EXISTS idx_contacts_contact_key
  ON contacts (contact_key);

ALTER TABLE IF EXISTS lead_signals
  ADD COLUMN IF NOT EXISTS contact_id UUID NULL REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lead_signals_contact_id
  ON lead_signals (contact_id)
  WHERE contact_id IS NOT NULL;

ALTER TABLE IF EXISTS engagement_threads
  ADD COLUMN IF NOT EXISTS contact_id UUID NULL REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_engagement_threads_contact_id
  ON engagement_threads (contact_id)
  WHERE contact_id IS NOT NULL;

CREATE OR REPLACE FUNCTION trg_contacts_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_set_updated_at ON contacts;
CREATE TRIGGER contacts_set_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION trg_contacts_set_updated_at();
