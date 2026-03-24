-- ─────────────────────────────────────────────────────────────────────────────
-- Auth system migration: align users table with Firebase-only auth flow
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Changes:
--   0. Decouple users.id from auth.users (Firebase users have no Supabase auth row)
--   1. Add firebase_uid (unique) — primary identity from Firebase
--   2. Add auth columns: is_email_verified, is_phone_verified, auth_level
--   3. Add user_type and credits for onboarding completion
--   4. Add last_sign_in_at for suspicious-login detection
--   5. Drop NOT NULL on company_id (users exist before joining a company)
--   6. Drop NOT NULL on role (users exist before role assignment)
--   7. Fix 'SUPER_ADMINa' typo → 'SUPER_ADMIN' in role CHECK constraint
-- ─────────────────────────────────────────────────────────────────────────────

-- 0. Decouple users.id from Supabase auth.users ───────────────────────────────
-- Firebase-path users are never inserted into auth.users, so the FK reference
-- must be removed.  We also add a DEFAULT so the id is auto-generated when not
-- explicitly supplied (upsert via firebase_uid conflict target).
ALTER TABLE users
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Drop the FK constraint if it exists (constraint name may vary by project)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'users'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name LIKE '%auth%users%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE users DROP CONSTRAINT ' || constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'users'
        AND constraint_type = 'FOREIGN KEY'
        AND constraint_name LIKE '%auth%users%'
      LIMIT 1
    );
  END IF;
END $$;

-- 1. New identity + auth columns ──────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS firebase_uid       TEXT,
  ADD COLUMN IF NOT EXISTS is_email_verified  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_phone_verified  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auth_level         TEXT    NOT NULL DEFAULT 'none'
    CHECK (auth_level IN ('none', 'email_verified', 'email_phone_verified')),
  ADD COLUMN IF NOT EXISTS user_type          TEXT
    CHECK (user_type IN ('trial', 'paid', 'enterprise', 'internal')),
  ADD COLUMN IF NOT EXISTS credits            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sign_in_at    TIMESTAMPTZ;

-- Unique index on firebase_uid (partial — allows NULLs for legacy rows)
CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_uid_key
  ON users (firebase_uid)
  WHERE firebase_uid IS NOT NULL;

-- 2. Relax NOT NULL on company_id ─────────────────────────────────────────────
-- Users are created at email verification; they join a company in onboarding.
ALTER TABLE users ALTER COLUMN company_id DROP NOT NULL;

-- 3. Relax NOT NULL on role ───────────────────────────────────────────────────
ALTER TABLE users ALTER COLUMN role DROP NOT NULL;

-- 4. Fix SUPER_ADMINa typo ───────────────────────────────────────────────────
-- Drop the old constraint and recreate with the corrected value list.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IS NULL OR role IN (
    'SUPER_ADMIN',
    'COMPANY_ADMIN',
    'CONTENT_CREATOR',
    'CONTENT_REVIEWER',
    'CONTENT_PUBLISHER',
    'VIEW_ONLY'
  ));

-- 5. Index: fast lookup by firebase_uid ───────────────────────────────────────
-- (covered by unique index above — no additional index needed)

-- 6. Index: fast lookup by email ──────────────────────────────────────────────
-- email UNIQUE constraint already creates an implicit index; nothing to do.
