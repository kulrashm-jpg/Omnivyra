-- LEAD-INTELLIGENCE-001 / W4 / LC-401 — Campaign Intelligence (GTM orchestration).
--
-- ADDITIVE + idempotent. A GTM Campaign is a first-class STRATEGY object that REFERENCES
-- an audience (never duplicates its members) and reuses the W2 operational core
-- (entity_type='gtm_campaign') for owner/status/notes/tasks/timeline. Distinct from the
-- content-planning `campaigns` table (creator/BOLT weekly plans) — a different domain.
-- Messaging assets are reusable across campaigns. RLS = service-role. Controlled apply only.

CREATE TABLE IF NOT EXISTS public.gtm_campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    text NOT NULL,
  name          text NOT NULL,
  description   text,
  status        text NOT NULL DEFAULT 'draft',   -- draft|active|paused|completed|archived
  objective     text,
  audience_id   uuid,                             -- REFERENCE to audiences.id (no recipient copy)
  channels      jsonb NOT NULL DEFAULT '[]'::jsonb,
  kpis          jsonb NOT NULL DEFAULT '[]'::jsonb,
  schedule      jsonb NOT NULL DEFAULT '{}'::jsonb,
  strategy      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- last explainable recommendation snapshot
  version       int  NOT NULL DEFAULT 1,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT gtm_campaigns_status_check CHECK (status IN ('draft','active','paused','completed','archived')),
  CONSTRAINT gtm_campaigns_name_not_blank CHECK (length(btrim(name)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_gtm_campaigns_company ON public.gtm_campaigns (company_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gtm_campaigns_audience ON public.gtm_campaigns (audience_id) WHERE audience_id IS NOT NULL;

-- Reusable messaging assets (across campaigns) with fit + performance metadata.
CREATE TABLE IF NOT EXISTS public.gtm_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     text NOT NULL,
  name           text NOT NULL,
  channel        text NOT NULL,                   -- email|linkedin|whatsapp|sms|in_app|manual
  subject        text,
  body           text NOT NULL,
  buying_stage   text,                            -- awareness|interest|evaluation|…
  audience_fit   jsonb NOT NULL DEFAULT '{}'::jsonb,
  journey_fit    jsonb NOT NULL DEFAULT '{}'::jsonb,
  performance    jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes          text,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CONSTRAINT gtm_messages_channel_check CHECK (channel IN ('email','linkedin','whatsapp','sms','in_app','manual')),
  CONSTRAINT gtm_messages_body_not_blank CHECK (length(btrim(body)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_gtm_messages_company ON public.gtm_messages (company_id, channel) WHERE deleted_at IS NULL;

ALTER TABLE public.gtm_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gtm_messages  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text; tables text[] := ARRAY['gtm_campaigns','gtm_messages'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='gtm_service_role') THEN
      EXECUTE format('DROP POLICY gtm_service_role ON public.%I', t);
    END IF;
    EXECUTE format('CREATE POLICY gtm_service_role ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

COMMENT ON TABLE public.gtm_campaigns IS 'W4/LC-401 GTM Campaign (strategy object; references audiences.id; operational via operational_* entity_type=gtm_campaign). Distinct from content-planning campaigns.';
COMMENT ON TABLE public.gtm_messages IS 'W4/LC-401 reusable messaging assets (per channel/stage) with audience/journey fit + performance.';
