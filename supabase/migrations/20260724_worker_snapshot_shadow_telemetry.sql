-- Universal Publishing Orchestration — Worker Shadow Snapshot Telemetry
--
-- Additive only. Append-only, immutable persistence for non-production shadow
-- soak telemetry: worker runtime telemetry, metrics snapshots, and risk /
-- drift / compatibility / ownership summaries. Advisory-only — nothing here
-- gates publishing.
--
-- RLS enabled (service-role-only posture). A BEFORE UPDATE OR DELETE trigger
-- enforces strict append-only semantics at the database layer.

BEGIN;

CREATE TABLE IF NOT EXISTS public.worker_snapshot_shadow_telemetry (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  soak_cycle_id         TEXT NOT NULL,
  record_kind           TEXT NOT NULL,
  company_id            UUID NULL REFERENCES public.companies(id) ON DELETE SET NULL,
  blog_id               UUID NULL REFERENCES public.blogs(id) ON DELETE SET NULL,
  job_id                TEXT NULL,
  runtime_status        TEXT NULL,
  shadow_soak_status    TEXT NULL,
  payload               JSONB NOT NULL,
  telemetry_fingerprint TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT worker_snapshot_shadow_telemetry_kind_check
    CHECK (record_kind IN (
      'runtime_telemetry', 'metrics_snapshot', 'risk_summary',
      'drift_summary', 'compatibility_summary', 'ownership_summary'
    ))
);

CREATE INDEX IF NOT EXISTS idx_wsst_soak_cycle
  ON public.worker_snapshot_shadow_telemetry(soak_cycle_id);
CREATE INDEX IF NOT EXISTS idx_wsst_record_kind
  ON public.worker_snapshot_shadow_telemetry(record_kind);
CREATE INDEX IF NOT EXISTS idx_wsst_company
  ON public.worker_snapshot_shadow_telemetry(company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wsst_created_at
  ON public.worker_snapshot_shadow_telemetry(created_at);

ALTER TABLE public.worker_snapshot_shadow_telemetry ENABLE ROW LEVEL SECURITY;

-- Append-only guard: shadow telemetry rows can never be updated or deleted.
CREATE OR REPLACE FUNCTION public.worker_snapshot_shadow_telemetry_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'worker_snapshot_shadow_telemetry is append-only';
END;
$$;

DROP TRIGGER IF EXISTS worker_snapshot_shadow_telemetry_append_only
  ON public.worker_snapshot_shadow_telemetry;
CREATE TRIGGER worker_snapshot_shadow_telemetry_append_only
  BEFORE UPDATE OR DELETE ON public.worker_snapshot_shadow_telemetry
  FOR EACH ROW EXECUTE FUNCTION public.worker_snapshot_shadow_telemetry_append_only();

COMMENT ON TABLE public.worker_snapshot_shadow_telemetry IS
  'Append-only advisory shadow soak telemetry for governed publishing snapshots. Non-executing.';

COMMIT;
