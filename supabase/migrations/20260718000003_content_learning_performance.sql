-- 2026-07-18 — WRITER-EXEC-006 Wave 5: Learning Engine, Performance Intelligence
-- & Continuous Optimization. Lets Writer learn from PUBLISHED content and improve
-- future generations through deterministic, explainable, company-scoped signals.
--
-- Builds on Waves 1-4 (canonical content, originality, quality). Does NOT redesign
-- them. FIVE NEW tables, ZERO changes to existing tables. Learning NEVER mutates
-- historical content (append-only signal/intelligence rows). Company-scoped RLS.
-- Idempotent. No cross-company data (every table is company_id-keyed).
--
-- APPLY: cert/beta via BETA_DB_URL; production via the controlled pooler-DDL
-- process (ledger desynced; do NOT db:push). This file is the record.

-- ── content_performance — per-published-item signals (item 2, extensible) ────
CREATE TABLE IF NOT EXISTS public.content_performance (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  content_id    uuid,                        -- soft ref → content.id
  platform      text,
  impressions   bigint,
  reach         bigint,
  clicks        bigint,
  engagement    bigint,
  reactions     bigint,
  comments      bigint,
  shares        bigint,
  saves         bigint,
  ctr           numeric,
  watch_time_ms bigint,
  metrics       jsonb,                       -- extensible bag for future/ platform-specific metrics
  source        text,                        -- 'manual' | 'platform_sync' | ...
  captured_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_performance_company_idx ON public.content_performance (company_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS content_performance_content_idx ON public.content_performance (content_id) WHERE content_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_performance_company_platform_idx ON public.content_performance (company_id, platform);

-- ── learning_intelligence — derived structured intelligence (item 3) ────────
-- Persisted PATTERNS (not raw observations): strongest hooks/CTA/structures/
-- lengths/hashtags/emoji/platform/campaign trends. Idempotent per (company,
-- dimension, key, platform) so re-derivation upserts rather than duplicates.
CREATE TABLE IF NOT EXISTS public.learning_intelligence (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  dimension   text NOT NULL,                 -- 'hook'|'cta'|'structure'|'length'|'hashtag'|'emoji'|'platform'|'campaign'
  pattern_key text NOT NULL,                 -- canonical key within the dimension
  platform    text,                          -- nullable = cross-platform
  pattern     jsonb NOT NULL,                 -- the structured pattern + evidence
  score       numeric,                       -- effectiveness score (0..1), explainable
  sample_size integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS learning_intelligence_uidx
  ON public.learning_intelligence (company_id, dimension, pattern_key, COALESCE(platform, ''));
CREATE INDEX IF NOT EXISTS learning_intelligence_company_dim_idx ON public.learning_intelligence (company_id, dimension, score DESC);

-- ── learning_memory — company rollup extending Brand Memory (item 4) ────────
-- Consumed TOGETHER WITH Wave-2 brand_memory at read time (this table does not
-- alter brand_memory). One row per company.
CREATE TABLE IF NOT EXISTS public.learning_memory (
  company_id           uuid PRIMARY KEY,
  successful_messaging jsonb,
  unsuccessful_messaging jsonb,
  narrative_styles     jsonb,       -- preferred / winning narrative styles
  winning_structures   jsonb,
  platform_adaptations jsonb,       -- effective per-platform adaptations
  audience_interests   jsonb,       -- recurring audience interests
  model_version        integer NOT NULL DEFAULT 1,  -- freshness / reproducibility
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ── publication_lineage — complete traceable publication history (item 7) ───
CREATE TABLE IF NOT EXISTS public.publication_lineage (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,
  content_id        uuid,                     -- soft ref → content.id
  parent_content_id uuid,                     -- regeneration / repost lineage
  event_type        text NOT NULL CHECK (event_type IN ('published','reposted','regenerated','revised','scheduled')),
  platform          text,
  scheduled_post_id uuid,
  metadata          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS publication_lineage_content_idx ON public.publication_lineage (content_id, created_at DESC);
CREATE INDEX IF NOT EXISTS publication_lineage_company_idx ON public.publication_lineage (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS publication_lineage_parent_idx ON public.publication_lineage (parent_content_id) WHERE parent_content_id IS NOT NULL;

-- ── content_prediction — explainable, reproducible predictions (item 6) ─────
CREATE TABLE IF NOT EXISTS public.content_prediction (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL,
  content_id             uuid,
  platform               text,
  engagement_potential   numeric,            -- 0..1
  platform_suitability   numeric,            -- 0..1
  objective_likelihood   numeric,            -- 0..1
  improvement_opportunities jsonb,           -- structured, explainable
  explanation            jsonb NOT NULL,     -- the deterministic reasoning behind each score
  model_version          integer NOT NULL DEFAULT 1,  -- reproducibility
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_prediction_content_idx ON public.content_prediction (content_id, created_at DESC);
CREATE INDEX IF NOT EXISTS content_prediction_company_idx ON public.content_prediction (company_id, created_at DESC);

-- ── updated_at trigger for learning_memory (reuse shared fn) ────────────────
CREATE OR REPLACE FUNCTION public.set_content_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS learning_memory_set_updated_at ON public.learning_memory;
CREATE TRIGGER learning_memory_set_updated_at BEFORE UPDATE ON public.learning_memory
  FOR EACH ROW EXECUTE FUNCTION public.set_content_updated_at();

-- ── RLS — company-scoped (service role bypasses; mirrors Waves 1-4) ─────────
ALTER TABLE public.content_performance   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_intelligence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_memory       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_lineage   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_prediction    ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['content_performance','learning_intelligence','learning_memory','publication_lineage','content_prediction'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname = t || '_company_rw') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I USING (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = ''active'')) WITH CHECK (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = ''active''))',
        t || '_company_rw', t
      );
    END IF;
  END LOOP;
END $$;
