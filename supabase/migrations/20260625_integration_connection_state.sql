-- Phase B — Canonical Connection State Model (additive only).
--
-- Purpose: add per-connection lifecycle state columns to the two surfaces
-- that hold per-tenant OAuth state (analytics_integrations, social_accounts)
-- and to the platform-wide meta connection (meta_oauth_connections). All
-- changes are ADDITIVE — no existing column is dropped, narrowed, or
-- repurposed. Existing readers see no schema break.
--
-- The state values follow the canonical 9-state enum defined in
-- backend/services/integrations/connectionState.ts. The column type is
-- text (not a Postgres enum) so future state additions don't require an
-- enum-alter migration; the enforced set lives in the service layer.
--
-- Rollback (additive => safe): drop the four columns added per table.
-- No data loss because the legacy `status` columns are untouched.

-- ── analytics_integrations ──────────────────────────────────────────────────
ALTER TABLE public.analytics_integrations
  ADD COLUMN IF NOT EXISTS connection_state         text,
  ADD COLUMN IF NOT EXISTS last_live_check_at       timestamptz,
  ADD COLUMN IF NOT EXISTS last_live_check_status   text,
  ADD COLUMN IF NOT EXISTS last_provider_error      text;

-- Backfill from the existing `status` enum so reads through the new column
-- aren't NULL on day zero. Map legacy values:
--   connected     -> CONNECTED
--   error         -> PROVIDER_REAUTH_REQUIRED
--   disconnected  -> DISCONNECTED
--   <anything else> -> CONFIGURED
UPDATE public.analytics_integrations
   SET connection_state = CASE
         WHEN status::text = 'connected'    THEN 'CONNECTED'
         WHEN status::text = 'error'        THEN 'PROVIDER_REAUTH_REQUIRED'
         WHEN status::text = 'disconnected' THEN 'DISCONNECTED'
         ELSE 'CONFIGURED'
       END
 WHERE connection_state IS NULL;

-- Index for the refresh scheduler. It scans for rows whose tokens are
-- about to expire OR whose state has decayed.
CREATE INDEX IF NOT EXISTS ix_analytics_integrations_connection_state
  ON public.analytics_integrations (connection_state);

-- ── social_accounts ─────────────────────────────────────────────────────────
ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS connection_state         text,
  ADD COLUMN IF NOT EXISTS last_live_check_at       timestamptz,
  ADD COLUMN IF NOT EXISTS last_live_check_status   text,
  ADD COLUMN IF NOT EXISTS last_provider_error      text;

-- Backfill: is_active drives CONNECTED vs DISCONNECTED at the start. The
-- scheduler will re-derive on its next tick based on token_expires_at and
-- the last_refresh_* telemetry that already exists.
UPDATE public.social_accounts
   SET connection_state = CASE
         WHEN is_active = false THEN 'DISCONNECTED'
         WHEN token_expires_at IS NOT NULL AND token_expires_at < now() THEN 'TOKEN_EXPIRED'
         ELSE 'CONNECTED'
       END
 WHERE connection_state IS NULL;

CREATE INDEX IF NOT EXISTS ix_social_accounts_connection_state
  ON public.social_accounts (connection_state);

-- Composite index the bulk refresher walks: "expiring in the next N minutes"
-- restricted to active connections.
CREATE INDEX IF NOT EXISTS ix_social_accounts_token_expires_at_active
  ON public.social_accounts (token_expires_at)
  WHERE is_active = true;

-- ── meta_oauth_connections ──────────────────────────────────────────────────
ALTER TABLE public.meta_oauth_connections
  ADD COLUMN IF NOT EXISTS connection_state         text,
  ADD COLUMN IF NOT EXISTS last_live_check_at       timestamptz,
  ADD COLUMN IF NOT EXISTS last_live_check_status   text;
-- meta_oauth_connections already has refresh_error / refresh_failed_at;
-- we do NOT duplicate them.

UPDATE public.meta_oauth_connections
   SET connection_state = CASE
         WHEN refresh_failed_at IS NOT NULL THEN 'PROVIDER_REAUTH_REQUIRED'
         WHEN token_expires_at < now()       THEN 'TOKEN_EXPIRED'
         ELSE 'CONNECTED'
       END
 WHERE connection_state IS NULL;

CREATE INDEX IF NOT EXISTS ix_meta_oauth_connections_connection_state
  ON public.meta_oauth_connections (connection_state);
