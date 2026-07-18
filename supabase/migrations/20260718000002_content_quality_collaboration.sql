-- 2026-07-18 — WRITER-EXEC-005 Wave 4: Content Quality Intelligence & Human-AI
-- Collaboration. Turns Writer Content into an editorial system: deterministic
-- quality scorecards, explainable + reversible section-level recommendations,
-- collaborative editing (locks), and an approval workflow with history.
--
-- Builds on the Wave 1 canonical `content` spine + Wave 2 originality; does NOT
-- redesign either. Four NEW tables + one ADDITIVE lifecycle-value extension.
-- Company-scoped RLS (denormalized company_id). Idempotent. Zero destructive
-- changes to existing data.
--
-- APPLY: cert/beta via BETA_DB_URL; production via the controlled pooler-DDL
-- process (ledger desynced; do NOT db:push). This file is the record.

-- ── content_quality — persisted deterministic scorecard (item 1/2) ──────────
CREATE TABLE IF NOT EXISTS public.content_quality (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  content_id    uuid,                       -- soft ref → content.id
  overall_score numeric,                    -- 0..100
  dimensions    jsonb NOT NULL,             -- {objectiveAlignment, brandVoice, originality, platformFit, readability, hook, cta, seo, trust, clarity, grammar, structure: {score, ...}}
  evaluated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_quality_company_idx ON public.content_quality (company_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS content_quality_content_idx ON public.content_quality (content_id) WHERE content_id IS NOT NULL;

-- ── content_block — section-level editable blocks (item 5) + locks (item 4/9) ─
CREATE TABLE IF NOT EXISTS public.content_block (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id  uuid NOT NULL REFERENCES public.content(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL,
  block_type  text NOT NULL CHECK (block_type IN ('hook','opening','body','cta','hashtags','other')),
  position    integer NOT NULL DEFAULT 0,
  text        text,
  locked      boolean NOT NULL DEFAULT false,  -- AI may NOT modify a locked block
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_block_content_idx ON public.content_block (content_id, position);
CREATE INDEX IF NOT EXISTS content_block_company_idx ON public.content_block (company_id);

-- ── content_recommendation — explainable + reversible recs (item 3/9) ───────
CREATE TABLE IF NOT EXISTS public.content_recommendation (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  content_id      uuid NOT NULL REFERENCES public.content(id) ON DELETE CASCADE,
  block_id        uuid REFERENCES public.content_block(id) ON DELETE CASCADE,  -- section it targets
  affected_section text,                     -- block_type label when block_id absent
  category        text NOT NULL,             -- e.g. hook/cta/clarity/brand/originality/platform
  reason          text NOT NULL,
  expected_impact text,
  confidence      numeric,                   -- 0..1
  before_text     text,                      -- reversibility: the exact prior text
  after_text      text,                      -- the proposed replacement
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','rejected','superseded')),
  quality_ref     jsonb,                     -- scorecard dimensions this rec references (item 2)
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);
CREATE INDEX IF NOT EXISTS content_recommendation_content_idx ON public.content_recommendation (content_id, status);
CREATE INDEX IF NOT EXISTS content_recommendation_company_idx ON public.content_recommendation (company_id);

-- ── content_approval_history — approval workflow audit trail (item 6/9) ─────
CREATE TABLE IF NOT EXISTS public.content_approval_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  content_id  uuid NOT NULL REFERENCES public.content(id) ON DELETE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  actor       uuid,                          -- user id (null = system)
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_approval_history_content_idx ON public.content_approval_history (content_id, created_at DESC);
CREATE INDEX IF NOT EXISTS content_approval_history_company_idx ON public.content_approval_history (company_id);

-- ── Lifecycle extension — add 'quality_reviewed' (ADDITIVE, item 6) ─────────
-- Existing values remain valid; we only widen the allowed set. Postgres
-- auto-names the inline CHECK `content_lifecycle_status_check`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='content') THEN
    ALTER TABLE public.content DROP CONSTRAINT IF EXISTS content_lifecycle_status_check;
    ALTER TABLE public.content ADD CONSTRAINT content_lifecycle_status_check
      CHECK (lifecycle_status IN ('draft','generated','edited','approved','adapted','scheduled','published','archived','quality_reviewed'));
  END IF;
END $$;

-- ── updated_at trigger for content_block (reuse Wave 1 fn) ──────────────────
CREATE OR REPLACE FUNCTION public.set_content_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS content_block_set_updated_at ON public.content_block;
CREATE TRIGGER content_block_set_updated_at BEFORE UPDATE ON public.content_block
  FOR EACH ROW EXECUTE FUNCTION public.set_content_updated_at();

-- ── RLS — company-scoped (service role bypasses; mirrors Wave 1/2 pattern) ──
ALTER TABLE public.content_quality          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_block            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_recommendation   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_approval_history ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['content_quality','content_block','content_recommendation','content_approval_history'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname = t || '_company_rw') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I USING (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = ''active'')) WITH CHECK (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = ''active''))',
        t || '_company_rw', t
      );
    END IF;
  END LOOP;
END $$;
