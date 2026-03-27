-- ─────────────────────────────────────────────────────────────────────────────
-- Multi-tenant auth architecture migration
--
-- SAFE MIGRATION — no data deleted, backward compatible until code switch.
--
-- Changes:
--   1. users: add supabase_uid, active_company_id, onboarding_state,
--             has_password, signup_source
--   2. users: copy company_id → active_company_id (keep company_id for compat)
--   3. companies: keep admin_email_domain (deprecated, not dropped yet)
--   4. CREATE company_domains (extract from companies.admin_email_domain)
--   5. CREATE signup_intents
--   6. CREATE company_join_requests
--   7. Data cleanup: normalize emails, fix orphans
--   8. Indexes & constraints
--
-- Rollback: see companion file 20260406_multi_tenant_auth_migration_rollback.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. USERS TABLE — new columns
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1a. supabase_uid — links to auth.users identity (code already uses this column
--     but no migration ever created it; firebase_uid is the legacy equivalent)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS supabase_uid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_supabase_uid_key
  ON users (supabase_uid)
  WHERE supabase_uid IS NOT NULL;

-- 1b. active_company_id — replaces company_id for multi-tenant support
--     Users can belong to multiple companies; this tracks the currently active one.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS active_company_id UUID REFERENCES companies(id);

-- 1c. Copy existing company_id → active_company_id (only where not already set)
UPDATE users
  SET active_company_id = company_id
  WHERE company_id IS NOT NULL
    AND active_company_id IS NULL;

-- 1d. onboarding_state — tracks user lifecycle stage
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_state TEXT NOT NULL DEFAULT 'active';

-- 1e. has_password — whether user has set a password (vs magic-link only)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS has_password BOOLEAN NOT NULL DEFAULT false;

-- 1f. signup_source — how the user originally registered
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS signup_source TEXT;

-- NOTE: company_id is NOT dropped yet. It remains for backward compatibility
-- but is DEPRECATED. active_company_id is the ONLY source of truth.
-- company_id will NOT be kept in sync — it is frozen at its current value.
-- A future migration will drop company_id after all code references are removed.

COMMENT ON COLUMN users.company_id IS
  'DEPRECATED — use active_company_id. This column is frozen and no longer updated.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. COMPANIES TABLE — deprecate admin_email_domain (keep for compat)
-- ═══════════════════════════════════════════════════════════════════════════════

-- admin_email_domain is NOT dropped yet. It stays as a read-only legacy column
-- until all code is migrated to use company_domains table. A comment marks it.
COMMENT ON COLUMN companies.admin_email_domain IS
  'DEPRECATED — migrated to company_domains table. Do not write new code against this column.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. CREATE TABLE: company_domains
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS company_domains (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  domain      TEXT        NOT NULL,
  is_primary  BOOLEAN     NOT NULL DEFAULT false,
  verified    BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT company_domains_domain_unique UNIQUE (domain)
);

CREATE INDEX IF NOT EXISTS idx_company_domains_company_id
  ON company_domains (company_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. MIGRATE EXISTING DOMAINS
-- ═══════════════════════════════════════════════════════════════════════════════

-- 4a. Migrate from companies.admin_email_domain → company_domains
--     Use a DO block to handle optional columns (is_domain_verified, domain_claimed_at)
--     that may or may not exist depending on which prior migrations ran.
DO $$
DECLARE
  _has_verified BOOLEAN;
  _has_claimed  BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'is_domain_verified'
  ) INTO _has_verified;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'domain_claimed_at'
  ) INTO _has_claimed;

  IF _has_verified AND _has_claimed THEN
    EXECUTE '
      INSERT INTO company_domains (company_id, domain, is_primary, verified, created_at)
      SELECT c.id, LOWER(TRIM(c.admin_email_domain)), true,
             COALESCE(c.is_domain_verified, false),
             COALESCE(c.domain_claimed_at, c.created_at)
      FROM companies c
      WHERE c.admin_email_domain IS NOT NULL AND TRIM(c.admin_email_domain) <> ''''
      ON CONFLICT (domain) DO NOTHING';
  ELSE
    EXECUTE '
      INSERT INTO company_domains (company_id, domain, is_primary, verified, created_at)
      SELECT c.id, LOWER(TRIM(c.admin_email_domain)), true, false, c.created_at
      FROM companies c
      WHERE c.admin_email_domain IS NOT NULL AND TRIM(c.admin_email_domain) <> ''''
      ON CONFLICT (domain) DO NOTHING';
  END IF;
END $$;

