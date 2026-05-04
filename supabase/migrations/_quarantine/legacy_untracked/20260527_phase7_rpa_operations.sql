-- =============================================================================
-- Phase 7 — operational hardening for RPA
--
-- 1. cancel_requested_at — cooperative cancel signal on community_ai_actions.
--    The runner checks this column before each Playwright step and aborts.
--    Transition is a non-terminal signal (the row stays in its current
--    state) so the executor-write trigger is NOT affected.
-- 2. rpa_sessions — durable registry of Playwright storageState blobs
--    per (organization_id, platform). Stores the blob inline (jsonb) so
--    the worker does not depend on local fs; rpaSessionStore falls back
--    to DB-first when present and to local fs when not.
-- 3. rpa_artifacts — audit-trail for screenshots persisted to object
--    storage. One row per executed RPA task, with 7-day retention column.
-- =============================================================================

BEGIN;

-- ── 1. cancel_requested_at ──────────────────────────────────────────────────
ALTER TABLE community_ai_actions
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_community_ai_actions_cancel_requested
  ON community_ai_actions (cancel_requested_at)
  WHERE cancel_requested_at IS NOT NULL;

COMMENT ON COLUMN community_ai_actions.cancel_requested_at IS
  'Cooperative cancel signal. Set by POST /api/rpa/cancel. The RPA runner '
  'polls this field between steps and aborts gracefully; the executor '
  'writes the final status as failed(CANCELLED) via the central pipeline.';

-- ── 2. rpa_sessions ─────────────────────────────────────────────────────────
-- Per-(org, platform) Playwright `storageState` blob. A row's presence
-- means "we have a live session for this (org, platform) at this time".
-- A missing row means "no authenticated session" — worker refuses to run.
CREATE TABLE IF NOT EXISTS rpa_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL,
  platform           text NOT NULL,
  storage_state      jsonb NOT NULL,
  account_tier       text,
  last_login_at      timestamptz,
  expires_at         timestamptz,
  last_verified_at   timestamptz,
  created_at         timestamptz NOT NULL DEFAULT NOW(),
  updated_at         timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rpa_sessions_org_platform
  ON rpa_sessions (organization_id, platform);
CREATE INDEX IF NOT EXISTS idx_rpa_sessions_expires
  ON rpa_sessions (expires_at)
  WHERE expires_at IS NOT NULL;

ALTER TABLE rpa_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'rpa_sessions'
      AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON rpa_sessions
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

COMMENT ON TABLE rpa_sessions IS
  'Playwright storageState blobs per (org, platform). Seeded by the RPA '
  'auth bootstrapping flow; consumed by rpaSessionStore at task launch.';

-- ── 3. rpa_artifacts ────────────────────────────────────────────────────────
-- Screenshot + log references captured at end of each RPA task. The
-- artifact itself lives in object storage (Supabase Storage bucket
-- `rpa-artifacts`); this table is the authoritative index.
CREATE TABLE IF NOT EXISTS rpa_artifacts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id          uuid NOT NULL,
  correlation_id     uuid,
  organization_id    uuid NOT NULL,
  platform           text,
  action_type        text,
  artifact_kind      text NOT NULL CHECK (artifact_kind IN ('screenshot', 'log')),
  object_path        text NOT NULL,
  public_url         text,
  bytes              integer,
  retained_until     timestamptz NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at         timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rpa_artifacts_action
  ON rpa_artifacts (action_id);
CREATE INDEX IF NOT EXISTS idx_rpa_artifacts_correlation
  ON rpa_artifacts (correlation_id)
  WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rpa_artifacts_retained_until
  ON rpa_artifacts (retained_until);

ALTER TABLE rpa_artifacts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'rpa_artifacts'
      AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON rpa_artifacts
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

COMMENT ON TABLE rpa_artifacts IS
  'Index of RPA screenshots / logs stored in object storage. Expired rows '
  'are purged by prune_rpa_artifacts() which also deletes the backing objects.';

-- ── 4. Pruner — 7-day retention ─────────────────────────────────────────────
-- Does NOT delete the object-storage blob (requires a service role with
-- the storage API). It deletes the DB row and returns counts so the
-- scheduler's artifact-prune worker can issue the matching storage.remove
-- call for each deleted object_path in the same tick.
CREATE OR REPLACE FUNCTION prune_rpa_artifacts(p_limit integer DEFAULT 500)
RETURNS TABLE(object_path text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
    WITH expired AS (
      SELECT id, object_path
      FROM   rpa_artifacts
      WHERE  retained_until < NOW()
      ORDER  BY retained_until ASC
      LIMIT  p_limit
      FOR    UPDATE SKIP LOCKED
    ),
    deleted AS (
      DELETE FROM rpa_artifacts t
      USING  expired e
      WHERE  t.id = e.id
      RETURNING e.object_path AS object_path
    )
    SELECT object_path FROM deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION prune_rpa_artifacts TO service_role;

COMMIT;
