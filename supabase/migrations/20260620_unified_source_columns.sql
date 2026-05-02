BEGIN;

ALTER TABLE public.canonical_leads
  ADD COLUMN IF NOT EXISTS unified_source JSONB;

ALTER TABLE public.canonical_events
  ADD COLUMN IF NOT EXISTS unified_source JSONB;

ALTER TABLE public.canonical_conversions
  ADD COLUMN IF NOT EXISTS unified_source JSONB;

ALTER TABLE public.canonical_revenue_events
  ADD COLUMN IF NOT EXISTS unified_source JSONB;

ALTER TABLE public.ingestion_runs
  ADD COLUMN IF NOT EXISTS unified_source JSONB;

ALTER TABLE public.data_source_status
  ADD COLUMN IF NOT EXISTS unified_source JSONB;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS unified_source JSONB;

COMMENT ON COLUMN public.canonical_leads.unified_source IS
  'Normalized source descriptor for cross-source ingestion, attribution, and intelligence.';
COMMENT ON COLUMN public.canonical_events.unified_source IS
  'Normalized source descriptor for cross-source ingestion, attribution, and intelligence.';
COMMENT ON COLUMN public.canonical_conversions.unified_source IS
  'Normalized source descriptor for cross-source ingestion, attribution, and intelligence.';
COMMENT ON COLUMN public.canonical_revenue_events.unified_source IS
  'Normalized source descriptor for cross-source ingestion, attribution, and intelligence.';
COMMENT ON COLUMN public.ingestion_runs.unified_source IS
  'Normalized source descriptor for the ingestion run source.';
COMMENT ON COLUMN public.data_source_status.unified_source IS
  'Normalized source descriptor for the tracked source status.';
COMMENT ON COLUMN public.leads.unified_source IS
  'Normalized source descriptor for legacy lead records.';

COMMIT;
