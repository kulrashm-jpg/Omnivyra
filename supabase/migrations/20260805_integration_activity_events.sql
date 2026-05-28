-- Phase 13.5 — Integration activity timeline.
--
-- Records discrete state-transition events for OAuth + publishing
-- integrations: connected, validated, refreshed, published, synced,
-- failed, recovered, disconnected, retry_started, retry_succeeded,
-- retry_failed. Read-only consumers (oauth-health page,
-- integrationAudit script, future per-integration drawer) tail this
-- table to build a human-readable activity timeline.
--
-- Writers must NEVER include tokens, refresh tokens, or OAuth codes
-- in `metadata`. Application-layer code enforces this; the column is
-- jsonb to allow per-provider context payloads (e.g. property_id,
-- failure_point) without schema churn.
--
-- Lifecycle:
--   * Inserts are append-only — no UPDATE, no DELETE outside the prune
--     job described below.
--   * RLS off (table is operator-facing, written by service role only).
--   * 90-day retention enforced by a separate prune job; not part of
--     this migration so it can be tuned operationally.
--
-- IMPORTANT: this migration introduces a new table. Apply via the
-- normal Supabase migration flow (e.g. `supabase db push` against a
-- staging env first). Do NOT bulk-push the full migrations directory.

CREATE TABLE IF NOT EXISTS public.integration_activity_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id  uuid NOT NULL,
  company_id      uuid NOT NULL,
  provider        text NOT NULL,
  event_type      text NOT NULL,
  event_status    text NOT NULL DEFAULT 'info',
  message         text,
  metadata        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Tight constraint on the canonical event taxonomy so writers cannot
-- silently introduce new event_types that the UI does not render.
ALTER TABLE public.integration_activity_events
  ADD CONSTRAINT integration_activity_events_event_type_check
  CHECK (event_type IN (
    'connected',
    'validated',
    'refreshed',
    'published',
    'synced',
    'failed',
    'recovered',
    'disconnected',
    'retry_started',
    'retry_succeeded',
    'retry_failed'
  ));

ALTER TABLE public.integration_activity_events
  ADD CONSTRAINT integration_activity_events_event_status_check
  CHECK (event_status IN ('info', 'success', 'warning', 'error'));

-- Read patterns:
--   1. Per-integration timeline (drawer view): integration_id + ORDER BY created_at DESC
--   2. Recent failures across a tenant (oauth-health card): company_id + event_status + created_at
--   3. Global retry telemetry (CI rollups): event_type IN ('retry_started','retry_succeeded','retry_failed') + created_at
CREATE INDEX IF NOT EXISTS idx_iae_integration_id_created_at
  ON public.integration_activity_events (integration_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_iae_company_id_created_at
  ON public.integration_activity_events (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_iae_event_type_created_at
  ON public.integration_activity_events (event_type, created_at DESC)
  WHERE event_type IN ('retry_started', 'retry_succeeded', 'retry_failed', 'failed');

COMMENT ON TABLE public.integration_activity_events IS
  'Phase 13.5 — append-only integration state-transition timeline. Writers MUST NOT include tokens or OAuth codes in metadata.';
