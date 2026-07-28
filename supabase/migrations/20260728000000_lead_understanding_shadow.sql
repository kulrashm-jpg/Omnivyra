-- LEAD-INTELLIGENCE-PROGRAM-001 / Phase B / LI-B108 — Canonical Lead Understanding shadow store.
--
-- ADDITIVE + idempotent + DORMANT. The persistence target for the shadow runtime. NOTHING writes
-- it in Phase B (shadow-first, flag-dark); it exists so the canonical persistence contract has a
-- home for later phases. No existing table is touched. RLS = service-role. Controlled apply only
-- (never `db push`, per the repo migration-ledger policy) — and not required until shadow write-back
-- is wired in a later phase.

CREATE TABLE IF NOT EXISTS public.lead_understanding_shadow (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    text NOT NULL,
  lead_key      text NOT NULL,
  version       integer NOT NULL DEFAULT 1,
  understanding jsonb NOT NULL,            -- full canonical LeadUnderstanding (facets/score/reasoning/contradictions/graph)
  projection    jsonb NOT NULL,            -- derived LeadProjection
  parity        double precision,          -- shadow parity vs legacy scores (null until compared)
  built_at      timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_lead_understanding_shadow UNIQUE (company_id, lead_key, version)
);
CREATE INDEX IF NOT EXISTS idx_lead_understanding_shadow_lookup ON public.lead_understanding_shadow (company_id, lead_key);
CREATE INDEX IF NOT EXISTS idx_lead_understanding_shadow_parity ON public.lead_understanding_shadow (company_id, parity);

ALTER TABLE public.lead_understanding_shadow ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lead_understanding_shadow' AND policyname='lead_understanding_service_role') THEN
    DROP POLICY lead_understanding_service_role ON public.lead_understanding_shadow;
  END IF;
  CREATE POLICY lead_understanding_service_role ON public.lead_understanding_shadow FOR ALL TO service_role USING (true) WITH CHECK (true);
END $$;

COMMENT ON TABLE public.lead_understanding_shadow IS 'Phase B / LI-B108 — canonical Lead Understanding shadow store (dormant; shadow-first). Persistence contract target; no writer wired in Phase B.';
