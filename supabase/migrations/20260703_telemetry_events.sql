-- ============================================================================
-- Canonical Telemetry — append-only event ledger
-- ----------------------------------------------------------------------------
-- THE ONE canonical model for product business actions across every domain
-- (content, campaign, ai, automation, analytics, reports, recommendations,
-- collaboration, lead_management, integrations, website, community,
-- market_intelligence). Every business action flows through this ledger; no
-- feature module maintains its own event store. This is DISTINCT from
-- `canonical_events` (website visitor analytics: navigation/engagement/
-- conversion) — no duplication. Records BUSINESS OUTCOMES only — never page
-- views, button clicks, tab changes, hover, or scroll.
--
-- Append-only: INSERT allowed; UPDATE/DELETE rejected by trigger (immutable
-- ledger). Raw events only — no derived scores are stored here; aggregation is
-- computed on read by the canonical aggregator + providers.
--
-- NOT APPLIED by this phase. Provisioning is an operational step; until then the
-- service layer fails soft (writes no-op, reads return empty) so instrumentation
-- never affects existing behavior.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.telemetry_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      TEXT NOT NULL,
  category        TEXT NOT NULL,
  organization_id UUID NOT NULL,
  actor_id        UUID,
  entity_id       TEXT,
  entity_type     TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedup_key       TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT telemetry_events_type_not_blank CHECK (length(btrim(event_type)) > 0)
);

-- Deterministic idempotency: one business action can never emit twice.
-- A FULL unique index (not partial) so it can serve as an ON CONFLICT arbiter
-- for the upsert. NULL dedup_key rows are treated as DISTINCT (Postgres default
-- NULLS DISTINCT), so non-deduped events (e.g. toggles) still insert freely,
-- while non-null keys are idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS telemetry_events_dedup_uidx
  ON public.telemetry_events (organization_id, event_type, dedup_key);

-- Aggregation read paths (per-org, per-type, time-ordered).
CREATE INDEX IF NOT EXISTS telemetry_events_org_type_time_idx
  ON public.telemetry_events (organization_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS telemetry_events_org_time_idx
  ON public.telemetry_events (organization_id, occurred_at DESC);

-- Append-only enforcement — reject any UPDATE/DELETE (immutable ledger).
CREATE OR REPLACE FUNCTION public.telemetry_events_reject_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'telemetry_events is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS telemetry_events_no_update ON public.telemetry_events;
CREATE TRIGGER telemetry_events_no_update
  BEFORE UPDATE ON public.telemetry_events
  FOR EACH ROW EXECUTE FUNCTION public.telemetry_events_reject_mutation();

DROP TRIGGER IF EXISTS telemetry_events_no_delete ON public.telemetry_events;
CREATE TRIGGER telemetry_events_no_delete
  BEFORE DELETE ON public.telemetry_events
  FOR EACH ROW EXECUTE FUNCTION public.telemetry_events_reject_mutation();

-- RLS: service-role only (backend writes/reads via service key).
ALTER TABLE public.telemetry_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'telemetry_events'
      AND policyname = 'service_role_full_access'
  ) THEN
    DROP POLICY "service_role_full_access" ON public.telemetry_events;
  END IF;
  CREATE POLICY "service_role_full_access" ON public.telemetry_events
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
END
$$;

COMMIT;
