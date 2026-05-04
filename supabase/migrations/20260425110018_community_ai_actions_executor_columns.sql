-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260425110018  Name: community_ai_actions_executor_columns
-- Idempotency: GUARDED.

-- Catch up community_ai_actions to what the executor writes today.
-- Idempotent: every add is IF NOT EXISTS / DO-block guarded.

ALTER TABLE community_ai_actions
  ADD COLUMN IF NOT EXISTS execution_correlation_id  uuid,
  ADD COLUMN IF NOT EXISTS approved_at               timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_lease_id         text,
  ADD COLUMN IF NOT EXISTS dispatch_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_lease_holder_id  text,
  ADD COLUMN IF NOT EXISTS dispatch_acknowledged_at  timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key           text,
  ADD COLUMN IF NOT EXISTS command_chain             jsonb,
  ADD COLUMN IF NOT EXISTS command_chain_index       integer;

CREATE INDEX IF NOT EXISTS idx_community_ai_actions_correlation_id
  ON community_ai_actions (execution_correlation_id)
  WHERE execution_correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_community_ai_actions_dispatch_pending
  ON community_ai_actions (organization_id, status, execution_mode, dispatch_lease_expires_at)
  WHERE status = 'pending' AND execution_mode = 'browser';

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_ai_actions_org_idempotency_key
  ON community_ai_actions (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS community_ai_execution_metric_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  action_id       uuid,
  correlation_id  uuid,
  event_type      text NOT NULL
                    CHECK (event_type IN (
                      'execution_started',
                      'execution_success',
                      'execution_failed',
                      'fallback_triggered',
                      'lease_expired',
                      'ack_received'
                    )),
  platform        text,
  action_type     text,
  execution_mode  text,
  metadata        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caime_org_created_at
  ON community_ai_execution_metric_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_caime_event_type_created_at
  ON community_ai_execution_metric_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_caime_correlation
  ON community_ai_execution_metric_events (correlation_id)
  WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_caime_action
  ON community_ai_execution_metric_events (action_id)
  WHERE action_id IS NOT NULL;

ALTER TABLE community_ai_execution_metric_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'community_ai_execution_metric_events'
      AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON community_ai_execution_metric_events
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;