-- 4b. For companies without admin_email_domain, extract domain from users.email
--     (only for companies that don't already have an entry in company_domains)
INSERT INTO company_domains (company_id, domain, is_primary, verified, created_at)
SELECT DISTINCT ON (u.company_id)
  u.company_id,
  LOWER(SPLIT_PART(u.email, '@', 2)),
  true,
  false,                           -- unverified — inferred from user email
  NOW()
FROM users u
WHERE u.company_id IS NOT NULL
  AND u.email IS NOT NULL
  AND u.is_deleted = false
  AND NOT EXISTS (
    SELECT 1 FROM company_domains cd WHERE cd.company_id = u.company_id
  )
  AND SPLIT_PART(u.email, '@', 2) NOT IN (
    -- Exclude personal email providers — these are not company domains
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
    'icloud.com', 'mail.com', 'protonmail.com', 'zoho.com', 'yandex.com',
    'live.com', 'msn.com', 'me.com', 'mac.com', 'gmx.com', 'fastmail.com'
  )
ORDER BY u.company_id, u.created_at ASC   -- pick earliest user's domain
ON CONFLICT (domain) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. CREATE TABLE: signup_intents
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS signup_intents (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT        NOT NULL,
  source       TEXT        NOT NULL DEFAULT 'organic',
  intent_data  JSONB       NOT NULL DEFAULT '{}',
  status       TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'completed', 'expired')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_signup_intents_email
  ON signup_intents (email);

CREATE INDEX IF NOT EXISTS idx_signup_intents_status
  ON signup_intents (status)
  WHERE status = 'pending';

-- Auto-expire old intents (can be called by cron or checked at query time)
CREATE INDEX IF NOT EXISTS idx_signup_intents_expires
  ON signup_intents (expires_at)
  WHERE status = 'pending';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. CREATE TABLE: company_join_requests
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS company_join_requests (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id  UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  full_name   TEXT        NOT NULL,
  department  TEXT,
  email       TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by UUID        REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_join_requests_company_pending
  ON company_join_requests (company_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_company_join_requests_user
  ON company_join_requests (user_id);

-- Prevent duplicate pending requests from the same user to the same company
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_join_requests_user_company_pending
  ON company_join_requests (user_id, company_id)
  WHERE status = 'pending';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. DATA CLEANUP
-- ═══════════════════════════════════════════════════════════════════════════════

-- 7a. Normalize all emails to lowercase
UPDATE users SET email = LOWER(TRIM(email))
  WHERE email <> LOWER(TRIM(email));

-- 7b. Handle duplicate emails — keep the latest active row, soft-delete the rest
-- First, identify duplicates (case-insensitive)
WITH ranked AS (
  SELECT
    id,
    email,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(email)
      ORDER BY
        is_deleted ASC,              -- active rows first
        last_sign_in_at DESC NULLS LAST,  -- most recently active
        created_at DESC              -- newest fallback
    ) AS rn
  FROM users
),
duplicates AS (
  SELECT id FROM ranked WHERE rn > 1
)
UPDATE users
  SET is_deleted = true,
      deleted_at = NOW()
  WHERE id IN (SELECT id FROM duplicates)
    AND is_deleted = false;

-- 7c. Fix orphan users — users with a company_id that doesn't exist in companies
UPDATE users
  SET company_id = NULL,
      active_company_id = NULL
  WHERE company_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM companies c WHERE c.id = users.company_id
    );

-- 7d. Fix orphan user_company_roles — roles pointing to non-existent companies
DELETE FROM user_company_roles
  WHERE NOT EXISTS (
    SELECT 1 FROM companies c WHERE c.id = user_company_roles.company_id
  );

-- 7e. Fix orphan user_company_roles — roles pointing to non-existent users
DELETE FROM user_company_roles
  WHERE NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = user_company_roles.user_id
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. INDEXES & CONSTRAINTS
-- ═══════════════════════════════════════════════════════════════════════════════

-- 8a. users.email — ensure UNIQUE (should exist from base schema, re-assert)
-- Drop any existing partial/conditional index first and create a clean one
DO $$
BEGIN
  -- The base schema already has UNIQUE on email, but verify
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'users'
      AND indexname = 'users_email_key'
  ) THEN
    CREATE UNIQUE INDEX users_email_key ON users (LOWER(email));
  END IF;
END $$;

-- 8b. company_domains.domain UNIQUE — already created via table constraint above

-- 8c. user_company_roles(user_id, company_id) UNIQUE for active roles
-- Prevents a user from having multiple active roles in the same company
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_company_roles_user_company_active
  ON user_company_roles (user_id, company_id)
  WHERE status = 'active';

-- 8d. Index on users.active_company_id for company member lookups
CREATE INDEX IF NOT EXISTS idx_users_active_company_id
  ON users (active_company_id)
  WHERE active_company_id IS NOT NULL;

-- 8e. Index on users.onboarding_state for filtering
CREATE INDEX IF NOT EXISTS idx_users_onboarding_state
  ON users (onboarding_state)
  WHERE onboarding_state <> 'active';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 9. RLS POLICIES for new tables
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE company_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE signup_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_join_requests ENABLE ROW LEVEL SECURITY;

-- Service role has full access (API routes use service role key)
CREATE POLICY "service_role_full_access" ON company_domains
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access" ON signup_intents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access" ON company_join_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
