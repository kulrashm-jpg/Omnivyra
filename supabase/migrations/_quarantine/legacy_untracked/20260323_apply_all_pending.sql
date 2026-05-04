-- LEGACY: Firebase migration field - do not use in new logic
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Consolidated migration: apply all pending auth + Firebase columns
-- Run this once in the Supabase SQL Editor.
-- All statements use IF NOT EXISTS / IF EXISTS guards so it is safe to re-run.
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- â”€â”€ 1. Core user columns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS name               TEXT,
  ADD COLUMN IF NOT EXISTS phone              TEXT,
  ADD COLUMN IF NOT EXISTS firebase_uid       TEXT,
  ADD COLUMN IF NOT EXISTS is_email_verified  BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_phone_verified  BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auth_level         TEXT        NOT NULL DEFAULT 'none'
    CHECK (auth_level IN ('none', 'email_verified', 'email_phone_verified')),
  ADD COLUMN IF NOT EXISTS user_type          TEXT
    CHECK (user_type IN ('trial', 'paid', 'enterprise', 'internal')),
  ADD COLUMN IF NOT EXISTS credits            INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sign_in_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_deleted         BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at         TIMESTAMPTZ;

-- â”€â”€ 2. Auto-generate UUID for id (needed when inserting without explicit id) â”€â”€
ALTER TABLE users
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- â”€â”€ 3. Relax NOT NULL on company_id and role (users exist before joining) â”€â”€â”€â”€â”€
ALTER TABLE users ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE users ALTER COLUMN role       DROP NOT NULL;

-- â”€â”€ 4. Drop FK to auth.users if it exists â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
DO $$
DECLARE
  _constraint TEXT;
BEGIN
  SELECT constraint_name INTO _constraint
  FROM information_schema.table_constraints
  WHERE table_name = 'users'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name LIKE '%auth%'
  LIMIT 1;
  IF _constraint IS NOT NULL THEN
    EXECUTE 'ALTER TABLE users DROP CONSTRAINT ' || quote_ident(_constraint);
  END IF;
END $$;

-- â”€â”€ 5. Fix role CHECK constraint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

-- â”€â”€ 6. Indexes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_uid_key
  ON users (firebase_uid)
  WHERE firebase_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_is_deleted
  ON users (is_deleted)
  WHERE is_deleted = true;

-- â”€â”€ 7. Invitations table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE TABLE IF NOT EXISTS invitations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email            TEXT        NOT NULL,
  company_id       UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role             TEXT        NOT NULL DEFAULT 'CONTENT_CREATOR'
    CHECK (role IN ('COMPANY_ADMIN','CONTENT_CREATOR','CONTENT_REVIEWER','CONTENT_PUBLISHER','VIEW_ONLY')),
  token_hash       TEXT        NOT NULL UNIQUE,
  -- invited_by is NULL when created by super-admin (no user row in that context)
  invited_by       UUID        REFERENCES users(id) ON DELETE SET NULL,
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at      TIMESTAMPTZ,
  accepted_by      UUID        REFERENCES users(id),
  revoked_at       TIMESTAMPTZ,
  revoked_by       UUID        REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS invitations_pending_unique
  ON invitations (email, company_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW();

CREATE INDEX IF NOT EXISTS invitations_token_hash_idx  ON invitations (token_hash);
CREATE INDEX IF NOT EXISTS invitations_company_id_idx  ON invitations (company_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- â”€â”€ 8. firebase_uid immutability trigger â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE OR REPLACE FUNCTION guard_firebase_uid_immutable()
  RETURNS TRIGGER LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.firebase_uid IS NOT NULL
     AND NEW.firebase_uid IS DISTINCT FROM OLD.firebase_uid
  THEN
    RAISE EXCEPTION
      'firebase_uid cannot be changed once set (user_id=%, existing=%, attempted=%)',
      OLD.id, OLD.firebase_uid, NEW.firebase_uid
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_firebase_uid_immutable ON users;
CREATE TRIGGER users_firebase_uid_immutable
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION guard_firebase_uid_immutable();

