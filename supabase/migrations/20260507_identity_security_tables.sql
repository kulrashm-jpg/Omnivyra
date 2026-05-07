-- ============================================================================
-- Identity-spine security tables (Wave 2A)
-- ============================================================================
-- Adds the canonical persistence model for the security architecture:
--   - auth_sessions          (DB-backed login sessions; revocable)
--   - trusted_devices        (server-issued device trust)
--   - webauthn_credentials   (passkey credentials per user)
--   - webauthn_challenges    (one-shot challenges, replay-safe)
--   - totp_factors           (TOTP secrets, encrypted via Supabase Vault)
--   - recovery_codes         (argon2-hashed; one-shot)
--   - stepup_sessions        (elevated-session tokens)
--   - capability_assignments (explicit capability grants per user/org)
--   - capability_audit_log   (immutable security audit trail)
--
-- Wave 2A rules:
--   - All secret material is referenced by Vault key id, never stored
--     plaintext in the DB.
--   - Every table has a soft-delete or revoke_at column where applicable.
--   - capability_audit_log is INSERT-ONLY; updates and deletes are denied.
--   - RLS is OFF (service-role-only access) — these tables are
--     security-critical and must NEVER be exposed via PostgREST anon.
--
-- Pre-conditions: pgcrypto + uuid-ossp + supabase_vault extensions must be
-- enabled (verified at migration apply time).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- ── 1. trusted_devices (created first so auth_sessions.device_id FK resolves) ─
-- A trusted device is established only by an explicit "remember this device"
-- step gated by a step-up authorization. Trust expires; can be revoked.
CREATE TABLE IF NOT EXISTS trusted_devices (
  id                 uuid        PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id            uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Stable device-fingerprint hash (server-computed; not PII).
  fingerprint        text        NOT NULL,
  label              text        NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz NULL,
  revocation_reason  text        NULL,
  CONSTRAINT trusted_devices_user_fingerprint_unique UNIQUE (user_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_active
  ON trusted_devices(user_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE trusted_devices IS
  'Server-issued trusted devices. Fingerprints are server-computed hashes; never trust client claims.';

-- ── 2. auth_sessions ────────────────────────────────────────────────────────
-- Server-authoritative login session. Browser holds a signed cookie carrying
-- the session id; all session state is read from this table.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id                 uuid        PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id            uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  supabase_uid       uuid        NOT NULL,
  -- Issued cookie value is signed(server_secret, id || created_at). The
  -- cookie itself is opaque to the client; it carries no claims.
  cookie_signature   text        NOT NULL,
  ip                 inet        NULL,
  user_agent         text        NULL,
  device_id          uuid        NULL REFERENCES trusted_devices(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz NULL,
  revocation_reason  text        NULL,
  CONSTRAINT auth_sessions_expires_after_created CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
  ON auth_sessions(user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_auth_sessions_supabase_uid
  ON auth_sessions(supabase_uid);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
  ON auth_sessions(expires_at) WHERE revoked_at IS NULL;

COMMENT ON TABLE auth_sessions IS
  'Server-authoritative login sessions. Cookie carries id only; state lives here. Revoke by setting revoked_at.';

-- ── 3. webauthn_credentials ─────────────────────────────────────────────────
-- One row per registered passkey/security key. counter must monotonically
-- increase per spec (replay protection); the server enforces this.
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id                  uuid        PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id             uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- credential_id is the WebAuthn credential ID (base64url-encoded).
  credential_id       text        NOT NULL,
  public_key          bytea       NOT NULL,        -- COSE public key bytes
  counter             bigint      NOT NULL DEFAULT 0,
  transports          text[]      NULL,            -- e.g. ['internal','hybrid','usb']
  attestation_format  text        NULL,            -- 'none' | 'packed' | 'fido-u2f' | ...
  authenticator_aaguid text       NULL,
  device_type         text        NULL,            -- 'singleDevice' | 'multiDevice'
  is_backed_up        boolean     NOT NULL DEFAULT false,
  label               text        NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_used_at        timestamptz NULL,
  revoked_at          timestamptz NULL,
  revocation_reason   text        NULL,
  CONSTRAINT webauthn_credentials_credential_id_unique UNIQUE (credential_id)
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_active
  ON webauthn_credentials(user_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE webauthn_credentials IS
  'Registered WebAuthn / passkey credentials. counter must be monotonic; server enforces.';

-- ── 4. webauthn_challenges ──────────────────────────────────────────────────
-- One-shot challenges issued for register/auth ceremonies. Consumed on
-- successful verification or expiry. Replay prevention.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id           uuid        PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id      uuid        NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge    text        NOT NULL,
  ceremony     text        NOT NULL CHECK (ceremony IN ('registration', 'authentication')),
  rp_id        text        NOT NULL,
  origin       text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz NULL,
  CONSTRAINT webauthn_challenges_expires_after_created CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_unconsumed
  ON webauthn_challenges(challenge) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_user_pending
  ON webauthn_challenges(user_id, ceremony) WHERE consumed_at IS NULL;

COMMENT ON TABLE webauthn_challenges IS
  'One-shot challenges. Consumed on success or expiry. Never reuse a challenge.';

-- ── 5. totp_factors ─────────────────────────────────────────────────────────
-- TOTP secret material is stored in Supabase Vault; this table holds the
-- vault key id (NOT the secret itself).
CREATE TABLE IF NOT EXISTS totp_factors (
  id                 uuid        PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id            uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Reference to vault.secrets row holding the encrypted TOTP secret.
  vault_secret_id    uuid        NOT NULL,
  label              text        NULL,
  algorithm          text        NOT NULL DEFAULT 'sha1' CHECK (algorithm IN ('sha1', 'sha256', 'sha512')),
  digits             smallint    NOT NULL DEFAULT 6 CHECK (digits IN (6, 8)),
  period_seconds     smallint    NOT NULL DEFAULT 30,
  created_at         timestamptz NOT NULL DEFAULT now(),
  verified_at        timestamptz NULL,
  last_used_at       timestamptz NULL,
  revoked_at         timestamptz NULL,
  revocation_reason  text        NULL
);

-- A user may have at most ONE active TOTP factor at a time. Switching factors
-- requires revoking the previous one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_totp_factors_user_active
  ON totp_factors(user_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE totp_factors IS
  'TOTP factors. Secret material stored in vault.secrets and referenced by vault_secret_id.';

-- ── 6. recovery_codes ───────────────────────────────────────────────────────
-- Per-user recovery codes hashed with argon2id. One-shot consumption.
CREATE TABLE IF NOT EXISTS recovery_codes (
  id          uuid        PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- argon2id-hashed code; never plaintext. Salt is included in argon2 output.
  code_hash   text        NOT NULL,
  -- Batch id groups codes generated together (e.g., the last regen run).
  batch_id    uuid        NOT NULL,
  used_at     timestamptz NULL,
  used_ip     inet        NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recovery_codes_user_unused
  ON recovery_codes(user_id, batch_id) WHERE used_at IS NULL;

COMMENT ON TABLE recovery_codes IS
  'argon2id-hashed recovery codes. One-shot. Issuing a new batch revokes the prior batch.';

-- ── 7. stepup_sessions ──────────────────────────────────────────────────────
-- Elevated-session token. Short-lived; bound to an auth_session.
CREATE TABLE IF NOT EXISTS stepup_sessions (
  id                 uuid        PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id            uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auth_session_id    uuid        NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  factor             text        NOT NULL CHECK (factor IN ('webauthn', 'totp', 'recovery_code')),
  -- Optional capability scope: when set, this elevation is valid only for the
  -- listed capability. NULL = elevated for all step-up-protected capabilities.
  scoped_capability  text        NULL,
  ip                 inet        NULL,
  user_agent         text        NULL,
  trusted_device_id  uuid        NULL REFERENCES trusted_devices(id) ON DELETE SET NULL,
  started_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  consumed_at        timestamptz NULL,             -- one-shot capabilities mark this
  revoked_at         timestamptz NULL,
  CONSTRAINT stepup_sessions_expires_after_started CHECK (expires_at > started_at)
);

CREATE INDEX IF NOT EXISTS idx_stepup_sessions_user_active
  ON stepup_sessions(user_id, auth_session_id)
  WHERE revoked_at IS NULL AND consumed_at IS NULL;

COMMENT ON TABLE stepup_sessions IS
  'Elevated-session tokens. Bound to an auth_session. May be capability-scoped or all-step-up.';

-- ── 8. capability_assignments ───────────────────────────────────────────────
-- Explicit capability grants. Most capabilities are derived from
-- user_company_roles via the role-to-capability mapping; this table holds
-- exception/override grants. Audited.
CREATE TABLE IF NOT EXISTS capability_assignments (
  id              uuid        PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid        NULL REFERENCES companies(id) ON DELETE CASCADE,
  capability      text        NOT NULL,
  granted_by      uuid        NULL REFERENCES users(id) ON DELETE SET NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NULL,
  revoked_at      timestamptz NULL,
  revocation_reason text      NULL,
  reason          text        NOT NULL,            -- audit-required justification at grant time
  CONSTRAINT capability_assignments_no_self_grant CHECK (granted_by IS DISTINCT FROM user_id)
);

CREATE INDEX IF NOT EXISTS idx_capability_assignments_user_active
  ON capability_assignments(user_id, capability)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_capability_assignments_unique_active
  ON capability_assignments(user_id, organization_id, capability)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE capability_assignments IS
  'Explicit capability grants. Override or augment role-derived capabilities. Audited.';

-- ── 9. capability_audit_log ─────────────────────────────────────────────────
-- INSERT-ONLY immutable audit trail for security decisions and elevated
-- actions. Keys are denormalized for retention safety.
CREATE TABLE IF NOT EXISTS capability_audit_log (
  id                   uuid        PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  occurred_at          timestamptz NOT NULL DEFAULT now(),
  -- Actor making the request (may differ from principal in admin-impersonation paths).
  actor_user_id        uuid        NULL,
  actor_session_id     uuid        NULL,
  -- Subject the decision applied to.
  principal_user_id    uuid        NULL,
  principal_supabase_uid uuid      NULL,
  -- Capability evaluated.
  capability           text        NOT NULL,
  organization_id      uuid        NULL,
  resource_id          text        NULL,
  -- 'allowed' | 'denied' | 'step_up_required' | 'session_revoked' | 'bridge_used'
  decision             text        NOT NULL,
  reason               text        NULL,
  -- MFA / step-up / device snapshot at decision time.
  mfa_factors          text[]      NULL,
  mfa_last_verified_at timestamptz NULL,
  mfa_phishing_resistant boolean   NULL,
  stepup_active        boolean     NULL,
  stepup_factor        text        NULL,
  device_trusted       boolean     NULL,
  -- Network attribution.
  ip                   inet        NULL,
  user_agent           text        NULL,
  -- Bridge-mode marker. True if decision was satisfied via legacy cookie super-admin path.
  via_legacy_bridge    boolean     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_capability_audit_log_principal_time
  ON capability_audit_log(principal_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_capability_audit_log_actor_time
  ON capability_audit_log(actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_capability_audit_log_capability_time
  ON capability_audit_log(capability, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_capability_audit_log_bridge
  ON capability_audit_log(occurred_at DESC) WHERE via_legacy_bridge = true;

COMMENT ON TABLE capability_audit_log IS
  'Immutable security audit log. INSERT-only. UPDATEs and DELETEs are denied via trigger.';

-- INSERT-only enforcement for capability_audit_log
CREATE OR REPLACE FUNCTION capability_audit_log_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'capability_audit_log is append-only; %s denied', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS capability_audit_log_no_update ON capability_audit_log;
CREATE TRIGGER capability_audit_log_no_update
  BEFORE UPDATE ON capability_audit_log
  FOR EACH ROW EXECUTE FUNCTION capability_audit_log_block_mutation();

DROP TRIGGER IF EXISTS capability_audit_log_no_delete ON capability_audit_log;
CREATE TRIGGER capability_audit_log_no_delete
  BEFORE DELETE ON capability_audit_log
  FOR EACH ROW EXECUTE FUNCTION capability_audit_log_block_mutation();

-- ── RLS: service-role-only access ───────────────────────────────────────────
-- These tables hold security-critical data. They must NEVER be exposed via
-- the anon key. We disable RLS only for the service role; PostgREST anon
-- access is forbidden by RLS being enabled with no permissive policies.

ALTER TABLE auth_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE trusted_devices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE webauthn_credentials   ENABLE ROW LEVEL SECURITY;
ALTER TABLE webauthn_challenges    ENABLE ROW LEVEL SECURITY;
ALTER TABLE totp_factors           ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_codes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE stepup_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_audit_log   ENABLE ROW LEVEL SECURITY;

-- No CREATE POLICY statements: tables are accessible only via the service role
-- (which bypasses RLS by default in Supabase). This matches the security
-- architecture: ALL access flows through backend services.
