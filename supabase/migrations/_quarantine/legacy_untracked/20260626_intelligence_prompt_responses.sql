BEGIN;

CREATE TABLE IF NOT EXISTS public.intelligence_prompt_responses (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  intelligence_prompt_id UUID        NOT NULL REFERENCES public.intelligence_prompts(id) ON DELETE CASCADE,
  company_id             UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unified_person_id      UUID        REFERENCES public.unified_persons(id) ON DELETE SET NULL,
  response_type          TEXT        NOT NULL,
  response_payload       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT intelligence_prompt_responses_type_not_blank
    CHECK (LENGTH(BTRIM(response_type)) > 0),
  CONSTRAINT intelligence_prompt_responses_payload_object
    CHECK (jsonb_typeof(response_payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_intelligence_prompt_responses_prompt
  ON public.intelligence_prompt_responses(intelligence_prompt_id);

CREATE INDEX IF NOT EXISTS idx_intelligence_prompt_responses_company_created
  ON public.intelligence_prompt_responses(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_intelligence_prompt_responses_company_person
  ON public.intelligence_prompt_responses(company_id, unified_person_id);

ALTER TABLE public.intelligence_prompt_responses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'intelligence_prompt_responses'
      AND policyname = 'service_role_full_access'
  ) THEN
    DROP POLICY "service_role_full_access" ON public.intelligence_prompt_responses;
  END IF;

  CREATE POLICY "service_role_full_access"
    ON public.intelligence_prompt_responses
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
END $$;

COMMENT ON TABLE public.intelligence_prompt_responses IS
  'Backend records of user feedback submitted against intelligence prompts.';

COMMENT ON COLUMN public.intelligence_prompt_responses.response_payload IS
  'Structured user-provided data, such as revenue amount, currency, and notes.';

COMMIT;
