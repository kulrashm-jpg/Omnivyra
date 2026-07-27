-- LEAD-INTELLIGENCE-001 / W3 / LC-301 — Audience Intelligence.
--
-- ADDITIVE + idempotent. An Audience is a FIRST-CLASS platform object: a continuously
-- evaluated, evidence-driven, explainable rule set — never a static CSV list. Membership
-- is materialized WITH explainability (matched rules + evidence + confidence + when).
-- Audiences reuse the W2 operational core (entity_type='audience') for owner/status/
-- notes/tasks/timeline — no operational tables here. Members are canonical leads
-- (entity_type='canonical_lead', entity_id = lead_intelligence.id). RLS = service-role.
-- NOT applied by this file — controlled apply only (never `db push`).

CREATE TABLE IF NOT EXISTS public.audiences (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   text NOT NULL,
  name         text NOT NULL,
  description  text,
  kind         text NOT NULL DEFAULT 'dynamic',   -- dynamic | static
  rules        jsonb NOT NULL DEFAULT '{}'::jsonb, -- composable rule tree (RuleGroup)
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by   text,
  last_evaluated_at timestamptz,
  member_count int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  CONSTRAINT audiences_kind_check CHECK (kind IN ('dynamic','static')),
  CONSTRAINT audiences_name_not_blank CHECK (length(btrim(name)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_audiences_company ON public.audiences (company_id, created_at DESC) WHERE deleted_at IS NULL;

-- Materialized membership with per-member EXPLAINABILITY (why / evidence / confidence / when / source).
CREATE TABLE IF NOT EXISTS public.audience_memberships (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience_id       uuid NOT NULL REFERENCES public.audiences(id) ON DELETE CASCADE,
  company_id        text NOT NULL,
  entity_type       text NOT NULL DEFAULT 'canonical_lead',
  entity_id         text NOT NULL,
  matched_rules     jsonb NOT NULL DEFAULT '[]'::jsonb,   -- which conditions matched
  evidence          jsonb NOT NULL DEFAULT '[]'::jsonb,   -- the evidence behind the match
  confidence        numeric NOT NULL DEFAULT 0,           -- 0..1
  evaluation_source text NOT NULL DEFAULT 'rule_engine',
  evaluated_at      timestamptz NOT NULL DEFAULT now(),
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  active            boolean NOT NULL DEFAULT true,
  CONSTRAINT audience_memberships_unique UNIQUE (audience_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_audience_memberships_audience ON public.audience_memberships (audience_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_audience_memberships_entity ON public.audience_memberships (company_id, entity_type, entity_id) WHERE active;

ALTER TABLE public.audiences            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audience_memberships ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text; tables text[] := ARRAY['audiences','audience_memberships'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='audience_service_role') THEN
      EXECUTE format('DROP POLICY audience_service_role ON public.%I', t);
    END IF;
    EXECUTE format('CREATE POLICY audience_service_role ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

COMMENT ON TABLE public.audiences IS 'W3/LC-301 first-class Audience object (dynamic rule set). Operational layer via operational_* (entity_type=audience).';
COMMENT ON TABLE public.audience_memberships IS 'W3/LC-301 materialized, explainable membership (matched rules + evidence + confidence + evaluated_at).';
