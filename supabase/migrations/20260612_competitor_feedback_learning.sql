BEGIN;

CREATE TABLE IF NOT EXISTS public.competitor_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  competitor_name TEXT NOT NULL,
  category TEXT,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('correct', 'incorrect', 'missing')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS competitor_feedback_company_category_idx
  ON public.competitor_feedback (company_id, category, created_at DESC);

CREATE INDEX IF NOT EXISTS competitor_feedback_name_idx
  ON public.competitor_feedback (lower(competitor_name));

CREATE INDEX IF NOT EXISTS competitor_feedback_category_type_idx
  ON public.competitor_feedback (category, feedback_type, created_at DESC);

ALTER TABLE public.competitor_feedback ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'competitor_feedback'
      AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON public.competitor_feedback
      FOR ALL USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

COMMIT;
