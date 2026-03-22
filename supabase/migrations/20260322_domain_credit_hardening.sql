-- Domain & Free Credit Hardening — Steps 1, 2, 4, 5
--
-- STEP 1: Enforce UNIQUE(companies.admin_email_domain) — one company per domain.
-- STEP 2: Partial UNIQUE on free_credit_claims(organization_id) WHERE category='initial'
--         — one initial grant per org at DB level.
-- STEP 4: free_credit_config table — configurable credit amounts and expiry.
-- STEP 5: Domain claim state fields on companies.

-- ── STEP 1: Add admin_email_domain if missing, then enforce UNIQUE ────────────

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS admin_email_domain TEXT NULL;

DROP INDEX IF EXISTS idx_companies_admin_email_domain;

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_admin_email_domain_unique
  ON companies(admin_email_domain)
  WHERE admin_email_domain IS NOT NULL;

-- ── STEP 2: One initial credit grant per organization ─────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_free_credit_claims_initial_per_org
  ON free_credit_claims(organization_id)
  WHERE category = 'initial' AND organization_id IS NOT NULL;

-- ── STEP 4: Configurable free credit amounts ──────────────────────────────────

CREATE TABLE IF NOT EXISTS free_credit_config (
  category     TEXT        PRIMARY KEY,
  credits      INTEGER     NOT NULL CHECK (credits > 0),
  expiry_days  INTEGER     NULL,                    -- NULL = no expiry
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed with current hardcoded values (INSERT ... ON CONFLICT = idempotent)
INSERT INTO free_credit_config (category, credits, expiry_days, is_active) VALUES
  ('initial',        300, 14,   true),
  ('invite_friend',  200, NULL, true),
  ('feedback',       100, NULL, true),
  ('setup',          100, NULL, true),
  ('connect_social', 150, NULL, true),
  ('first_campaign', 200, NULL, true)
ON CONFLICT (category) DO NOTHING;

-- ── STEP 5: Domain claim state fields ─────────────────────────────────────────

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS is_domain_verified BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS domain_claimed_at  TIMESTAMPTZ NULL;
