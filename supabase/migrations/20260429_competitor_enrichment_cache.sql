CREATE TABLE IF NOT EXISTS competitor_enrichment_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text NOT NULL UNIQUE,
  name text NOT NULL,
  domain text,
  category text,
  tags text[] NOT NULL DEFAULT '{}',
  description text,
  icp jsonb NOT NULL DEFAULT '{"age_group": null, "use_case": null, "user_intent": null}'::jsonb,
  business_model text,
  geography text,
  product_type text NOT NULL DEFAULT 'unknown',
  scale_signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence_score float NOT NULL DEFAULT 0.15,
  sources text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS competitor_enrichment_cache_name_idx
  ON competitor_enrichment_cache (lower(name));

CREATE INDEX IF NOT EXISTS competitor_enrichment_cache_domain_idx
  ON competitor_enrichment_cache (domain)
  WHERE domain IS NOT NULL;

ALTER TABLE competitor_enrichment_cache ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'competitor_enrichment_cache'
      AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON competitor_enrichment_cache
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

DROP TRIGGER IF EXISTS competitor_enrichment_cache_updated_at ON competitor_enrichment_cache;
CREATE TRIGGER competitor_enrichment_cache_updated_at
BEFORE UPDATE ON competitor_enrichment_cache
FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();
