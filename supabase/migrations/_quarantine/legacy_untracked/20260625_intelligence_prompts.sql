BEGIN;

CREATE TABLE IF NOT EXISTS public.intelligence_prompts (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unified_person_id   UUID        REFERENCES public.unified_persons(id) ON DELETE SET NULL,
  intelligence_gap_id UUID        NOT NULL REFERENCES public.intelligence_gaps(id) ON DELETE CASCADE,
  prompt_type         TEXT        NOT NULL,
  title               TEXT        NOT NULL,
  message             TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT intelligence_prompts_gap_unique
    UNIQUE (intelligence_gap_id),
  CONSTRAINT intelligence_prompts_type_not_blank
    CHECK (LENGTH(BTRIM(prompt_type)) > 0),
  CONSTRAINT intelligence_prompts_title_not_blank
    CHECK (LENGTH(BTRIM(title)) > 0),
  CONSTRAINT intelligence_prompts_message_not_blank
    CHECK (LENGTH(BTRIM(message)) > 0),
  CONSTRAINT intelligence_prompts_status_valid
    CHECK (status IN ('pending', 'shown', 'responded', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_intelligence_prompts_company_status
  ON public.intelligence_prompts(company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_intelligence_prompts_company_person
  ON public.intelligence_prompts(company_id, unified_person_id);

CREATE INDEX IF NOT EXISTS idx_intelligence_prompts_gap
  ON public.intelligence_prompts(intelligence_gap_id);

DROP TRIGGER IF EXISTS trg_intelligence_prompts_updated_at ON public.intelligence_prompts;
CREATE TRIGGER trg_intelligence_prompts_updated_at
  BEFORE UPDATE ON public.intelligence_prompts
  FOR EACH ROW
  EXECUTE FUNCTION omnivyra_touch_updated_at();

ALTER TABLE public.intelligence_prompts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'intelligence_prompts'
      AND policyname = 'service_role_full_access'
  ) THEN
    DROP POLICY "service_role_full_access" ON public.intelligence_prompts;
  END IF;

  CREATE POLICY "service_role_full_access"
    ON public.intelligence_prompts
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
END $$;

COMMENT ON TABLE public.intelligence_prompts IS
  'Pending backend prompts generated from intelligence gaps so users can later be asked for missing inputs.';

COMMENT ON COLUMN public.intelligence_prompts.intelligence_gap_id IS
  'One-to-one link to the intelligence gap that produced this prompt.';

COMMIT;
