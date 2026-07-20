-- communication_registry
-- Semantic Coordination Registry (OMNIVYRA-PMO-001 Zone A2 — Intelligence & Egress).
--
-- The shared coordination ledger of communication *intents* across all specialized
-- intelligences (Writer, Campaigns, Creator, Engagement, Analytics, MarketPulse).
-- It records WHAT a company is communicating, to WHOM, on which platform, under which
-- campaign, and a semantic embedding *reference* — so modules can detect repeated
-- communication INTENT (semantic), not repeated wording (that is A1's content_memory).
--
-- Additive + isolated: a NEW table, no ALTERs to existing tables, no FKs (soft refs only).
-- Safe to apply; reversible by DROP TABLE. Embedding is stored inline as jsonb (mirrors
-- content_memory.embedding) — no pgvector dependency in this wave.
--
-- Persistence is opt-in: the layer only writes here when COORDINATION_REGISTRY_PERSIST_ENABLED=true.
-- Application: manual SQL-editor apply, then verify with scripts/verify-schema-parity.js.

CREATE TABLE IF NOT EXISTS public.communication_registry (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL,

  semantic_root_id      text        NOT NULL,          -- stable grouping id for one intent seed
  communication_intent  text        NOT NULL,          -- announce|educate|promote|engage|nurture|reply|report|recruit|advocate|other
  topic                 text        NOT NULL,          -- the semantic seed (subject), NOT the produced wording

  campaign_id           uuid,
  platform              text,
  audience              text,

  publication_status    text        NOT NULL DEFAULT 'planned',  -- planned|generated|scheduled|published|suppressed|retired

  embedding             jsonb,                          -- SemanticEmbeddingRef { provider, dim, vector[]|null, ref? }
  content_ref           jsonb,                          -- soft ref { kind, id } to produced content
  performance_ref       jsonb,                          -- soft ref { kind, id } to a performance/metrics record

  source_module         text        NOT NULL DEFAULT 'unknown',  -- writer|campaigns|creator|engagement|analytics|marketpulse|unknown
  observed_at           timestamptz NOT NULL DEFAULT now(),
  metadata              jsonb,

  registry_version      text        NOT NULL DEFAULT 'coordination-registry-v1'
);

-- Candidate selection for duplicate-intent checks: recent, per company (+ campaign).
CREATE INDEX IF NOT EXISTS idx_comm_registry_company_observed
  ON public.communication_registry (company_id, observed_at DESC);

-- Deterministic root lookups (Tier-1 duplicate detection).
CREATE INDEX IF NOT EXISTS idx_comm_registry_company_root
  ON public.communication_registry (company_id, semantic_root_id);

-- Campaign-narrowed coordination reads.
CREATE INDEX IF NOT EXISTS idx_comm_registry_company_campaign
  ON public.communication_registry (company_id, campaign_id);

-- Tenant isolation (mirrors content_memory / customer-scoped tables).
ALTER TABLE public.communication_registry ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'communication_registry'
      AND policyname = 'communication_registry_company_rw'
  ) THEN
    CREATE POLICY communication_registry_company_rw ON public.communication_registry
      USING (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = 'active'))
      WITH CHECK (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = 'active'));
  END IF;
END $$;
