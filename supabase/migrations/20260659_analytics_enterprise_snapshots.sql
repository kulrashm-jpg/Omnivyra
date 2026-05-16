CREATE TABLE IF NOT EXISTS public.analytics_intelligence_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  snapshot_type text NOT NULL,
  canonical_fingerprint text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  snapshot_payload jsonb NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analytics_intelligence_snapshots_type_valid
    CHECK (snapshot_type IN ('ga_gsc_enterprise')),
  CONSTRAINT analytics_intelligence_snapshots_unique
    UNIQUE (company_id, snapshot_type, canonical_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_analytics_intelligence_snapshots_lookup
  ON public.analytics_intelligence_snapshots(company_id, snapshot_type, expires_at DESC, computed_at DESC);

DROP TRIGGER IF EXISTS trg_analytics_intelligence_snapshots_updated_at
  ON public.analytics_intelligence_snapshots;

CREATE TRIGGER trg_analytics_intelligence_snapshots_updated_at
  BEFORE UPDATE ON public.analytics_intelligence_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.analytics_intelligence_snapshots IS
  'Short-lived enterprise analytics intelligence snapshots derived only from canonical GA/GSC data. Fingerprint invalidates snapshots when canonical ingestion changes.';
