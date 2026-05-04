-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260425140421  Name: phase7_rpa_operations
-- Idempotency: GUARDED.

-- ── 1. cancel_requested_at ──────────────────────────────────────────────────
ALTER TABLE community_ai_actions
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_community_ai_actions_cancel_requested
  ON community_ai_actions (cancel_requested_at)
  WHERE cancel_requested_at IS NOT NULL;

-- ── 2. rpa_sessions ─────────────────────────────────────────────────────────
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

-- ── 3. rpa_artifacts ────────────────────────────────────────────────────────
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
