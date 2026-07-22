-- semantic_roots + communication_registry lineage columns
-- Semantic Continuity Engine (OMNI-COORD-002, Zone A2 — Intelligence & Egress).
--
-- Phase 1: `semantic_roots` — the ORIGIN of communication (business objective, optional
--   campaign objective, topic, communication intent, target audience, positioning). Not
--   content, not a prompt — the seed everything derives from.
-- Phase 2/3: additive lineage columns on `communication_registry` so each row can act as an
--   artifact node (artifact_type, parent_artifact_id, derived_from, generation_stage).
--
-- Additive + reversible: one NEW table + ADD COLUMN IF NOT EXISTS (no data migration, no FKs
-- — lineage refs are soft). Metadata only; no runtime behaviour change. Persistence is opt-in
-- (COORDINATION_REGISTRY_PERSIST_ENABLED). Depends on 20260720120000 (communication_registry).
-- Application: manual SQL-editor apply, then verify with scripts/verify-schema-parity.js.

-- ── Phase 1: Semantic Roots ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.semantic_roots (
  id                    text        PRIMARY KEY,          -- = deriveSemanticRootId(...) unless supplied
  company_id            uuid        NOT NULL,

  business_objective    text        NOT NULL,
  campaign_objective    text,                              -- optional campaign framing
  topic                 text        NOT NULL,
  communication_intent  text        NOT NULL,
  target_audience       text        NOT NULL,
  positioning           text        NOT NULL,

  created_at            timestamptz NOT NULL DEFAULT now(),
  metadata              jsonb,

  root_version          text        NOT NULL DEFAULT 'semantic-root-v1'
);

CREATE INDEX IF NOT EXISTS idx_semantic_roots_company
  ON public.semantic_roots (company_id, created_at DESC);

ALTER TABLE public.semantic_roots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'semantic_roots'
      AND policyname = 'semantic_roots_company_rw'
  ) THEN
    CREATE POLICY semantic_roots_company_rw ON public.semantic_roots
      USING (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = 'active'))
      WITH CHECK (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = 'active'));
  END IF;
END $$;

-- ── Phase 2/3: lineage columns on communication_registry (additive) ──────────
ALTER TABLE public.communication_registry ADD COLUMN IF NOT EXISTS artifact_type       text;
ALTER TABLE public.communication_registry ADD COLUMN IF NOT EXISTS parent_artifact_id  uuid;
ALTER TABLE public.communication_registry ADD COLUMN IF NOT EXISTS derived_from        jsonb;   -- text[] of predecessor ids
ALTER TABLE public.communication_registry ADD COLUMN IF NOT EXISTS generation_stage    text;

-- Lineage traversal: children of a given artifact.
CREATE INDEX IF NOT EXISTS idx_comm_registry_parent
  ON public.communication_registry (company_id, parent_artifact_id);
