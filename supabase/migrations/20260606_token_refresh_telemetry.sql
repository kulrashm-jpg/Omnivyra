-- Token refresh telemetry columns.
--
-- Make refresh failures observable per-account instead of only in process logs.
-- Today, when a refresh fails, the only signal is a console.warn that
-- disappears on process restart. The verify-config endpoint and the admin UI
-- have no way to display *why* a token broke (invalid_grant vs invalid_client
-- vs network) so operators can't diagnose without log diving.
--
-- These columns are written by refreshTwitterTokenIfNeeded (and any future
-- refresh path that adopts them) on every attempt, so the most recent
-- outcome is always visible at the row.

ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS last_refresh_error TEXT,
  ADD COLUMN IF NOT EXISTS last_refresh_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refresh_status TEXT;
  -- refresh_status values: 'success' | 'failed' | 'requires_reconnect' | NULL (never attempted)

ALTER TABLE community_ai_platform_tokens
  ADD COLUMN IF NOT EXISTS last_refresh_error TEXT,
  ADD COLUMN IF NOT EXISTS last_refresh_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refresh_status TEXT;
