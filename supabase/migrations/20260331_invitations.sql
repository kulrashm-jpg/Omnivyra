-- ─────────────────────────────────────────────────────────────────────────────
-- Invitation system
-- Replaces supabase.auth.admin.inviteUserByEmail() with a self-contained
-- token-based flow that works with Firebase-only auth.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invitations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who is being invited
  email            TEXT        NOT NULL,

  -- Which company they are being invited into
  company_id       UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Role to assign on acceptance
  role             TEXT        NOT NULL DEFAULT 'CONTENT_CREATOR'
    CHECK (role IN ('COMPANY_ADMIN','CONTENT_CREATOR','CONTENT_REVIEWER','CONTENT_PUBLISHER','VIEW_ONLY')),

  -- Opaque token sent in the invite link. SHA-256 hash stored here; the
  -- raw token is sent to the user and never persisted.
  token_hash       TEXT        NOT NULL UNIQUE,

  -- Who created the invite (NULL = created by super-admin without a user row)
  invited_by       UUID        REFERENCES users(id) ON DELETE SET NULL,
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),

  -- Acceptance tracking
  accepted_at      TIMESTAMPTZ,
  accepted_by      UUID        REFERENCES users(id),

  -- Soft-cancel by admin (does not delete the row for audit trail)
  revoked_at       TIMESTAMPTZ,
  revoked_by       UUID        REFERENCES users(id),

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent sending a second active invite to the same email + company
CREATE UNIQUE INDEX IF NOT EXISTS invitations_pending_unique
  ON invitations (email, company_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW();

-- Fast lookup by token hash (API accept flow)
CREATE INDEX IF NOT EXISTS invitations_token_hash_idx ON invitations (token_hash);

-- Fast lookup of all pending invites for a company (admin UI)
CREATE INDEX IF NOT EXISTS invitations_company_id_idx ON invitations (company_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE invitations IS
  'Single-use, expiring email invitations for adding users to a company. '
  'Token hash is SHA-256(raw_token). Raw token is emailed; hash is stored.';
