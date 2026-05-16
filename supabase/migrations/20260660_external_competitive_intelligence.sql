CREATE TABLE IF NOT EXISTS public.analytics_competitor_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  domain text NOT NULL,
  label text,
  source text NOT NULL DEFAULT 'manual',
  confidence text NOT NULL DEFAULT 'low',
  relevance_score numeric,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_discovered_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analytics_competitor_domains_source_valid
    CHECK (source IN ('manual', 'market_intelligence', 'serp_observed')),
  CONSTRAINT analytics_competitor_domains_confidence_valid
    CHECK (confidence IN ('high', 'medium', 'low')),
  CONSTRAINT analytics_competitor_domains_unique
    UNIQUE (company_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_analytics_competitor_domains_company
  ON public.analytics_competitor_domains(company_id, active, confidence);

DROP TRIGGER IF EXISTS trg_analytics_competitor_domains_updated_at
  ON public.analytics_competitor_domains;

CREATE TRIGGER trg_analytics_competitor_domains_updated_at
  BEFORE UPDATE ON public.analytics_competitor_domains
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.analytics_serp_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  query text NOT NULL,
  geography text NOT NULL DEFAULT 'global',
  device text NOT NULL DEFAULT 'desktop',
  provider text NOT NULL DEFAULT 'manual_import',
  captured_at timestamptz NOT NULL,
  fingerprint text NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analytics_serp_snapshots_provider_valid
    CHECK (provider IN ('manual_import', 'compliant_api', 'synthetic_validation')),
  CONSTRAINT analytics_serp_snapshots_unique
    UNIQUE (company_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_analytics_serp_snapshots_company_query
  ON public.analytics_serp_snapshots(company_id, query, captured_at DESC);

CREATE TABLE IF NOT EXISTS public.analytics_serp_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES public.analytics_serp_snapshots(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  query text NOT NULL,
  captured_at timestamptz NOT NULL,
  position integer NOT NULL,
  url text NOT NULL,
  domain text NOT NULL,
  title text,
  result_type text NOT NULL DEFAULT 'organic',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analytics_serp_results_position_valid
    CHECK (position > 0 AND position <= 100),
  CONSTRAINT analytics_serp_results_type_valid
    CHECK (result_type IN ('organic', 'featured_snippet', 'paid', 'other')),
  CONSTRAINT analytics_serp_results_unique
    UNIQUE (snapshot_id, position, domain, url)
);

CREATE INDEX IF NOT EXISTS idx_analytics_serp_results_company_query
  ON public.analytics_serp_results(company_id, query, captured_at DESC, position);

CREATE INDEX IF NOT EXISTS idx_analytics_serp_results_domain
  ON public.analytics_serp_results(company_id, domain, position);

COMMENT ON TABLE public.analytics_competitor_domains IS
  'Canonical competitor domain registry for external competitive analytics. Does not fabricate competitor evidence.';

COMMENT ON TABLE public.analytics_serp_snapshots IS
  'Canonical SERP snapshot metadata from compliant/manual search-intelligence collection only.';

COMMENT ON TABLE public.analytics_serp_results IS
  'Canonical SERP result positions tied to captured snapshots with provenance and dedupe constraints.';
