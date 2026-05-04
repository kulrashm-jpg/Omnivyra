-- Add admin_email_domain to companies for reliable same-domain user matching.
-- Populated when a company is created from the founding admin's email.
-- Indexed for fast lookup during onboarding.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS admin_email_domain TEXT;

CREATE INDEX IF NOT EXISTS idx_companies_admin_email_domain
  ON companies(admin_email_domain)
  WHERE admin_email_domain IS NOT NULL;
