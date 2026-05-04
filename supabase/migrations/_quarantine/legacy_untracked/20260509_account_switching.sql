-- ============================================================
-- Account Switching Support — Phase 2
-- Adds per-account health tracking and attempt-level usage metadata.
-- All columns nullable for full backward compatibility.
-- ============================================================

-- ── external_api_health: track which account wrote the last health record ─────
-- The existing UNIQUE(api_source_id) constraint is kept unchanged.
-- account_id is purely informational for Phase 2 (which account was last active).
ALTER TABLE external_api_health
  ADD COLUMN IF NOT EXISTS account_id UUID NULL REFERENCES api_provider_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ext_api_health_account_id
  ON external_api_health(account_id) WHERE account_id IS NOT NULL;

-- ── external_api_usage: attempt-level metadata ────────────────────────────────
-- Records which attempt number and outcome the most recent logExternalApiUsage
-- call carried.  Aggregated counts (request_count / success_count / failure_count)
-- are unchanged.
ALTER TABLE external_api_usage
  ADD COLUMN IF NOT EXISTS last_attempt_number INTEGER NULL,
  ADD COLUMN IF NOT EXISTS last_outcome         TEXT    NULL;
  -- outcome values: 'success' | 'rate_limited' | 'failed' | 'missing_env' | 'client_error' | 'skipped'
