-- =====================================================
-- INTELLIGENCE PIPELINE SEED DATA
-- Minimal data for end-to-end pipeline testing
-- =====================================================
-- Prerequisites: companies, external_api_sources, intelligence_signals
-- =====================================================
-- Use: Run after migrations when external APIs unavailable
-- =====================================================

-- 0. Ensure company_intelligence_signals table exists (creates if missing)
CREATE TABLE IF NOT EXISTS company_intelligence_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  signal_id UUID NOT NULL REFERENCES intelligence_signals(id) ON DELETE CASCADE,
  relevance_score NUMERIC NULL,
  impact_score NUMERIC NULL,
  signal_type TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, signal_id)
);
CREATE INDEX IF NOT EXISTS index_company_intelligence_signals_company
  ON company_intelligence_signals (company_id);
CREATE INDEX IF NOT EXISTS index_company_intelligence_signals_signal
  ON company_intelligence_signals (signal_id);
CREATE INDEX IF NOT EXISTS index_company_intelligence_signals_company_created
  ON company_intelligence_signals (company_id, created_at DESC);

-- 1. Companies (use ON CONFLICT on website)
INSERT INTO companies (id, name, website, industry, status)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Seed Company A', 'https://seeda.example.com', 'technology', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'Seed Company B', 'https://seedb.example.com', 'marketing', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'Seed Company C', 'https://seedc.example.com', 'saas', 'active')
ON CONFLICT (website) DO NOTHING;

-- 2. External API source (required for intelligence_signals FK)
INSERT INTO external_api_sources (id, name, base_url, purpose, is_active)
VALUES ('b0000000-0000-0000-0000-000000000001', 'Seed API', 'https://seed.example.com', 'trends', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Intelligence signals (5 signals) - skip if seed already present
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM intelligence_signals WHERE idempotency_key LIKE 'seed-intel-%' LIMIT 1) THEN
    INSERT INTO intelligence_signals (source_api_id, company_id, signal_type, topic, confidence_score, detected_at, idempotency_key)
    VALUES
      ('b0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid, 'trend', 'Emerging AI marketing trends', 0.7, now(), 'seed-intel-1'),
      ('b0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid, 'trend', 'SaaS growth momentum 2025', 0.7, now() - interval '30 min', 'seed-intel-2'),
      ('b0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid, 'trend', 'Customer pain points automation', 0.6, now() - interval '60 min', 'seed-intel-3'),
      ('b0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid, 'trend', 'Competitor weakness in pricing', 0.8, now() - interval '90 min', 'seed-intel-4'),
      ('b0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid, 'trend', 'Market gap for B2B content', 0.75, now() - interval '120 min', 'seed-intel-5');
  END IF;
END $$;

-- 4. Company intelligence signals - link to company for aggregator
INSERT INTO company_intelligence_signals (company_id, signal_id, relevance_score, impact_score, signal_type)
SELECT 'a0000000-0000-0000-0000-000000000001'::uuid, s.id, 0.7, 0.6, 'trend'
FROM intelligence_signals s
WHERE s.idempotency_key LIKE 'seed-intel-%'
  AND NOT EXISTS (SELECT 1 FROM company_intelligence_signals c WHERE c.company_id = 'a0000000-0000-0000-0000-000000000001' AND c.signal_id = s.id);

-- 5. Company execution priority
INSERT INTO company_execution_priority (company_id, priority_level)
VALUES ('a0000000-0000-0000-0000-000000000001', 'NORMAL')
ON CONFLICT (company_id) DO UPDATE SET updated_at = now();
