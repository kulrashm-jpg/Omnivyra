-- ============================================================
-- api_provider_accounts
-- Multi-account support per external API provider.
-- Each external_api_sources row can have one or more accounts.
-- Phase 1: structure only. Switching logic comes later.
-- ============================================================

CREATE TABLE IF NOT EXISTS api_provider_accounts (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  api_source_id        UUID        NOT NULL REFERENCES external_api_sources(id) ON DELETE CASCADE,
  account_name         TEXT        NOT NULL,
  -- JSON object encrypted with AES-256-GCM (same key as oauth_client_*_encrypted).
  -- Shape: { "api_key_env_name"?: string, "api_key_value"?: string,
  --           "oauth_client_id"?: string, "oauth_client_secret"?: string }
  credentials_encrypted TEXT       NOT NULL DEFAULT '',
  rate_limit_per_min   INTEGER     NULL,
  rate_limit_per_day   INTEGER     NULL,
  current_usage_min    INTEGER     NOT NULL DEFAULT 0,
  current_usage_day    INTEGER     NOT NULL DEFAULT 0,
  last_reset_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  priority             INTEGER     NOT NULL DEFAULT 1,
  is_active            BOOLEAN     NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_accounts_api_source
  ON api_provider_accounts(api_source_id);

CREATE INDEX IF NOT EXISTS idx_provider_accounts_active_priority
  ON api_provider_accounts(api_source_id, is_active, priority);

-- ── is_whitelisted column on external_api_sources ────────────────────────────
-- Preparation for the "Others" category enforcement (not enforced yet).
ALTER TABLE external_api_sources
  ADD COLUMN IF NOT EXISTS is_whitelisted BOOLEAN NOT NULL DEFAULT false;

-- Existing preset APIs are auto-whitelisted.
UPDATE external_api_sources SET is_whitelisted = true WHERE is_preset = true;

-- ── account_id column on external_api_usage ──────────────────────────────────
-- Nullable so existing rows keep working with no backfill needed.
ALTER TABLE external_api_usage
  ADD COLUMN IF NOT EXISTS account_id UUID NULL REFERENCES api_provider_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ext_api_usage_account_id
  ON external_api_usage(account_id) WHERE account_id IS NOT NULL;

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Service-role only — tenants never touch this table directly.
ALTER TABLE api_provider_accounts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'api_provider_accounts'
      AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON api_provider_accounts
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END$$;
